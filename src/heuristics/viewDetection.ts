import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, View, ViewDetectionResult } from './types'
import { estimateBodyScale } from './bodyScale'
import { resolveBilateralPair, resolvePoint } from './keypoints'
import { clamp01, mean, median, percentile } from './mathUtils'
import {
  AMBIGUOUS_VIEW_PLAUSIBILITY,
  computeViewPlausibility,
} from './viewPlausibility'

/**
 * The smallest sample count at which the p95-p5 range below actually trims anything at either
 * end. A DERIVATION, not a tunable — the same kind of exact statement as
 * `SIDE_VIEW_FULL_BILATERAL_SPREAD_RATIO` below, which is a module constant for the same reason
 * its front-view counterpart is a config value.
 *
 * `percentile` interpolates at index `p·(n−1)`. The largest sample, at index `n−1`, therefore
 * influences the p95 exactly when `0.95(n−1) > n−2`, i.e. when `n < 21`; the smallest influences
 * the p5 under the symmetric condition, which is the same one. So below 21 samples this estimator
 * is partly a min-max and a single wildly-off ankle sample walks straight into the result. At
 * n = 21 it is exactly second-largest minus second-smallest, and the robustness claim in
 * `computeSagittalRange`'s docstring is literally true for the first time.
 */
const MIN_SAGITTAL_RANGE_SAMPLES = 21

interface SagittalRange {
  /** The p95-p5 spread in pixels, or `null` iff `detectedSamples < MIN_SAGITTAL_RANGE_SAMPLES`. */
  range: number | null
  /** Directly-detected ankle+hip samples — the population the range was computed from, reported
   * even when the floor rejected it, so a near-miss reads as a count rather than a bare null. */
  detectedSamples: number
  /** Resolvable ankle+hip samples DISCARDED because either point was temporally interpolated. */
  interpolatedSamples: number
}

/**
 * Per-side sagittal excursion range: the p95-p5 spread of that side's ankle position relative to
 * its own hip (which cancels whole-body camera pan, leaving only the leg's own reach).
 *
 * The population is DIRECTLY-DETECTED samples only. A frame where the robustness layer had to
 * interpolate either point is discarded outright rather than discounted, and the asymmetry with
 * the rest of the pipeline is the point: a lerped sample sits on the straight line between its own
 * flanking detections, so it cannot carry a real extreme — all it can add is probability mass NEAR
 * one, which is exactly what walks an extreme quantile into an outlier cluster. A signal reduced by
 * a median or a mean has the opposite trade and keeps interpolated samples (`stepWidth`, the
 * bilateral-spread ratio below). Measured on a front-view clip where the detector missed ten
 * consecutive frames between two bad anchors: interpolation grew the outlier population from ~4
 * samples to ~14 and inflated this clip's SER 2.45x (`strides-kxn`).
 *
 * ⚠️ That bound is EXACT only when the two channels were reconstructed together. `interpolateChannel`
 * fills each keypoint independently, with its own run boundaries, and the measured quantity here is
 * `ankle.x − hip.x` — a difference of two channels. When both were lerped across the same run (the
 * whole-frame dropout that produced the measurement above) the difference is bounded by its own
 * anchors and the argument holds outright. When only one was, it need not: a lerped hip against a
 * DETECTED ankle is the sharp case, since the hip travels near-linearly across a short gap while the
 * ankle is the fast non-linear swing channel, so their difference can be a genuine extreme lying
 * outside both anchors' `relX`. The disjunction below discards it anyway.
 *
 * That is deliberate, and it is safe in one direction only — which is why this is the conservative
 * rule rather than the exact one. Excluding samples can only NARROW a range, never widen it, so the
 * worst case is an SER that reads low. A low SER pushes toward the front threshold or toward casting
 * no vote at all, so on a genuine side view the failure mode is degrade-to-ambiguous, never a
 * confident wrong label — the same asymmetry the whole two-signal agreement rule is built on.
 *
 * A percentile range rather than a plain min/max so that one stray detection cannot masquerade as
 * "large sagittal reach" — but that robustness is n-dependent rather than unconditional. The trim
 * discards roughly `ceil(0.05(n−1))` samples at each end, so it is worth one bad sample at n = 21,
 * two at n = 41, and NOTHING below `MIN_SAGITTAL_RANGE_SAMPLES`. Hence the floor: rather than
 * silently degrade into a min-max on a thin sample, this reports no range at all and lets the
 * caller treat the side as unavailable.
 */
