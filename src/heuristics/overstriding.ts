import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { resolveMidpoint, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of footstrikes (two per leg) — a judgment-call minimum for
 * a stable median overstride ratio, chosen for the same reason as `verticalOscillationMinCycles`:
 * fewer strikes than this is too easily dominated by a single noisy detection.
 */
const MIN_OVERSTRIDE_SAMPLE_SIZE = 4

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'overstriding',
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
 * Overstriding: at each footstrike, how far ahead of the hip (in the direction of travel) the
 * foot lands, as a fraction of torso length. Positive = foot lands ahead of the hip.
 * Hard-gated to side view, for the same reasoning as trunk lean but with a worse failure mode:
 * front-view ankle-x-offset reflects mediolateral foot placement, not fore-aft reach, and could
 * coincidentally look like a "good" (small) number rather than an obviously-wrong one.
 */
export function computeOverstriding(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.overstriding[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const { torsoLengthPx } = bodyScale
  const travelDirection = estimateTravelDirection(frames, bodyScale)
  const travelDirectionKnown = travelDirection !== 0

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)

  const candidateStrikeCount = candidates.length
  if (candidateStrikeCount === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  let interpolatedCount = 0
  const overstrideRatios: number[] = []
  for (const candidate of candidates) {
    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, ANKLE_NAME[candidate.side])
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (ankle === null || hipMid === null) continue

    const dx = ankle.x - hipMid.x
    const horizontalOffsetPx = travelDirectionKnown ? dx * travelDirection : dx
    overstrideRatios.push(horizontalOffsetPx / torsoLengthPx)
    if (ankle.interpolated || hipMid.interpolated) interpolatedCount += 1
  }

  const usableStrikeCount = overstrideRatios.length
  // Event-sampled metric: "coverage" here means what fraction of ankle-detected candidate
  // footstrikes also had a resolvable hip position at that same instant — not the per-frame ratio
  // the other heuristics use. There's no meaningful "fraction of all frames" for a measure that
  // only exists at discrete footstrike events.
  const frameCoverage = usableStrikeCount / candidateStrikeCount

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Footstrikes were detected, but hip position was not resolvable at any of them.',
      frameCoverage,
    )
  }

  const interpolatedFraction = interpolatedCount / usableStrikeCount
  const value = median(overstrideRatios)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: usableStrikeCount,
    minRequiredSampleSize: MIN_OVERSTRIDE_SAMPLE_SIZE,
    travelDirectionKnown,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (!travelDirectionKnown) {
    caveats.push(
      'Direction of travel could not be determined (no net horizontal displacement) — overstride sign may not reflect forward/backward.',
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Overstriding is a fore-aft measurement and is not reliable from a ${view} view.`,
    )
  }
  if (usableStrikeCount < MIN_OVERSTRIDE_SAMPLE_SIZE) {
    caveats.push(
      `Only ${usableStrikeCount} footstrike(s) detected (recommend at least ${MIN_OVERSTRIDE_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  return {
    metric: 'overstriding',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
  }
}
