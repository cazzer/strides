import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
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
} from './armSwing'

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'armSwingSymmetry',
    value: null,
    unit: 'percent',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Arm swing symmetry: `min(left, right) / max(left, right)` of each arm's fitted
 * wrist-relative-to-shoulder swing amplitude — a 0-1 ratio, 1 = perfectly symmetric swing.
 *
 * ## Scale-free by construction — but scale-STABILIZED per frame
 *
 * The value is a ratio of two amplitudes measured in the same pixel space on the same body in the
 * same frames, so the ratio needs no body-scale reference to exist: this module used to divide
 * each side by `estimateBodyScale`'s clip-median `torsoLengthPx` before taking a ratio that
 * immediately cancelled it again — a no-op arithmetically, but NOT a no-op behaviourally, because
 * a clip with no resolvable shoulders/hips returned `null` on a quantity it could in fact have
 * measured. That dependency went with the prominence threshold that was its only real consumer,
 * exactly as it did for `verticalOscillationCm`.
 *
 * A single CLIP-WIDE reference cancelling is not the same thing as the scale being harmless,
 * though: each series is now divided by a smoothed inter-shoulder trend before its fit
 * (`armSwing.ts`, "Scale stabilization before the fit"), so a subject whose on-screen size changes
 * during the clip is measured in body proportion rather than letting the large-scale frames
 * dominate both sides' least squares.
 *
 * ## Both sides, one rhythm
 *
 * Each side is fitted independently and then the two fits are checked against each other before any
 * ratio is taken — see `MAX_SIDE_FREQUENCY_DISAGREEMENT` (`armSwing.ts`). A per-side R² gate
 * cannot do this job on its own: two fits can each clear it while describing different
 * oscillations, and the ratio between them is then not a symmetry measurement at all.
 *
 * ## Confidence answers "were both arms measured equally well?"
 *
 * Every aggregate here is a WEAKEST-SIDE reading — `frameCoverage`, `interpolatedFraction`,
 * `sampleSize` and `fitQuality` all take the worse of the two arms rather than an average. A
 * symmetry comparison is only as trustworthy as its less-observed side, and averaging is
 * specifically wrong for this metric: the case that must not read as confident is one arm measured
 * materially worse than the other, which is precisely the case an average hides. When the two sides'
 * fit qualities diverge past `SIDE_FIT_QUALITY_DISPARITY_R2` the result is caveated as well as
 * discounted, because the reader needs to know the asymmetry may belong to the footage.
 *
 * ## View
 *
 * Front-view-primary, the mirror image of trunk lean/overstriding's side-view-primary gating: a
 * side view occludes or superimposes the far arm (an occlusion/separability problem) rather than
 * making the swing signal itself invisible (side view's problem for trunk lean/overstriding).
 * See design.md for the full reasoning, including why amplitude ratio was chosen over phase
 * alignment. Per "never a silent wrong number", the value is still computed and returned even
 * when the view is unsuitable (`viewFitTable.armSwingSymmetry` caps confidence low instead).
 *
 * ## Known limitation
 *
 * One arm swing spans one STRIDE, so its frequency is half the step rate — and the shared
 * `spectralFitMinFrequencyHz` floor of 1.2 Hz was sized for the per-step bounce. A runner below
 * roughly 144 spm therefore has their true arm-swing frequency outside the searched band entirely.
 * Widening it was measured and rejected (see `computeSideSwing`): a halved band lands on its own
 * floor on short clips, which is a worse failure than not finding the rhythm, because it looks like
 * an answer. What protects the reader in that case is the machinery above rather than the band —
 * a fit that has found the wrong rhythm scores a low R², and if only one side finds it the
 * cross-side frequency check rejects the comparison outright.
 */
export function computeArmSwingSymmetry(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.armSwingSymmetry[view]

  const left = computeSideSwing(frames, 'left', config)
  const right = computeSideSwing(frames, 'right', config)

  // Weakest-side aggregation throughout — see this function's doc for why an average is
  // specifically wrong for a symmetry metric.
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

  // Either side failing to fit is fatal to a COMPARISON, even though the other side may have
  // fitted perfectly well — there is no honest ratio to take against a side that produced no
  // amplitude.
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
    // No-value rather than a low-confidence value, on the same grounds `verticalOscillation` states:
    // below the gate the fitted amplitude describes noise, and there is no confidence discount
    // honest enough to make a meaningless number worth showing. Here it is worse than for a single
    // amplitude — a noise amplitude on one side becomes a fabricated ASYMMETRY, not just a fuzzy
    // number.
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
    return nullResult(
      viewFitEntry.fit,
      'Each arm was tracked, but the two swing rhythms did not match, so their amplitudes are not comparable.',
      frameCoverage,
    )
  }

  const leftAmplitudePx = left.fit.peakToPeakAmplitude
  const rightAmplitudePx = right.fit.peakToPeakAmplitude
  const maxAmplitudePx = Math.max(leftAmplitudePx, rightAmplitudePx)
  // Unreachable in practice — `fitSpectralSinusoid` reports `degenerate-signal` rather than a
  // zero amplitude, and that branch already returned above. Guarded anyway, per this pipeline's
  // "never NaN" contract, rather than relying on that invariant silently.
  const value =
    maxAmplitudePx === 0 ? 1 : Math.min(leftAmplitudePx, rightAmplitudePx) / maxAmplitudePx

  const interpolatedFraction = Math.max(
    left.interpolatedCount / left.resolvedCount,
    right.interpolatedCount / right.resolvedCount,
  )

  const observedCycles = Math.min(left.fit.observedCycles, right.fit.observedCycles)
  const sampleSize = Math.floor(observedCycles)

  // Linear ramp from "just cleared the gate" (0) to "as good as a clean clip gets" (1), on the
  // WEAKER arm's fit. Denominator is guaranteed positive as long as the saturation point sits above
  // the gate, which the defaults satisfy by a wide margin (0.30 vs 0.80).
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
      `Arm swing symmetry needs both arms visible and separable, and is not reliable from ${viewPhrase(view)}.`,
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
      "One arm's swing rhythm fit its trace much less cleanly than the other's in this clip, so part of the difference between them may be measurement rather than form.",
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
    metric: 'armSwingSymmetry',
    value,
    unit: 'percent',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
