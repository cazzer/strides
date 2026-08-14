import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateHipWidth } from './bodyScale'
import { resolveMidpoint, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of footstrikes (two per leg) — a judgment-call minimum for
 * a stable median step-width ratio, chosen for the same reason as overstriding's identical
 * minimum: fewer strikes than this is too easily dominated by a single noisy detection.
 */
const MIN_STEP_WIDTH_SAMPLE_SIZE = 4

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

const HIP_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_hip',
  right: 'right_hip',
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'stepWidth',
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
 * At each footstrike, the signed lateral offset of the ankle from the hip-midline, as a fraction
 * of hip width. Sign: POSITIVE = foot landed on its own anatomical side of the midline; NEGATIVE
 * = crossed to the opposite side (crossover gait). Polarity is resolved per-footstrike from that
 * frame's own-side hip position relative to hip-mid — NOT from a clip-wide travelDirection-style
 * constant (that solves a different, fore-aft problem) — because a raw, unflipped ankle.x -
 * hipMid.x combined across both legs cancels toward ~0 for any symmetric gait, destroying the
 * crossover signal this metric exists to report.
 */
export function computeStepWidth(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.stepWidth[view]
  const hipWidth = estimateHipWidth(frames)
  if (hipWidth === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable hip-width reference (left/right hip) in this clip.',
    )
  }
  const { hipWidthPx } = hipWidth

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)
  if (candidates.length === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  let interpolatedCount = 0
  const offsetRatios: number[] = []
  for (const candidate of candidates) {
    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, ANKLE_NAME[candidate.side])
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    const sideHip = resolvePoint(frame, HIP_NAME[candidate.side])
    if (ankle === null || hipMid === null || sideHip === null) continue

    const dx = ankle.x - hipMid.x
    const outwardSign = Math.sign(sideHip.x - hipMid.x) || 1 // guarded: never multiply by 0
    offsetRatios.push((dx * outwardSign) / hipWidthPx)
    if (ankle.interpolated || hipMid.interpolated || sideHip.interpolated) {
      interpolatedCount += 1
    }
  }

  const usableStrikeCount = offsetRatios.length
  // Event-sampled metric, same convention as overstriding's frameCoverage: what fraction of
  // ankle-detected candidate footstrikes also had a resolvable hip position at that same instant.
  const frameCoverage = usableStrikeCount / candidates.length

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Footstrikes were detected, but hip position was not resolvable at any of them.',
      frameCoverage,
    )
  }

  const interpolatedFraction = interpolatedCount / usableStrikeCount
  const value = median(offsetRatios)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: usableStrikeCount,
    minRequiredSampleSize: MIN_STEP_WIDTH_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Step width is a mediolateral measurement and is not reliable from a ${view} view.`,
    )
  }
  if (usableStrikeCount < MIN_STEP_WIDTH_SAMPLE_SIZE) {
    caveats.push(
      `Only ${usableStrikeCount} footstrike(s) detected (recommend at least ${MIN_STEP_WIDTH_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }
  if (value < 0) {
    caveats.push(
      "This clip's footstrikes tend to cross the body's midline (crossover gait) rather than landing on their own side.",
    )
  }

  return {
    metric: 'stepWidth',
    value,
    unit: 'percent',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
  }
}
