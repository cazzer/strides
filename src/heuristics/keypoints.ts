import type { KeypointName } from '../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'

export interface ResolvedPoint {
  x: number
  y: number
  interpolated: boolean
}

function findKeypoint(frame: RobustPoseFrame, name: KeypointName): RobustKeypoint {
  const kp = frame.keypoints.find((k) => k.name === name)
  if (!kp) {
    // RobustPoseFrame.keypoints is documented as one entry per name in COMMON_KEYPOINT_NAMES, in
    // that fixed order, never sparse — this can only happen if that invariant was violated
    // upstream.
    throw new Error(`keypoint "${name}" missing from RobustPoseFrame`)
  }
  return kp
}

/** A keypoint is resolvable when it has a real position — `'detected'` or `'interpolated'`, per
 * the robustness layer's contract that only `'unrecoverable'` keypoints carry null coordinates. */
export function resolvePoint(
  frame: RobustPoseFrame,
  name: KeypointName,
): ResolvedPoint | null {
  const kp = findKeypoint(frame, name)
  if (kp.x === null || kp.y === null) return null
  return { x: kp.x, y: kp.y, interpolated: kp.status === 'interpolated' }
}

/**
 * Tolerant midpoint resolution, used for hip-mid/shoulder-mid tracking (center-of-mass proxies
 * for vertical oscillation and trunk lean). Falls back to whichever single side is resolvable
 * rather than discarding the whole frame when the other side is briefly occluded — losing a
 * whole frame of center-of-mass tracking because one side dropped out for an instant would waste
 * data that's still perfectly usable as an approximation.
 *
 * The single-side fallback is always flagged `interpolated: true`, regardless of that point's
 * own status. This is a deliberate choice: standing in one side for the true bilateral average is
 * itself an approximation of the same "trust this a little less" character as temporal
 * interpolation, even when the single point itself was directly detected — so it should feed the
 * same downstream confidence discount rather than reading as fully trustworthy.
 */
export function resolveMidpoint(
  frame: RobustPoseFrame,
  leftName: KeypointName,
  rightName: KeypointName,
): ResolvedPoint | null {
  const left = resolvePoint(frame, leftName)
  const right = resolvePoint(frame, rightName)

  if (left !== null && right !== null) {
    return {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2,
      interpolated: left.interpolated || right.interpolated,
    }
  }
  if (left !== null) return { x: left.x, y: left.y, interpolated: true }
  if (right !== null) return { x: right.x, y: right.y, interpolated: true }
  return null
}

/**
 * Strict bilateral resolution: both sides must be independently resolvable, or the whole result
 * is null. Used only where an actual left/right separation IS the measured signal — view
 * detection's bilateral-spread ratio needs two real points to form a meaningful "spread"; a
 * spread computed against a single stand-in point (as `resolveMidpoint` would tolerate) would be
 * meaningless rather than merely approximate.
 */
export function resolveBilateralPair(
  frame: RobustPoseFrame,
  leftName: KeypointName,
  rightName: KeypointName,
): { left: { x: number; y: number }; right: { x: number; y: number } } | null {
  const left = resolvePoint(frame, leftName)
  const right = resolvePoint(frame, rightName)
  if (left === null || right === null) return null
  return {
    left: { x: left.x, y: left.y },
    right: { x: right.x, y: right.y },
  }
}
