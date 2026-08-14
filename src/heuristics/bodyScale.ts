import type { RobustPoseFrame } from '../pose/robustness/types'
import { resolveBilateralPair, resolveMidpoint } from './keypoints'
import { distance, median } from './mathUtils'

export interface BodyScale {
  torsoLengthPx: number
  sampleCoverage: number
}

export interface HipWidth {
  hipWidthPx: number
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

/**
 * Left-right hip separation (median across frames) — `stepWidth`'s denominator, a different scale
 * reference from `estimateBodyScale`'s torso length. Uses `resolveBilateralPair`, the same strict
 * (both-sides-must-resolve) primitive `viewDetection.ts` uses for its own inline bilateral-spread
 * calc — reused here rather than reimplemented, but kept a separate function from
 * `estimateBodyScale` since the two are independent scale references over different keypoint pairs
 * with their own reduction order; not shared code with `viewDetection.ts` itself, which blends
 * hip+shoulder spread in a different reduction and would change its math if refactored to call
 * this.
 */
export function estimateHipWidth(frames: RobustPoseFrame[]): HipWidth | null {
  const widths: number[] = []

  for (const frame of frames) {
    const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
    if (hips === null) continue
    widths.push(Math.abs(hips.left.x - hips.right.x))
  }

  if (widths.length === 0) return null

  return {
    hipWidthPx: median(widths),
    sampleCoverage: widths.length / frames.length,
  }
}
