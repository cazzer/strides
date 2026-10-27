import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { computeMetricConfidence } from './confidence'
import { selectExemplars } from './exemplars'
import { clamp01 } from './mathUtils'
import {
  FIT_QUALITY_SATURATION_R2,
  MAX_SIDE_FREQUENCY_DISAGREEMENT,
  MIN_ARM_SWING_CYCLES,
  SIDE_FIT_QUALITY_DISPARITY_R2,
  buildSideExemplar,
  caveatForFailure,
  computeSideSwing,
  resolveStrideRateHz,
} from './armSwing'

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'armSwingAmplitude',
    value: null,
    unit: 'ratio',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Arm swing amplitude: the MEAN of the two arms' fitted peak-to-peak wrist-relative-to-shoulder
 * vertical swing amplitudes, as a fraction of torso length — how BIG the swing is.
 *
 * ## The shared fits, the shared gates — by construction
 *
 * Both per-side fits come from the shared `computeSideSwing` (`armSwing.ts`), and every trust
 * gate is the SHARED one: the weaker arm's R² against `config.armSwingMinFitR2`, the shared
 * `MIN_ARM_SWING_CYCLES` floor, and the shared `MAX_SIDE_FREQUENCY_DISAGREEMENT` cross-side
 * rhythm bound. Never a second gate constant on the same fitted signal — two gates would let two
 * readers of one fit disagree about whether it is trustworthy, the bug class #36 deleted — so a
 * future second consumer of `armSwing.ts` inherits this gate rather than choosing its own.
 *
 * The cross-side rhythm bound earns its place here on its own (design.md D6): on the multi-person clip
 * the right arm's fit lands on the STEP rhythm at R² 0.324 — clearing the 0.3 gate — while the
 * left fits the stride rhythm. A mean of an arm-swing amplitude and a step-bounce amplitude is
 * not an arm-swing amplitude, and only the cross-side check catches it. Which side found the true
 * rhythm is not decidable from two fits that disagree, so there is no single-side fallback: the
 * null names its own cause ("a single arm-swing size cannot be measured").
 *
 * ## Mean, not min — and why the normalizer is the torso
 *
 * The mean answers "how big" (design.md D1); the min headlines the worst-measured number instead
 * of the swing. D1 also argued the min was recoverable from a published symmetry ratio — that
 * ratio was withdrawn (`strides-zhv`), so the per-side amplitudes are no longer recoverable from
 * this card at all, and the mean now stands on its primary ground alone. An absolute amplitude
 * needs a scale reference to survive camera distance, so it is normalized by
 * `estimateBodyScale`'s clip-median torso length — the pipeline's shared normalizer — and a clip
 * with no resolvable shoulders/hips is a null naming the missing body-scale reference. The
 * per-side amplitudes arrive
 * already scale-stabilized to the clip's reference (median) scale (`armSwing.ts`, "Scale
 * stabilization before the fit"), which pairs naturally with the clip-MEDIAN torso length here —
 * the torso normalization's semantics are unchanged.
 *
 * ## Confidence answers "was the worse arm measured well?"
 *
 * Every input is the WORSE side's — `frameCoverage`, `interpolatedFraction`, `sampleSize` and
 * `fitQuality` — never an average, because an average hides exactly the case that must not read
 * as confident: one arm measured materially worse than the other, whose measurement error lands
 * undiluted in a mean. So when the two fits' quality diverges past the shared
 * `SIDE_FIT_QUALITY_DISPARITY_R2` the caveat says part of the overall swing SIZE may be
 * measurement rather than form.
 *
 * ## View
 *
 * Front-view-primary: a side view occludes or superimposes the far arm — an occlusion/separability
 * failure rather than a loss of the swing signal itself — and an amplitude averaged over one
 * visible arm and one occluded arm is contaminated by the occlusion. Per "never a silent wrong
 * number", the value is still computed and
 * returned even when the view is unsuitable (`viewFitTable.armSwingAmplitude` caps confidence low
 * instead). It is an honest 2D movement-amplitude proxy: how far the wrists travel, saying
 * nothing about what the swing contributes to the stride.
 */
