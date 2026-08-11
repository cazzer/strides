import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, View, ViewDetectionResult } from './types'
import { estimateBodyScale } from './bodyScale'
import { resolveBilateralPair, resolvePoint } from './keypoints'
import { clamp01, mean, median, percentile } from './mathUtils'

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

/** 1 at the "obviously in-band" extreme (value at/near 0), 0 right at the threshold boundary. */
function marginTowardZero(value: number, threshold: number): number {
  if (threshold <= 0) return 0
  return clamp01((threshold - value) / threshold)
}

/** 0 right at the threshold boundary, approaching 1 as value grows to roughly 2x the threshold. */
function marginAwayFromZero(value: number, threshold: number): number {
  if (threshold <= 0) return 0
  return clamp01((value - threshold) / threshold)
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
      ? marginTowardZero(bilateralSpreadRatio, config.sideViewMaxBilateralSpreadRatio)
      : marginAwayFromZero(bilateralSpreadRatio, config.frontViewMinBilateralSpreadRatio)
  const serMargin =
    view === 'side'
      ? marginAwayFromZero(sagittalExcursionRatio, config.sideViewMinSagittalExcursionRatio)
      : marginTowardZero(sagittalExcursionRatio, config.frontViewMaxSagittalExcursionRatio)

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
    diagnostics: {
      bilateralSpreadRatio,
      sagittalExcursionRatio,
      frameCoverage: sampleCoverage,
    },
  }
}
