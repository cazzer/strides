import { COMMON_KEYPOINT_NAMES } from '../types'
import type { Keypoint, PoseFrame } from '../types'

export type RawKeypointState =
  | { kind: 'present'; keypoint: Keypoint }
  | { kind: 'missing' }

export function classifyFrame(
  frame: PoseFrame | null,
  minConfidence: number,
): RawKeypointState[] {
  if (frame === null) {
    return COMMON_KEYPOINT_NAMES.map(() => ({ kind: 'missing' }))
  }

  return frame.keypoints.map((keypoint) =>
    keypoint.score >= minConfidence
      ? { kind: 'present', keypoint }
      : { kind: 'missing' },
  )
}