function computeSagittalRange(
  frames: RobustPoseFrame[],
  ankleName: KeypointName,
  hipName: KeypointName,
): SagittalRange {
  const relX: number[] = []
  let interpolatedSamples = 0
  for (const frame of frames) {
    const ankle = resolvePoint(frame, ankleName)
    const hip = resolvePoint(frame, hipName)
    if (ankle === null || hip === null) continue
    if (ankle.interpolated || hip.interpolated) {
      interpolatedSamples += 1
      continue
    }
    relX.push(ankle.x - hip.x)
  }
  const detectedSamples = relX.length
  if (detectedSamples < MIN_SAGITTAL_RANGE_SAMPLES) {
    return { range: null, detectedSamples, interpolatedSamples }
  }
  return {
    range: percentile(relX, 0.95) - percentile(relX, 0.05),
    detectedSamples,
    interpolatedSamples,
  }
}

/**
 * The share of one side's resolvable ankle+hip samples that `computeSagittalRange` EXCLUDED as
 * interpolated; 0 when nothing was resolvable at all.
 *
 * Numerically the same statistic as `MetricResult.interpolatedFraction` — interpolated over
 * resolvable — reported for samples this signal DISCARDED rather than used. The number means the
 * same thing; only the consequence differs, and that difference is the discount-versus-exclude
 * rule above. It is NOT a complement: do not read it as `1 − interpolatedFraction`.
 */
function discardedFraction({ detectedSamples, interpolatedSamples }: SagittalRange): number {
  const resolvable = detectedSamples + interpolatedSamples
  return resolvable === 0 ? 0 : interpolatedSamples / resolvable
}

/**
 * The Bilateral Spread Ratio a dead-on SIDE view produces: the mediolateral body axis lies along
 * the optical axis, so the left and right shoulder (and hip) points project onto each other and
 * the spread collapses to zero. An exact geometric limit rather than an anatomical estimate —
 * it holds for every body build — which is why it is a module constant and its front-view
 * counterpart (`frontViewFullBilateralSpreadRatio`) is a config value.
 */
const SIDE_VIEW_FULL_BILATERAL_SPREAD_RATIO = 0

/**
 * The Sagittal Excursion Ratio a dead-on FRONT view produces: the anteroposterior body axis lies
 * along the optical axis, so the leg's whole fore-aft reach is hidden in depth and the ankle's
 * image-plane range relative to its own hip collapses to zero. The same kind of exact geometric
 * limit as `SIDE_VIEW_FULL_BILATERAL_SPREAD_RATIO`, for the other signal and the other view.
 */
const FRONT_VIEW_FULL_SAGITTAL_EXCURSION_RATIO = 0

/**
 * How far one signal sits past the threshold its committed view required, as a fraction of the
 * distance from that threshold to the value the signal takes with the camera in that view's IDEAL
 * position: 0 right at the decision boundary, 1 once the signal reads what a dead-on view of that
 * kind produces, clamped either side. Works in both directions — `fullSupport` below `threshold`
 * (the two collapse-to-zero limits above) or above it — because the sign cancels in the ratio.
 *
 * The `fullSupport` endpoint is the whole point of this helper, and the reason it replaced a pair
 * of one-sided helpers whose saturation was implicitly `0` in one direction and `2 * threshold` in
 * the other (`strides-2iw`). `2 * threshold` is not a derivation: for the front view's BSR it put
 * full support at 1.10, roughly twice the ~0.56 a dead-on front view of an adult runner can
 * physically produce, so the front branch of `confidence` saturated nowhere in the reachable range
 * and could not be compared with the side branch, which does saturate. Every endpoint here is now
 * either an exact projection limit or an anatomical measurement.
 *
 * A degenerate config whose threshold and full-support value coincide has no margin to report and
 * yields 0, rather than dividing by zero.
 */
