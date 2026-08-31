import type { KeypointName } from '../pose/types'
import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { resolvePoint } from './keypoints'
import { computeMetricConfidence } from './confidence'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralFitFailureReason, SpectralFitResult } from './spectralFit'
import { resolvedSpanCenter, selectBounceInstants } from './bounceInstants'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
} from './exemplars'
import type { MetricExemplar } from './types'
import { clamp01 } from './mathUtils'

/**
 * Minimum complete ARM-SWING cycles — one per STRIDE, so one cycle spans two footfalls — for the
 * fitted per-side amplitude to be trusted at full confidence.
 *
 * Two is deliberately the same real demand the previous estimator encoded as "at least 4
 * half-swings": swapping the estimator should not silently also raise the sample bar, so the
 * number was converted rather than re-chosen. It is NOT comparable to
 * `verticalOscillationMinCycles`, which counts BOUNCE cycles at one per step — twice this rate for
 * the same footage.
 */
const MIN_ARM_SWING_CYCLES = 2

/**
 * Sinusoid partial R² at or above which a side's fit is treated as fully trustworthy — the top of
 * the ramp `armSwingMinFitR2` starts. Same value and same reasoning as
 * `verticalOscillation.ts`'s constant of the same name: a module constant rather than config,
 * because unlike the minimum (a "publish this or not" policy) this is only the shape of the ramp
 * between the gate and "perfect", and moving it independently of the gate only makes the two
 * numbers disagree.
 */
const FIT_QUALITY_SATURATION_R2 = 0.8

/**
 * Maximum fractional disagreement between the two sides' fitted frequencies, above which the two
 * amplitudes are not treated as comparable at all.
 *
 * **This is the check that distinguishes a real asymmetry from a measured one**, and it exists
 * because the R² gate provably does not catch it. Both arms belong to one body and swing on one
 * rhythm, so two fits landing on materially different frequencies means at least one of them found
 * something that is not the arm swing — and a ratio between an arm-swing amplitude and some other
 * oscillation's amplitude is not a symmetry measurement, however confidently each side fitted on
 * its own. Measured live on `e2e/fixtures/multiperson-track.mp4` (2026-08-29): left 1.48 Hz at
 * R² 0.676, right **2.80 Hz** at R² 0.324 — the right side had latched onto the step rhythm
 * (cadence 174 spm = 2.90 Hz) rather than the stride rhythm, cleared the R² gate anyway, and the
 * reported 0.349 ratio was a comparison between two different oscillations.
 *
 * 0.25 is a judgment call sized to be far wider than the disagreement a healthy clip produces and
 * far narrower than a step-versus-stride confusion, which is a factor of two by construction. The
 * measured margins either side of it: Demo 2 (both sides on the stride rhythm) 0.027, Demo 1
 * 0.104, multiperson (one side on the step rhythm) 0.892.
 */
const MAX_SIDE_FREQUENCY_DISAGREEMENT = 0.25

/**
 * Difference in the two sides' fitted `sinusoidR2` above which the clip is caveated for having
 * measured one arm materially better than the other.
 *
 * Confidence already carries this numerically — it ramps on the WEAKER side's fit, below — but a
 * number alone cannot tell a reader that the asymmetry they are looking at may be a property of
 * the footage rather than of the runner. On a clip where one arm spends the measured window
 * further from the camera (Demo 2: left R² 0.778, right R² 0.497), the weaker-looking arm is also
 * the worse-measured one, and that coincidence is exactly what a symmetry number must not present
 * as a finding. A judgment call, in the same spirit as `presenceMinConsecutiveFrames`.
 */
const SIDE_FIT_QUALITY_DISPARITY_R2 = 0.2

const SHOULDER_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_shoulder',
  right: 'right_shoulder',
}

const WRIST_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_wrist',
  right: 'right_wrist',
}

/** Context only (design D2): the elbow is the joint the swing bends at, so a shoulder-to-wrist
 * crop without it reads as a bare diagonal. Optional by contract — `cropKeypoints` drops it if it
 * resolves nowhere in the pair's own frames. */
const ELBOW_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_elbow',
  right: 'right_elbow',
}

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

interface SideSwing {
  /** The side's own wrist-relative-to-shoulder-y trace, `null` where it did not resolve, index-
   * parallel to `frames` — the shape `resolvedSpanCenter` reads. */
  seriesY: Array<number | null>
  /** The spectral fit of that trace, over the shared bounce-frequency grid. */
  fit: SpectralFitResult
  /** Frames where this side's shoulder AND wrist both resolved. */
  resolvedCount: number
  /** Of resolvedCount, how many had either point flagged interpolated. */
  interpolatedCount: number
}

