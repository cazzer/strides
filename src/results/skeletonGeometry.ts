import type { KeypointName } from '../pose/types'
import type {
  KeypointStatus,
  RobustKeypoint,
  RobustPoseFrame,
} from '../pose/robustness/types'

export const SKELETON_EDGES: [KeypointName, KeypointName][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]

/** Full opacity for a directly-detected point/edge. */
export const DETECTED_OPACITY = 1
/** Reduced opacity for an interpolated point/edge — visibly less certain, still visible. */
export const INTERPOLATED_OPACITY = 0.35

export interface PointDrawOp {
  kind: 'point'
  name: KeypointName
  x: number
  y: number
  opacity: number
}

export interface EdgeDrawOp {
  kind: 'edge'
  from: KeypointName
  to: KeypointName
  x1: number
  y1: number
  x2: number
  y2: number
  opacity: number
}

export type DrawOp = PointDrawOp | EdgeDrawOp

/** `null` for `'unrecoverable'` — the caller skips drawing entirely rather than drawing at 0
 * opacity, matching the ticket's "unrecoverable points/edges touching them are skipped
 * entirely" requirement (as opposed to merely invisible-but-present). */
function opacityForStatus(status: KeypointStatus): number | null {
  switch (status) {
    case 'detected':
      return DETECTED_OPACITY
    case 'interpolated':
      return INTERPOLATED_OPACITY
    case 'unrecoverable':
      return null
  }
}

/**
 * Binary search over `frames` (assumed sorted by timestamp — true since `useVideoAnalysis`
 * sorts samples before storing) for the frame whose timestamp is nearest `t`. `null` only if
 * `frames` is empty.
 */
export function findNearestFrame(
  frames: RobustPoseFrame[],
  t: number,
): RobustPoseFrame | null {
  if (frames.length === 0) return null

  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].timestamp < t) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }

  if (lo === 0) return frames[0]
  const candidate = frames[lo]
  const prev = frames[lo - 1]
  return Math.abs(candidate.timestamp - t) < Math.abs(prev.timestamp - t)
    ? candidate
    : prev
}

/**
 * Maps one `RobustPoseFrame` to a flat list of point/edge draw instructions, carrying an
 * opacity derived from each point's `RobustKeypoint.status`. Pure and canvas-free by design —
 * `HTMLCanvasElement.getContext('2d')` returns `null` in jsdom (no native canvas package in
 * this repo, an accepted CI/sandbox constraint), so this is what makes "overlay renders
 * keypoints matching a fixture PoseFrame sequence" unit-testable at all.
 *
 * `'unrecoverable'` points are skipped entirely (never drawn, not even faintly), and any edge
 * touching an unrecoverable endpoint is skipped too — there's no real position to draw the
 * edge to/from. An edge's opacity is the weaker (lower) of its two endpoints' opacities.
 */
export function toDrawOps(frame: RobustPoseFrame): DrawOp[] {
  const ops: DrawOp[] = []
  const byName = new Map<KeypointName, RobustKeypoint>(
    frame.keypoints.map((kp) => [kp.name, kp]),
  )

  for (const kp of frame.keypoints) {
    const opacity = opacityForStatus(kp.status)
    if (opacity === null || kp.x === null || kp.y === null) continue
    ops.push({ kind: 'point', name: kp.name, x: kp.x, y: kp.y, opacity })
  }

  for (const [from, to] of SKELETON_EDGES) {
    const kpFrom = byName.get(from)
    const kpTo = byName.get(to)
    if (!kpFrom || !kpTo) continue

    const opacityFrom = opacityForStatus(kpFrom.status)
    const opacityTo = opacityForStatus(kpTo.status)
    if (
      opacityFrom === null ||
      opacityTo === null ||
      kpFrom.x === null ||
      kpFrom.y === null ||
      kpTo.x === null ||
      kpTo.y === null
    ) {
      continue
    }

    ops.push({
      kind: 'edge',
      from,
      to,
      x1: kpFrom.x,
      y1: kpFrom.y,
      x2: kpTo.x,
      y2: kpTo.y,
      opacity: Math.min(opacityFrom, opacityTo),
    })
  }

  return ops
}
