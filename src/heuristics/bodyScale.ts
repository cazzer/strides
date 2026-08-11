import type { RobustPoseFrame } from '../pose/robustness/types'
import { resolveMidpoint } from './keypoints'
import { distance, median } from './mathUtils'

export interface BodyScale {
  torsoLengthPx: number
  sampleCoverage: number
}

/**
 * Torso length (shoulder-mid to hip-mid) is THE shared normalizer for view detection and all
 * three heuristics — deliberately not shoulder width or leg length. Shoulder width collapses
 * toward zero in side view (the camera looks straight along the mediolateral axis), which would
 * make it a degenerate denominator exactly in the view where these metrics matter most. Leg
 * length is itself modulated by the gait cycle being measured (a leg's apparent length changes
 * as the knee flexes through a stride), so normalizing by it would be quietly circular. Torso
 * length stays roughly constant across a stride and non-degenerate from either camera angle.
 *
 * Uses the median across all frames where both shoulder-mid and hip-mid resolve, rather than the
 * mean, so that a handful of frames with a badly-placed interpolated point don't drag the scale
 * estimate away from the runner's real proportions.
 */
export function estimateBodyScale(frames: RobustPoseFrame[]): BodyScale | null {
  const lengths: number[] = []

  for (const frame of frames) {
    const shoulderMid = resolveMidpoint(frame, 'left_shoulder', 'right_shoulder')
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (shoulderMid === null || hipMid === null) continue
    lengths.push(distance(shoulderMid, hipMid))
  }

  if (lengths.length === 0) return null

  return {
    torsoLengthPx: median(lengths),
    sampleCoverage: lengths.length / frames.length,
  }
}
