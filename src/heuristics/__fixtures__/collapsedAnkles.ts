import type { RobustPoseFrame } from '../../pose/robustness/types'
import { resolvePoint } from '../keypoints'

/**
 * Rewrites the two ankles at the given frames so they sit `separationPx` apart VERTICALLY —
 * the collapsed-ankle pose `strides-1mt` measured on the Demo 1 track clip, reproduced surgically.
 *
 * Both ankles are moved symmetrically about their own midpoint, and the SIGN of the original
 * difference is preserved. That keeps everything except the ankle separation identical: the hips
 * and therefore the fitted bounce are untouched, so the phase path predicts the same instants; and
 * the side-attribution vote keeps its direction, contributing less rather than differently. A test
 * built on this isolates the ankle pair and nothing else.
 *
 * `separationPx` defaults to 0 — both labels on exactly one point, the extreme of the failure. Pass
 * a value to probe the floor itself rather than the degenerate case.
 */
export function withCollapsedAnklesAt(
  frames: RobustPoseFrame[],
  frameIndices: number[],
  separationPx = 0,
): RobustPoseFrame[] {
  const targets = new Set(frameIndices)
  return frames.map((frame, index) => {
    if (!targets.has(index)) return frame
    const left = resolvePoint(frame, 'left_ankle')
    const right = resolvePoint(frame, 'right_ankle')
    if (left === null || right === null) return frame
    const midY = (left.y + right.y) / 2
    const halfGap = (Math.sign(left.y - right.y) || 1) * (separationPx / 2)
    return {
      ...frame,
      keypoints: frame.keypoints.map((keypoint) => {
        if (keypoint.name === 'left_ankle') return { ...keypoint, y: midY + halfGap }
        if (keypoint.name === 'right_ankle') return { ...keypoint, y: midY - halfGap }
        return keypoint
      }),
    }
  })
}

/**
 * Scales the vertical gap between the two ankles by `factor` on EVERY frame, about each frame's own
 * ankle midpoint. Unlike `withCollapsedAnklesAt` this leaves no frame with a healthy pair, which is
 * what makes it able to ask whether a clip whose every strike is unmeasurable still reports those
 * strikes rather than quietly changing detector.
 */
export function withAnkleSeparationScaled(
  frames: RobustPoseFrame[],
  factor: number,
): RobustPoseFrame[] {
  return frames.map((frame) => {
    const left = resolvePoint(frame, 'left_ankle')
    const right = resolvePoint(frame, 'right_ankle')
    if (left === null || right === null) return frame
    const midY = (left.y + right.y) / 2
    return {
      ...frame,
      keypoints: frame.keypoints.map((keypoint) => {
        if (keypoint.name === 'left_ankle') return { ...keypoint, y: midY + (left.y - midY) * factor }
        if (keypoint.name === 'right_ankle')
          return { ...keypoint, y: midY + (right.y - midY) * factor }
        return keypoint
      }),
    }
  })
}

/** Makes the RIGHT ankle unrecoverable at the given frames, leaving every other keypoint alone —
 * the "no contralateral ankle to compare against" case the separation floor passes by rule. */
export function withUnrecoverableRightAnkleAt(
  frames: RobustPoseFrame[],
  frameIndices: number[],
): RobustPoseFrame[] {
  const targets = new Set(frameIndices)
  return frames.map((frame, index) =>
    !targets.has(index)
      ? frame
      : {
          ...frame,
          keypoints: frame.keypoints.map((keypoint) =>
            keypoint.name === 'right_ankle'
              ? { ...keypoint, x: null, y: null, score: 0, status: 'unrecoverable' as const }
              : keypoint,
          ),
        },
  )
}
