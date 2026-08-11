import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { resolveMidpoint } from './keypoints'
import { computeMetricConfidence } from './confidence'
import { median } from './mathUtils'

/**
 * A judgment-call minimum frame count for a stable median lean estimate — analogous in spirit to
 * `verticalOscillationMinCycles`, but scoped to its own constant because trunk lean's sample unit
 * is resolvable frames, not gait half-cycles, so the two aren't the same quantity. Not derived
 * from real footage; cheaply tunable here if it turns out to be wrong.
 */
const MIN_TRUNK_LEAN_SAMPLE_SIZE = 10

function nullResult(viewFit: MetricResult['viewFit'], caveat: string): MetricResult {
  return {
    metric: 'trunkLean',
    value: null,
    unit: 'degrees',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Forward/backward trunk lean, in degrees, positive = leaning in the direction of travel.
 * Hard-gated to side view: this is fundamentally a sagittal-plane rotation. Viewed face-on, any
 * apparent shoulder/hip x-offset reflects side-bend or arm-swing rotation, not fore-aft lean —
 * front view doesn't just make this measurement noisier, it measures a different physical
 * quantity entirely. Per "never a silent wrong number", the value is still computed and returned
 * even when the view is unsuitable (`viewFitTable.trunkLean` caps confidence low instead); ticket
 * #8's results view decides whether to hide it outright.
 */
export function computeTrunkLean(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.trunkLean[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const travelDirection = estimateTravelDirection(frames, bodyScale)
  const travelDirectionKnown = travelDirection !== 0

  let interpolatedCount = 0
  const leanValues: number[] = []
  for (const frame of frames) {
    const shoulderMid = resolveMidpoint(frame, 'left_shoulder', 'right_shoulder')
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (shoulderMid === null || hipMid === null) continue

    const dx = shoulderMid.x - hipMid.x
    const dy = shoulderMid.y - hipMid.y
    // atan2(dx, -dy): image-y grows downward, so "up" (an upright torso) is -dy. This reads 0deg
    // upright, with a sign that reflects which screen-x side the torso leans toward — a purely
    // screen-relative quantity until travelDirection converts it into a travel-relative
    // forward(+)/backward(-) one below.
    const leanAngleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI
    const forwardLeanDeg = travelDirectionKnown
      ? leanAngleDeg * travelDirection
      : leanAngleDeg

    if (shoulderMid.interpolated || hipMid.interpolated) interpolatedCount += 1
    leanValues.push(forwardLeanDeg)
  }

  if (leanValues.length === 0) {
    return nullResult(viewFitEntry.fit, 'No resolvable torso position in this clip.')
  }

  const frameCoverage = leanValues.length / frames.length
  const interpolatedFraction = interpolatedCount / leanValues.length
  const value = median(leanValues)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: leanValues.length,
    minRequiredSampleSize: MIN_TRUNK_LEAN_SAMPLE_SIZE,
    travelDirectionKnown,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (!travelDirectionKnown) {
    caveats.push(
      'Direction of travel could not be determined (no net horizontal displacement) — lean sign may not reflect forward/backward.',
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Trunk lean is a sagittal-plane measurement and is not reliable from a ${view} view.`,
    )
  }

  return {
    metric: 'trunkLean',
    value,
    unit: 'degrees',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: leanValues.length,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
  }
}