export function computeArmSwingAmplitude(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.armSwingAmplitude[view]

  // The arm swing is searched around the clip's stride rate, so without one there is nothing to
  // time it against — and no fallback band, because the shared bounce band is the defect the
  // anchor replaced (`armSwing.ts`, "The frequency grid is anchored on the clip's stride rate").
  const strideHz = resolveStrideRateHz(frames, config)
  if (strideHz === null) {
    return nullResult(
      viewFitEntry.fit,
      'No steady running rhythm was found in this clip, so the arm swing could not be timed against it.',
    )
  }

  const left = computeSideSwing(frames, 'left', { strideHz })
  const right = computeSideSwing(frames, 'right', { strideHz })

  // Worse-side aggregation throughout — see this function's doc for why an average is wrong here.
  const frameCoverage =
    frames.length === 0
      ? 0
      : Math.min(left.resolvedCount, right.resolvedCount) / frames.length

  if (left.resolvedCount === 0 || right.resolvedCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable shoulder/wrist position for one or both arms in this clip.',
      frameCoverage,
    )
  }

  // Either side failing to fit is fatal to a MEAN — there is no honest average over a side that
  // produced no amplitude.
  if (!left.fit.ok) {
    return nullResult(
      viewFitEntry.fit,
      caveatForFailure(left.fit.reason, left.fit.sampleCount),
      frameCoverage,
    )
  }
  if (!right.fit.ok) {
    return nullResult(
      viewFitEntry.fit,
      caveatForFailure(right.fit.reason, right.fit.sampleCount),
      frameCoverage,
    )
  }

  const minFitR2 = config.armSwingMinFitR2
  const weakestR2 = Math.min(left.fit.sinusoidR2, right.fit.sinusoidR2)
  if (weakestR2 < minFitR2) {
    // The SHARED gate: below it the weaker fit's amplitude describes noise, and a mean over one
    // real amplitude and one noise amplitude is not an arm-swing amplitude.
    return nullResult(
      viewFitEntry.fit,
      'Arm positions were tracked, but the swing rhythm on one arm was too irregular to measure.',
      frameCoverage,
    )
  }

  const frequencyDisagreement =
    Math.abs(left.fit.frequencyHz - right.fit.frequencyHz) /
    Math.min(left.fit.frequencyHz, right.fit.frequencyHz)
  if (frequencyDisagreement > MAX_SIDE_FREQUENCY_DISAGREEMENT) {
    // The caveat names the absence of one swing rhythm to size, never the comparability of the
    // two arms — what failed is that the clip yielded no single rhythm to measure a size against.
    return nullResult(
      viewFitEntry.fit,
      'Each arm was tracked, but the two swing rhythms did not match, so a single arm-swing size cannot be measured.',
      frameCoverage,
    )
  }

  // A fit that completed a cycle almost always leaves a stride window to read; this is the guard
  // for the one that did not, and its true cause is the clip's length.
  if (left.travelPx === null || right.travelPx === null) {
    return nullResult(
      viewFitEntry.fit,
      caveatForFailure('insufficient-cycles', 0),
      frameCoverage,
    )
  }

  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null || bodyScale.torsoLengthPx <= 0) {
    // Overstriding's exact wording — the true cause is the missing normalizer, not the arms. The
    // zero-torso arm of the guard is unreachable in practice (a median of distances is only 0
    // when shoulder-mid and hip-mid coincide) but guarded per the "never NaN" contract.
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
      frameCoverage,
    )
  }

  const value = (left.travelPx + right.travelPx) / (2 * bodyScale.torsoLengthPx)

  const interpolatedFraction = Math.max(
    left.interpolatedCount / left.resolvedCount,
    right.interpolatedCount / right.resolvedCount,
  )

  const observedCycles = Math.min(left.fit.observedCycles, right.fit.observedCycles)
  const sampleSize = Math.floor(observedCycles)

  // Linear ramp from "just cleared the gate" (0) to "as good as a clean clip gets" (1), on the
  // WEAKER arm's fit — the shared saturation point, so the two arm metrics' confidences agree.
  const fitQuality =
    FIT_QUALITY_SATURATION_R2 > minFitR2
      ? clamp01((weakestR2 - minFitR2) / (FIT_QUALITY_SATURATION_R2 - minFitR2))
      : 1

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    // Fractional, not the floored `sampleSize`: flooring here would turn a difference smaller than
    // the fit's own frequency resolution into a confidence cliff.
    sampleSize: observedCycles,
    minRequiredSampleSize: MIN_ARM_SWING_CYCLES,
    fitQuality,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  // Each shortfall that applies is named rather than picking a winner — they are independent, they
  // each independently cost confidence, and a short clip is also a harder clip to fit.
  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Arm swing amplitude needs both arms visible and separable, and is not reliable from ${viewPhrase(view)}.`,
    )
  }
  if (sampleSize < MIN_ARM_SWING_CYCLES) {
    caveats.push(
      `Only ${sampleSize} complete arm-swing cycle(s) observed (recommend at least ${MIN_ARM_SWING_CYCLES}) — confidence reduced accordingly.`,
    )
  }
  if (
    Math.abs(left.fit.sinusoidR2 - right.fit.sinusoidR2) > SIDE_FIT_QUALITY_DISPARITY_R2
  ) {
    caveats.push(
      "One arm's swing rhythm fit its trace much less cleanly than the other's in this clip, so part of this overall swing size may reflect measurement rather than form.",
    )
  } else if (weakestR2 < FIT_QUALITY_SATURATION_R2) {
    caveats.push(
      "The arm-swing rhythm in this clip wasn't perfectly steady — confidence reduced accordingly.",
    )
  }

  // One candidate per side, gated and ranked together: the budget is per-metric, so gating each
  // arm separately would apply the cap twice and could keep two pictures of one arm.
  const exemplars = selectExemplars([
    ...buildSideExemplar('left', left, frames),
    ...buildSideExemplar('right', right, frames),
  ])

  return {
    metric: 'armSwingAmplitude',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
