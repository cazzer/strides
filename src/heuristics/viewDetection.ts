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
 * Per-side sagittal excursion range: the p95-p5 spread of that side's ankle position relative to
 * its own hip (which cancels whole-body camera pan, leaving only the leg's own reach). Percentile
 * range rather than plain min/max specifically to stay robust to one bad detection blowing the
 * range out — a single wildly-off ankle sample shouldn't be able to masquerade as "large sagittal
 * reach".
 */
function computeSagittalRange(
  frames: RobustPoseFrame[],
  ankleName: KeypointName,
  hipName: KeypointName,
): number | null {
  const relX: number[] = []
  for (const frame of frames) {
    const ankle = resolvePoint(frame, ankleName)
    const hip = resolvePoint(frame, hipName)
    if (ankle === null || hip === null) continue
    relX.push(ankle.x - hip.x)
  }
  if (relX.length === 0) return null
  return percentile(relX, 0.95) - percentile(relX, 0.05)
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
 * Classifies a clip's camera framing from keypoint geometry/motion alone (no face keypoints
 * exist in this pipeline). Two independent signals must AGREE before committing to a label:
 *
 * - Bilateral Spread Ratio (BSR): how far apart the left/right shoulder and hip points are,
 *   relative to torso length. Side view collapses this toward zero (camera looks along the
 *   mediolateral axis, so left/right nearly coincide); front view keeps it large (full shoulder
 *   /hip width is visible).
 * - Sagittal Excursion Ratio (SER): how far each ankle ranges relative to its own hip over the
 *   clip, relative to torso length. Side view shows the leg's full fore-aft reach in the image
 *   plane (large range); front view hides that reach in depth, leaving only minor mediolateral
 *   sway (small range).
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

  const rangeLeft = computeSagittalRange(frames, 'left_ankle', 'left_hip')
  const rangeRight = computeSagittalRange(frames, 'right_ankle', 'right_hip')
  const ranges = [rangeLeft, rangeRight].filter((r): r is number => r !== null)
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
      frameCoverage: sampleCoverage,
    },
  }
}
