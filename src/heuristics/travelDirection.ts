import type { RobustPoseFrame } from '../pose/robustness/types'
import { resolveMidpoint } from './keypoints'

/**
 * Sign of net hip-x displacement between the first and last frame where hip-mid resolves at all
 * — deliberately not a fit over the whole trajectory, since a runner's hip-x is expected to
 * advance roughly monotonically and the endpoints alone are enough to tell which way.
 *
 * Returns `0` (indeterminate) when that net displacement is smaller than half a torso length.
 * This covers two real cases this pipeline needs to not misinterpret as a direction: treadmill /
 * in-place footage (no real horizontal travel at all), and front-view clips where genuine
 * sagittal travel is simply invisible as x-motion. Half a torso length is a judgment-call noise
 * floor — small enough not to swallow real slow-jog footage, large enough that ordinary frame-to-
 * frame jitter in hip-mid tracking can't masquerade as "travel".
 */
export function estimateTravelDirection(
  frames: RobustPoseFrame[],
  bodyScale: { torsoLengthPx: number },
): 1 | -1 | 0 {
  let first: { x: number } | null = null
  let last: { x: number } | null = null

  for (const frame of frames) {
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (hipMid === null) continue
    if (first === null) first = hipMid
    last = hipMid
  }

  if (first === null || last === null) return 0

  const displacement = last.x - first.x
  if (Math.abs(displacement) < 0.5 * bodyScale.torsoLengthPx) return 0
  return displacement > 0 ? 1 : -1
}