function signalMargin(value: number, threshold: number, fullSupport: number): number {
  const span = fullSupport - threshold
  if (span === 0) return 0
  return clamp01((value - threshold) / span)
}

function computeCommittedConfidence(
  view: 'side' | 'front',
  bilateralSpreadRatio: number,
  sagittalExcursionRatio: number,
  sampleCoverage: number,
  config: HeuristicsConfig,
): number {
  const bsrMargin =
    view === 'side'
      ? signalMargin(
          bilateralSpreadRatio,
          config.sideViewMaxBilateralSpreadRatio,
          SIDE_VIEW_FULL_BILATERAL_SPREAD_RATIO,
        )
      : signalMargin(
          bilateralSpreadRatio,
          config.frontViewMinBilateralSpreadRatio,
          config.frontViewFullBilateralSpreadRatio,
        )
  const serMargin =
    view === 'side'
      ? signalMargin(
          sagittalExcursionRatio,
          config.sideViewMinSagittalExcursionRatio,
          config.sideViewFullSagittalExcursionRatio,
        )
      : signalMargin(
          sagittalExcursionRatio,
          config.frontViewMaxSagittalExcursionRatio,
          FRONT_VIEW_FULL_SAGITTAL_EXCURSION_RATIO,
        )

  return clamp01(((bsrMargin + serMargin) / 2) * sampleCoverage)
}

/**
 * The view, as an article-qualified noun phrase for user-facing copy: `'a side view'`,
 * `'a front view'`, `'an ambiguous view'`.
 *
 * Exists because eight metrics independently interpolated the view into a caveat as
 * `` `from a ${view} view` ``, which reads "from a ambiguous view" on the one label that takes
 * `an`. That branch is reachable in shipped output rather than theoretical: the background
 * MediaPipe scale pass can classify a clip `ambiguous` where the primary pass does not, and the
 * caveat then rides onto a grafted metric's card (`strides-fn4`).
 *
 * A helper rather than eight inline ternaries, and it lives here because this module owns what a
 * `View` means. Each metric keeps its own sentence — only the shared phrase moves.
 */
export function viewPhrase(view: View): string {
  return `${view === 'ambiguous' ? 'an' : 'a'} ${view} view`
}

/**
 * Classifies a clip's camera framing from keypoint geometry/motion alone (no face keypoints
 * exist in this pipeline). Two independent signals must AGREE before committing to a label:
 *
 * - Bilateral Spread Ratio (BSR): how far apart the left/right shoulder and hip points are,
 *   relative to torso length. Side view collapses this toward zero (camera looks along the
 *   mediolateral axis, so left/right nearly coincide); front view keeps it large (full shoulder
 *   /hip width is visible).
 * - Sagittal Excursion Ratio (SER): how far each ankle ranges relative to its own hip over the
 *   clip, relative to torso length, measured over that side's DIRECTLY-DETECTED samples only and
 *   reported for a side at all only once there are enough of them (`computeSagittalRange`). Side
 *   view shows the leg's full fore-aft reach in the image plane (large range); front view hides
 *   that reach in depth, leaving only minor mediolateral sway (small range).
 *
 * Requiring agreement is deliberate: a confident wrong label would corrupt every downstream
 * metric's view-fit gating silently, whereas an honest "ambiguous" just degrades confidence.
 *
 * The committed label is a SUMMARY. What gates metrics is `plausibility` — the same two signals
 * expressed as a weighting over the three views (`viewPlausibility.ts`), which
 * `computeFormHeuristics` resolves the view-fit table against. That distinction is why this
 * function's own vote/margin arithmetic below is unchanged by that gating change: a clip that
 * commits to a label here is one whose plausibility is one-hot on the same label, so the two
 * agree exactly wherever a label exists at all, and the weighting only says something new in the
 * undecided bands where the votes fall silent.
 *
 * `confidence` is a MARGIN and is now on the same scale for both labels: every one of the four
 * per-(view, signal) margins runs from that view's own decision threshold to the value the signal
 * takes with the camera dead-on for that view, so a perfect clip of either kind reaches 1 and a
 * clip sitting on its own boundary reads 0 (`signalMargin` above). It was not comparable before
 * `strides-2iw`: the front view's BSR margin saturated at twice its threshold, a value no human
 * body can produce, capping a flawless front clip near 0.5 while a side clip routinely read 0.77.
 */