/**
 * Per-side wrist-relative-to-shoulder vertical (image-y) excursion, read as a spectral sinusoid
 * fit via the shared `fitSpectralSinusoid` primitive — the same estimator, over the same frequency
 * grid, that `verticalOscillation` and `cadence` read their own rhythms with.
 *
 * Vertical, not horizontal or angular, and wrist rather than elbow, per design.md's original
 * reasoning: the sagittal shoulder-flexion rotation that drives arm swing is foreshortened face-on
 * (this metric's primary view), but the coupled elbow-flexion rise/fall of the forearm toward the
 * chest on the forward swing is a real, front-view-visible vertical motion, and the wrist — the
 * most distal available point — inherits the largest version of it. That input signal is unchanged;
 * only how an amplitude is read off it changed.
 *
 * ## Why a fit and not paired extrema
 *
 * This function used to hand the same series to `findLocalExtrema` at a
 * `armSwingMinProminenceRatio × torsoLengthPx` prominence floor and take the median of the
 * resulting peak-to-trough excursions. Measured on Demo 2 (2026-08-29, real GPU, three
 * fresh-process trials, bit-identical), that produced roughly **twice as many extrema as the clip
 * contains half-swings**: 9 confirmed half-swings per side across a 1.62 s window whose fitted
 * rhythm holds ~2.4 arm-swing cycles, i.e. ~5 real half-swings. Their spacings — left
 * `[0.200, 0.234, 0.500, 0.184, 0.050, 0.150, 0.100, 0.100, 0.067]` s against a 0.331 s half-cycle
 * — are the direct evidence: six of nine span under two-thirds of a half-cycle, and the shortest
 * is three frames. The amplitudes those fragments carry (left 11.5 px to 109.8 px; right 7.9 px to
 * 159.7 px) are consequently a mixture of real half-swings and tracking wiggle, and their MEDIAN —
 * the reported per-side amplitude — is a statistic over that mixture rather than over the swing.
 *
 * This is the identical failure `verticalOscillation` retired its own extrema-pairing estimator
 * for, for the identical reasons (see that module's "Method" section), and the fix is the same
 * primitive: the trend terms absorb whole-body drift instead of charging it to the swing, and the
 * fitted frequency is a rhythm rather than a count of whichever wiggles cleared a threshold.
 *
 * The frequency grid is deliberately the SHARED bounce band, not a halved "stride band", even
 * though one arm swing spans one stride and therefore sits at half the step rate. Measured both
 * ways on all three clips: on Demo 2 — the only clip where this metric is primary — the two bands
 * agree to within one grid step (1.48/1.48 Hz left, 1.52/1.53 Hz right, amplitudes within 0.3%)
 * while the halved band's `secondPeakRatio` is strictly worse (0.13 -> 0.25 left, 0.31 -> 0.69
 * right); and on both side-view clips the halved band lands on its own grid FLOOR (0.60 Hz at 1.02
 * and 1.25 observed cycles) — a grid-edge artifact, not a rhythm. The real limitation this leaves
 * is recorded on the exported function below.
 */
function computeSideSwing(
  frames: RobustPoseFrame[],
  side: 'left' | 'right',
  config: HeuristicsConfig,
): SideSwing {
  let resolvedCount = 0
  let interpolatedCount = 0

  const seriesY = frames.map((frame) => {
    const shoulder = resolvePoint(frame, SHOULDER_NAME[side])
    const wrist = resolvePoint(frame, WRIST_NAME[side])
    if (shoulder === null || wrist === null) return null
    resolvedCount += 1
    if (shoulder.interpolated || wrist.interpolated) interpolatedCount += 1
    return wrist.y - shoulder.y
  })

  const samples: Array<{ t: number; v: number }> = []
  seriesY.forEach((v, i) => {
    if (v !== null) samples.push({ t: frames[i].timestamp, v })
  })

  const fit = fitSpectralSinusoid(samples, {
    minFrequencyHz: config.spectralFitMinFrequencyHz,
    maxFrequencyHz: config.spectralFitMaxFrequencyHz,
    frequencyStepHz: config.spectralFitFrequencyStepHz,
  })

  return { seriesY, fit, resolvedCount, interpolatedCount }
}

function caveatForFailure(reason: SpectralFitFailureReason, sampleCount: number): string {
  switch (reason) {
    case 'too-few-samples':
      return `Arm position resolved in only ${sampleCount} frame(s) on one side — too few to fit a swing rhythm.`
    case 'insufficient-cycles':
      return 'Arm positions were tracked, but the clip is too short to contain a complete arm-swing cycle.'
    case 'degenerate-signal':
      return 'Arm positions were tracked, but one arm showed no oscillating vertical motion to measure.'
  }
}

