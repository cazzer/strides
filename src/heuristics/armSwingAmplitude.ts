import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import type { BodyScale } from './bodyScale'
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
  travelFailureCaveat,
} from './armSwing'
import type { SideSwing } from './armSwing'

type ViewFitEntry = HeuristicsConfig['viewFitTable']['armSwingAmplitude'][View]

const NO_STRIDE_RHYTHM_CAVEAT =
  'No steady running rhythm was found in this clip, so the arm swing could not be timed against it.'
const TOO_IRREGULAR_CAVEAT =
  'Arm positions were tracked, but the swing rhythm on one arm was too irregular to measure.'
const NO_BODY_SCALE_CAVEAT = 'No resolvable body-scale reference (shoulders/hips) in this clip.'
const NEAR_ARM_CAVEAT =
  'Measured from the near arm only — from the side the far arm is hidden behind the body.'
const SIDE_TIE_CAVEAT =
  'Both arms were tracked equally well from the side, so both were measured — but the far arm may be partly hidden behind the body, which can make this overall swing size read off.'

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
 * Arm swing amplitude: how far the wrist travels up and down in one stride, relative to its
 * shoulder, as a fraction of torso length — how BIG the swing is. From the front it is the MEAN of
 * the two arms; from the side it is the NEAR arm alone.
 *
 * ## What is measured
 *
 * Each side's travel comes from the shared `computeSideSwing` (`armSwing.ts`): a spectral fit
 * searched around the clip's stride rate (`resolveStrideRateHz` — hip-bounce frequency / 2; no
 * anchor is an honest null, never a fallback search) finds the rhythm, and the per-stride
 * `travelPx` read off the trend-removed series is the size. The fit's fundamental peak-to-peak is
 * not published: on a non-sinusoidal swing it carries only part of the wrist's travel
 * (`measure-arm-swing-travel-at-stride-rate` design D2).
 *
 * ## The shared fits, the shared gates — by construction
 *
 * Every trust gate is the SHARED one, read on the fitted fundamental: a measured arm's R² against
 * `config.armSwingMinFitR2` (both arms: the weaker one's), the shared `MIN_ARM_SWING_CYCLES`
 * floor, and — for a both-arms reading — the shared `MAX_SIDE_FREQUENCY_DISAGREEMENT` cross-side
 * rhythm bound. Never a second gate constant on the same fitted signal — two gates would let two
 * readers of one fit disagree about whether it is trustworthy, the bug class #36 deleted.
 *
 * The cross-side bound still earns its place inside the ±20% stride band (two arms at 1.25 and
 * 1.75 Hz are both on the grid and cannot both be one body's swing). The case that motivated it —
 * the multi-person clip's right arm fitting the STEP rhythm at R² 0.324 — is now structurally off
 * the grid. Which side found the true rhythm is not decidable from two fits that disagree, so there
 * is no single-side fallback from the front.
 *
 * ## View — both arms from the front, the near arm from the side
 *
 * **Front (primary) and ambiguous (unsuitable, still computed)**: the mean of the two arms'
 * travels, each series stabilized by the strictly bilateral shoulder span. The mean answers "how
 * big" (original design D1); a min would headline the worst-measured number instead. Confidence
 * reads the WORSE side's coverage, interpolation, cycles and fit quality, never an average, because
 * an average hides the case that must not read as confident — one arm measured materially worse —
 * and a fit-quality divergence past `SIDE_FIT_QUALITY_DISPARITY_R2` is caveated as possibly
 * measurement rather than form.
 *
 * **Side (tolerated, ×0.6)**: the far arm is hidden behind the body, and the original design's D6
 * hard-gated side view away because a both-arms mean is contaminated by it. Reversed for side only
 * (user approval 2026-10-27, `strides-eiil.3`): side footage shows the sagittal swing best, so the
 * NEAR arm is measured alone — the arm with strictly more directly-detected frames (`resolvedCount
 * − interpolatedCount`), since occlusion is exactly what costs the far arm its detections. Its
 * series is stabilized by torso length (side-on the shoulder span collapses), its own fit gates,
 * its own inputs set confidence, and the far arm cannot null the reading. A tie falls back to the
 * both-arms rule over the same torso-stabilized fits. Picking by travel direction was rejected
 * (MoveNet swaps left/right side-on) and so was picking by R² (it selects on the outcome).
 *
 * The torso normalizer is `estimateBodyScale`'s clip-median torso length — the pipeline's shared
 * normalizer — and the per-side travels arrive at the clip's reference (median) scale, so the two
 * pair naturally. It is checked FIRST, before the stride anchor: a clip with no resolvable hips has
 * neither, and the missing normalizer is the more fundamental cause to name.
 *
 * ## Cycles are a hard floor, counted in strides
 *
 * A travel needs at least `MIN_ARM_SWING_CYCLES` complete stride periods (`armSwing.ts`,
 * `perStrideTravel`), so no published value rests on fewer. The stride count is a HARD FLOOR ONLY:
 * it is still handed to `computeMetricConfidence` as the sample size, but every value that clears
 * the floor already meets `minRequiredSampleSize`, so it never ramps confidence. Confidence varies
 * with view fit, coverage, interpolation and fit quality alone.
 *
 * ## What it claims
 *
 * It is an honest 2D movement-amplitude proxy: how far the wrists travel, saying nothing about what
 * the swing contributes to the stride. Per "never a silent wrong number", an unsuitable view still
 * computes its value, capped low by the view-fit multiplier.
 */
export function computeArmSwingAmplitude(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.armSwingAmplitude[view]

  // Normalizer first: a clip with no resolvable hips has no stride anchor either, and the missing
  // body-scale reference is the cause to name. The zero-torso arm of the guard is unreachable in
  // practice (a median of distances is only 0 when shoulder-mid and hip-mid coincide) but guarded
  // per the "never NaN" contract.
  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null || bodyScale.torsoLengthPx <= 0) {
    return nullResult(viewFitEntry.fit, NO_BODY_SCALE_CAVEAT)
  }

  // The arm swing is searched around the clip's stride rate, so without one there is nothing to
  // time it against — and no fallback band, because the shared bounce band is the defect the
  // anchor replaced (`armSwing.ts`, "The frequency grid is anchored on the clip's stride rate").
  const strideHz = resolveStrideRateHz(frames, config)
  if (strideHz === null) return nullResult(viewFitEntry.fit, NO_STRIDE_RHYTHM_CAVEAT)

  if (view === 'side') {
    const left = computeSideSwing(frames, 'left', { strideHz, scaleProxy: 'torsoLength' })
    const right = computeSideSwing(frames, 'right', { strideHz, scaleProxy: 'torsoLength' })
    const leftDetected = left.resolvedCount - left.interpolatedCount
    const rightDetected = right.resolvedCount - right.interpolatedCount
    if (leftDetected > rightDetected) {
      return measureNearArm(frames, 'left', left, bodyScale, viewFitEntry, config)
    }
    if (rightDetected > leftDetected) {
      return measureNearArm(frames, 'right', right, bodyScale, viewFitEntry, config)
    }
    // A tie — typically both arms detected on every frame — cannot say which arm is the near one,
    // so both are measured, with the occlusion risk named rather than hidden.
    return measureBothArms(frames, left, right, bodyScale, view, viewFitEntry, config, [
      SIDE_TIE_CAVEAT,
    ])
  }

  const left = computeSideSwing(frames, 'left', { strideHz, scaleProxy: 'shoulderSpan' })
  const right = computeSideSwing(frames, 'right', { strideHz, scaleProxy: 'shoulderSpan' })
  return measureBothArms(frames, left, right, bodyScale, view, viewFitEntry, config, [])
}

/** Linear ramp from "just cleared the gate" (0) to "as good as a clean clip gets" (1) — the shared
 * saturation point, so every reading of the shared fit agrees on what a good fit is. */
function fitQualityOf(r2: number, minFitR2: number): number {
  return FIT_QUALITY_SATURATION_R2 > minFitR2
    ? clamp01((r2 - minFitR2) / (FIT_QUALITY_SATURATION_R2 - minFitR2))
    : 1
}

const UNSTEADY_CAVEAT =
  "The arm-swing rhythm in this clip wasn't perfectly steady — confidence reduced accordingly."

function finish(
  fields: Pick<
    MetricResult,
    'value' | 'confidence' | 'viewFit' | 'interpolatedFraction' | 'frameCoverage' | 'sampleSize'
  >,
  caveats: string[],
  exemplars: MetricExemplar[] | undefined,
): MetricResult {
  return {
    metric: 'armSwingAmplitude',
    value: fields.value,
    unit: 'ratio',
    confidence: fields.confidence,
    viewFit: fields.viewFit,
    interpolatedFraction: fields.interpolatedFraction,
    frameCoverage: fields.frameCoverage,
    sampleSize: fields.sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}

/**
 * The side-view reading: the near arm alone. Every gate, confidence input and exemplar is the
 * near arm's; the far arm is not consulted at all.
 */
function measureNearArm(
  frames: RobustPoseFrame[],
  side: 'left' | 'right',
  near: SideSwing,
  bodyScale: BodyScale,
  viewFitEntry: ViewFitEntry,
  config: HeuristicsConfig,
): MetricResult {
  // `near` was chosen for having strictly more directly-detected frames than the other arm, so it
  // resolved in at least one frame and the divisions below are guarded by construction.
  const frameCoverage = near.resolvedCount / frames.length

  if (!near.fit.ok) {
    return nullResult(
      viewFitEntry.fit,
      caveatForFailure(near.fit.reason, near.fit.sampleCount),
      frameCoverage,
    )
  }
  const minFitR2 = config.armSwingMinFitR2
  if (near.fit.sinusoidR2 < minFitR2) {
    return nullResult(viewFitEntry.fit, TOO_IRREGULAR_CAVEAT, frameCoverage)
  }
  if (near.travelPx === null) {
    return nullResult(viewFitEntry.fit, travelFailureCaveat(near), frameCoverage)
  }

  const interpolatedFraction = near.interpolatedCount / near.resolvedCount
  const sampleSize = Math.floor(near.strideCycles)
  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: near.strideCycles,
    minRequiredSampleSize: MIN_ARM_SWING_CYCLES,
    fitQuality: fitQualityOf(near.fit.sinusoidR2, minFitR2),
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats = [NEAR_ARM_CAVEAT]
  if (near.fit.sinusoidR2 < FIT_QUALITY_SATURATION_R2) caveats.push(UNSTEADY_CAVEAT)

  return finish(
    {
      value: near.travelPx / bodyScale.torsoLengthPx,
      confidence,
      viewFit: viewFitEntry.fit,
      interpolatedFraction,
      frameCoverage,
      sampleSize,
    },
    caveats,
    selectExemplars(buildSideExemplar(side, near, frames)),
  )
}

/**
 * The both-arms reading (front, ambiguous, and a side clip whose arms tie on detections): the
 * MEAN of the two travels, every gate and confidence input on the WORSE arm.
 */
function measureBothArms(
  frames: RobustPoseFrame[],
  left: SideSwing,
  right: SideSwing,
  bodyScale: BodyScale,
  view: View,
  viewFitEntry: ViewFitEntry,
  config: HeuristicsConfig,
  leadingCaveats: string[],
): MetricResult {
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
  // produced no travel.
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
    // The SHARED gate: below it the weaker fit describes noise, and a mean over one real travel
    // and one noise travel is not an arm-swing size.
    return nullResult(viewFitEntry.fit, TOO_IRREGULAR_CAVEAT, frameCoverage)
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

  // Either arm without a travel: usually fewer than two complete strides in its span.
  if (left.travelPx === null) {
    return nullResult(viewFitEntry.fit, travelFailureCaveat(left), frameCoverage)
  }
  if (right.travelPx === null) {
    return nullResult(viewFitEntry.fit, travelFailureCaveat(right), frameCoverage)
  }

  const interpolatedFraction = Math.max(
    left.interpolatedCount / left.resolvedCount,
    right.interpolatedCount / right.resolvedCount,
  )
  const observedCycles = Math.min(left.strideCycles, right.strideCycles)
  const sampleSize = Math.floor(observedCycles)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    // Fractional, not the floored `sampleSize`: flooring here would turn a difference smaller than
    // the fit's own frequency resolution into a confidence cliff.
    sampleSize: observedCycles,
    minRequiredSampleSize: MIN_ARM_SWING_CYCLES,
    // On the WEAKER arm's fit.
    fitQuality: fitQualityOf(weakestR2, minFitR2),
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  // Each shortfall that applies is named rather than picking a winner — they are independent, they
  // each independently cost confidence, and a short clip is also a harder clip to fit.
  const caveats = [...leadingCaveats]
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Arm swing amplitude needs both arms visible and separable, and is not reliable from ${viewPhrase(view)}.`,
    )
  }
  if (Math.abs(left.fit.sinusoidR2 - right.fit.sinusoidR2) > SIDE_FIT_QUALITY_DISPARITY_R2) {
    caveats.push(
      "One arm's swing rhythm fit its trace much less cleanly than the other's in this clip, so part of this overall swing size may reflect measurement rather than form.",
    )
  } else if (weakestR2 < FIT_QUALITY_SATURATION_R2) {
    caveats.push(UNSTEADY_CAVEAT)
  }

  // One candidate per side, gated and ranked together: the budget is per-metric, so gating each
  // arm separately would apply the cap twice and could keep two pictures of one arm.
  const exemplars = selectExemplars([
    ...buildSideExemplar('left', left, frames),
    ...buildSideExemplar('right', right, frames),
  ])

  return finish(
    {
      value: (left.travelPx + right.travelPx) / (2 * bodyScale.torsoLengthPx),
      confidence,
      viewFit: viewFitEntry.fit,
      interpolatedFraction,
      frameCoverage,
      sampleSize,
    },
    caveats,
    exemplars,
  )
}