export function detectView(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): ViewDetectionResult {
  const bodyScale = estimateBodyScale(frames)

  if (
    bodyScale === null ||
    bodyScale.sampleCoverage < config.minViewDetectionFrameCoverage
  ) {
    return {
      view: 'ambiguous',
      confidence: 0,
      // Coverage GATES the plausibility rather than weighting it (see `computeViewPlausibility`):
      // too little body-scale sample to classify from at all, so no view is supported.
      plausibility: AMBIGUOUS_VIEW_PLAUSIBILITY,
      diagnostics: {
        bilateralSpreadRatio: null,
        sagittalExcursionRatio: null,
        // Nothing was measured on this path at all, so the sagittal population is empty on both
        // sides rather than merely below the floor.
        sagittalExcursionSampleCount: { left: 0, right: 0 },
        sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
        frameCoverage: bodyScale?.sampleCoverage ?? 0,
      },
    }
  }

  const { torsoLengthPx, sampleCoverage } = bodyScale

  const bsrSamples: number[] = []
  for (const frame of frames) {
    const shoulders = resolveBilateralPair(frame, 'left_shoulder', 'right_shoulder')
    const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
    if (shoulders === null || hips === null) continue
    const shoulderSpread = Math.abs(shoulders.left.x - shoulders.right.x)
    const hipSpread = Math.abs(hips.left.x - hips.right.x)
    bsrSamples.push((shoulderSpread + hipSpread) / (2 * torsoLengthPx))
  }
  const bilateralSpreadRatio = bsrSamples.length > 0 ? median(bsrSamples) : null

  const sagittalLeft = computeSagittalRange(frames, 'left_ankle', 'left_hip')
  const sagittalRight = computeSagittalRange(frames, 'right_ankle', 'right_hip')
  const ranges = [sagittalLeft.range, sagittalRight.range].filter(
    (r): r is number => r !== null,
  )
  const sagittalExcursionRatio =
    ranges.length > 0 ? mean(ranges) / torsoLengthPx : null

  let sideVotes = 0
  let frontVotes = 0
  if (bilateralSpreadRatio !== null) {
    if (bilateralSpreadRatio <= config.sideViewMaxBilateralSpreadRatio) sideVotes += 1
    else if (bilateralSpreadRatio >= config.frontViewMinBilateralSpreadRatio) frontVotes += 1
  }
  if (sagittalExcursionRatio !== null) {
    if (sagittalExcursionRatio >= config.sideViewMinSagittalExcursionRatio) sideVotes += 1
    else if (sagittalExcursionRatio <= config.frontViewMaxSagittalExcursionRatio) frontVotes += 1
  }

  let view: View
  if (sideVotes === 2 && frontVotes === 0) view = 'side'
  else if (frontVotes === 2 && sideVotes === 0) view = 'front'
  else view = 'ambiguous'

  let confidence = 0
  if (view === 'ambiguous') {
    // Explicit simplification: when the two signals disagree, are individually inconclusive, or
    // are unavailable, there's no principled per-signal margin to average — a flat, coverage-
    // scaled confidence stands in rather than a value that would falsely imply precision.
    confidence = clamp01(0.3 * sampleCoverage)
  } else if (bilateralSpreadRatio !== null && sagittalExcursionRatio !== null) {
    confidence = computeCommittedConfidence(
      view,
      bilateralSpreadRatio,
      sagittalExcursionRatio,
      sampleCoverage,
      config,
    )
  }

  return {
    view,
    confidence,
    plausibility: computeViewPlausibility(
      bilateralSpreadRatio,
      sagittalExcursionRatio,
      config,
    ),
    diagnostics: {
      bilateralSpreadRatio,
      sagittalExcursionRatio,
      sagittalExcursionSampleCount: {
        left: sagittalLeft.detectedSamples,
        right: sagittalRight.detectedSamples,
      },
      sagittalExcursionInterpolatedFraction: {
        left: discardedFraction(sagittalLeft),
        right: discardedFraction(sagittalRight),
      },
      frameCoverage: sampleCoverage,
    },
  }
}