/**
 * One ghosted pair per side: the wrist at the top and the bottom of ONE fitted half-swing, half a
 * fitted period apart by construction.
 *
 * Two of them, one per arm, is what makes an ASYMMETRY metric legible as a picture — one arm's
 * swing only means anything next to the other's, so this metric spends its whole two-exemplar
 * budget on the comparison rather than on two views of one arm.
 *
 * **The instants come from the fitted PHASE, never from a scan of the raw trace**, and the pair is
 * resolved by the same `selectBounceInstants` the vertical-oscillation family uses — see that
 * module's doc for why (an exemplar scanned off the raw trace depicts drift and jitter the reported
 * amplitude explicitly excludes, so the picture would contradict the number printed beside it). It
 * is also the whole point of this change: the previous exemplar was whichever raw extremum pair sat
 * nearest the median amplitude, which on Demo 2 put a *left* pair 0.5005 s apart — one and a half
 * half-cycles — under a caption promising one swing.
 *
 * **`maximumIs: 'lowest'`** — the fitted series is `wrist.y − shoulder.y` in image-y, which grows
 * DOWNWARD, so the sinusoid's MAXIMUM is the wrist at its LOWEST on screen. Getting this backwards
 * produces a caption that says the exact opposite of the truth while passing every type check; the
 * hazard is documented at length in `bounceInstants.ts` and asserted against fixture geometry in
 * this module's own tests.
 *
 * Scored on DETECTION ALONE, via an empty distribution — same reasoning `buildBounceCycleExemplar`
 * records: a fitted amplitude has no per-instance values to form a distribution from, and inventing
 * one (say, the raw excursion at that frame) would reintroduce exactly the jittery quantity the fit
 * replaced.
 */
function buildSideExemplar(
  side: 'left' | 'right',
  swing: SideSwing,
  frames: RobustPoseFrame[],
): MetricExemplar[] {
  if (!swing.fit.ok) return []
  const spanCenterSeconds = resolvedSpanCenter(frames, swing.seriesY)
  if (spanCenterSeconds === null) return []

  const instants = selectBounceInstants({
    fit: swing.fit,
    frames,
    spanCenterSeconds,
    maximumIs: 'lowest',
  })
  if (instants === null) return []

  const seed = [SHOULDER_NAME[side], WRIST_NAME[side]]
  const distribution = describeDistribution([])
  const highQuality = scoreExemplarInstant(
    { frame: instants.highest, seed },
    'representative',
    distribution,
  )
  const lowQuality = scoreExemplarInstant(
    { frame: instants.lowest, seed },
    'representative',
    distribution,
  )
  if (highQuality === null || lowQuality === null) return []

  return [
    {
      kind: 'armSwingCycle',
      timestamp: instants.highest.timestamp,
      pairedTimestamp: instants.lowest.timestamp,
      side,
      quality: pairQuality(highQuality, lowQuality),
      label: `Top and bottom of one ${side}-arm swing, ghosted together`,
      cropKeypoints: cropKeypoints(seed, [ELBOW_NAME[side]], [
        instants.highest,
        instants.lowest,
      ]),
    },
  ]
}

/**
 * Arm swing symmetry: `min(left, right) / max(left, right)` of each arm's fitted
 * wrist-relative-to-shoulder swing amplitude — a 0-1 ratio, 1 = perfectly symmetric swing.
 *
 * ## Scale-free by construction
 *
 * The value is a ratio of two amplitudes measured in the same pixel space on the same body in the
 * same frames, so the body scale cancels exactly and no torso-length normalization is applied or
 * needed. This module used to divide each side by `estimateBodyScale`'s clip-median
 * `torsoLengthPx` before taking a ratio that immediately cancelled it again — a no-op arithmetically,
 * but NOT a no-op behaviourally, because a clip with no resolvable shoulders/hips returned `null`
 * on a quantity it could in fact have measured. That dependency went with the prominence threshold
 * that was its only real consumer, exactly as it did for `verticalOscillationCm`.
 *
 * ## Both sides, one rhythm
 *
 * Each side is fitted independently and then the two fits are checked against each other before any
 * ratio is taken — see `MAX_SIDE_FREQUENCY_DISAGREEMENT`. A per-side R² gate cannot do this job on
 * its own: two fits can each clear it while describing different oscillations, and the ratio between
 * them is then not a symmetry measurement at all.
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
      'One arm was tracked noticeably better than the other in this clip, so part of the difference between them may be measurement rather than form.',
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
