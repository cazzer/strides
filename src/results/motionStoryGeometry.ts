import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { CropRectPx } from '../pose/backends/movenetCrop'
import { findNearestFrame } from './skeletonGeometry'

export type StoryPoints = Partial<Record<KeypointName, { x: number; y: number; inferred?: boolean }>>

export const REFERENCE_POINTS: StoryPoints = {
  nose: { x: 153, y: 48 },
  left_ear: { x: 140, y: 47 }, right_ear: { x: 166, y: 47 },
  left_shoulder: { x: 132, y: 82 }, right_shoulder: { x: 171, y: 84 },
  left_elbow: { x: 111, y: 121 }, right_elbow: { x: 196, y: 115 },
  left_wrist: { x: 139, y: 140 }, right_wrist: { x: 181, y: 138 },
  left_hip: { x: 142, y: 155 }, right_hip: { x: 168, y: 155 },
  left_knee: { x: 102, y: 202 }, right_knee: { x: 208, y: 197 },
  left_ankle: { x: 140, y: 261 }, right_ankle: { x: 215, y: 253 },
  left_heel: { x: 129, y: 269 }, right_heel: { x: 206, y: 261 },
  left_foot_index: { x: 158, y: 271 }, right_foot_index: { x: 237, y: 264 },
}

/** Opposite stride phase: the limbs change their joint positions, not just the figure's position. */
export const REFERENCE_POINTS_SECOND: StoryPoints = {
  ...REFERENCE_POINTS,
  left_elbow: { x: 194, y: 119 }, right_elbow: { x: 111, y: 117 },
  left_wrist: { x: 177, y: 139 }, right_wrist: { x: 139, y: 139 },
  left_knee: { x: 211, y: 198 }, right_knee: { x: 104, y: 203 },
  left_ankle: { x: 220, y: 251 }, right_ankle: { x: 137, y: 262 },
  left_heel: { x: 211, y: 260 }, right_heel: { x: 126, y: 270 },
  left_foot_index: { x: 239, y: 262 }, right_foot_index: { x: 157, y: 272 },
}

const BODY_NAMES: KeypointName[] = [
  'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
]

/** The evidence image is a square crop of native video pixels; use that exact crop as the
 * projection, so the solid trace stays aligned with its copied (possibly ghosted) footage. */
export function pointsForFrame(frame: RobustPoseFrame, crop: CropRectPx | null): StoryPoints | null {
  const valid = frame.keypoints.filter(
    (point) => point.status !== 'unrecoverable' && point.x !== null && point.y !== null,
  )
  if (BODY_NAMES.filter((name) => valid.some((point) => point.name === name)).length < 6) return null

  let x0: number, y0: number, side: number
  if (crop) {
    x0 = crop.x; y0 = crop.y; side = crop.side
  } else {
    const xs = valid.map((point) => point.x as number)
    const ys = valid.map((point) => point.y as number)
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1)
    side = span * 1.3
    x0 = (Math.min(...xs) + Math.max(...xs) - side) / 2
    y0 = (Math.min(...ys) + Math.max(...ys) - side) / 2
  }
  if (!Number.isFinite(side) || side <= 0) return null
  return Object.fromEntries(valid.map((point) => [point.name, {
    x: ((point.x as number) - x0) * 320 / side,
    y: ((point.y as number) - y0) * 320 / side,
    inferred: point.status === 'interpolated',
  }])) as StoryPoints
}

export function pointsAtTimestamp(
  frames: RobustPoseFrame[] | null | undefined,
  timestamp: number | null,
  crop: CropRectPx | null,
): StoryPoints | null {
  if (!frames?.length) return null
  const frame = findNearestFrame(frames, timestamp ?? frames[Math.floor(frames.length / 2)].timestamp)
  return frame ? pointsForFrame(frame, crop) : null
}

export function mixPoints(from: StoryPoints, to: StoryPoints, amount: number): StoryPoints {
  const mixed: StoryPoints = {}
  for (const name of Object.keys(to) as KeypointName[]) {
    const end = to[name]
    if (!end) continue
    const start = from[name] ?? end
    mixed[name] = {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      inferred: end.inferred,
    }
  }
  return mixed
}
