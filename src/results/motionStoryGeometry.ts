import type { KeypointName } from '../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type { CropRectPx } from '../pose/backends/movenetCrop'
import { findNearestFrame } from './skeletonGeometry'

export type StoryPoints = Partial<Record<KeypointName, { x: number; y: number; inferred?: boolean }>>

export interface MotionSequence {
  frames: { timestamp: number; points: StoryPoints }[]
  duration: number
  crop: CropRectPx
}

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
const LEG_SEGMENTS: [KeypointName, KeypointName][] = [
  ['left_hip', 'left_knee'], ['right_hip', 'right_knee'],
  ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle'],
]

/** The evidence image is a square crop of native video pixels; use that exact crop as the
 * projection, so the solid trace stays aligned with its copied (possibly ghosted) footage. */
export function pointsForFrame(frame: RobustPoseFrame, crop: CropRectPx | null): StoryPoints | null {
  const valid = frame.keypoints.filter(
    (point) => point.status !== 'unrecoverable' && point.x !== null && point.y !== null &&
      Number.isFinite(point.x) && Number.isFinite(point.y),
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

/** Keep playback inside one uninterrupted run of real detections. Horizontal tracking removes
 * the runner's travel across the video, then one crop is shared by every pose in the loop. */
export function buildMotionSequence(
  frames: RobustPoseFrame[] | null | undefined,
  nearTimestamp: number | null,
): MotionSequence | null {
  if (!frames?.length) return null
  const chronological = [...frames].sort((a, b) => a.timestamp - b.timestamp)
  const runs: RobustPoseFrame[][] = []
  let run: RobustPoseFrame[] = []
  for (const frame of chronological) {
    const usable = Number.isFinite(frame.timestamp) && frame.source === 'detected' &&
      frame.keypoints.some((point) => (point.name === 'left_hip' || point.name === 'right_hip') &&
        point.status === 'detected' && point.x !== null && point.y !== null &&
        Number.isFinite(point.x) && Number.isFinite(point.y)) &&
      BODY_NAMES.filter((name) => frame.keypoints.some((point) =>
        point.name === name && point.status === 'detected' &&
        point.x !== null && point.y !== null && Number.isFinite(point.x) && Number.isFinite(point.y),
      )).length >= 6
    if (!usable || (run.length && frame.timestamp - run[run.length - 1].timestamp > 0.3)) {
      if (run.length) runs.push(run)
      run = []
    }
    if (usable && (!run.length || frame.timestamp > run[run.length - 1].timestamp)) run.push(frame)
  }
  if (run.length) runs.push(run)

  const candidates = runs.flatMap((candidate) => {
    if (candidate.length < 5 || candidate[candidate.length - 1].timestamp - candidate[0].timestamp < 0.4) return []
    const center = Number.isFinite(nearTimestamp) ? nearTimestamp as number :
      (candidate[0].timestamp + candidate[candidate.length - 1].timestamp) / 2
    const nearestIndex = candidate.reduce((best, frame, index) =>
      Math.abs(frame.timestamp - center) < Math.abs(candidate[best].timestamp - center) ? index : best, 0)
    let start = nearestIndex
    let end = nearestIndex
    while ((candidate[end].timestamp - candidate[start].timestamp < 1.4 || end - start < 4) &&
      (start > 0 || end < candidate.length - 1)) {
      const before = start > 0 ? Math.abs(candidate[start - 1].timestamp - center) : Infinity
      const after = end < candidate.length - 1 ? Math.abs(candidate[end + 1].timestamp - center) : Infinity
      if (before <= after) start -= 1
      else end += 1
    }
    const selected = candidate.slice(start, end + 1)
    if (selected.length < 5 || selected[selected.length - 1].timestamp - selected[0].timestamp < 0.4) return []
    return [selected]
  })
  if (!candidates.length) return null
  const target = Number.isFinite(nearTimestamp) ? nearTimestamp as number :
    (chronological[0].timestamp + chronological[chronological.length - 1].timestamp) / 2
  const selected = candidates.reduce((best, candidate) => {
    const distance = (item: RobustPoseFrame[]) => Math.min(...item.map((frame) => Math.abs(frame.timestamp - target)))
    return distance(candidate) < distance(best) ? candidate : best
  })
  const centers = selected.map((frame) => {
    const hips = frame.keypoints.filter((point) =>
      (point.name === 'left_hip' || point.name === 'right_hip') &&
      point.status === 'detected' && point.x !== null && point.y !== null &&
      Number.isFinite(point.x) && Number.isFinite(point.y))
    return hips.length ? hips.reduce((sum, point) => sum + (point.x as number), 0) / hips.length : null
  })
  if (centers.some((center) => center === null)) return null
  const sortedCenters = [...centers] as number[]
  sortedCenters.sort((a, b) => a - b)
  const anchorX = sortedCenters[Math.floor(sortedCenters.length / 2)]
  // Remove only travel across the camera's frame. Vertical hip motion and every joint angle
  // remain as recorded; a fixed crop can then show the stride at a useful size.
  const tracked = selected.map((frame, index) => ({
    ...frame,
    keypoints: frame.keypoints.map((point) => ({
      ...point,
      x: point.x === null ? null : point.x + anchorX - (centers[index] as number),
    })),
  }))
  const torsoLengths = tracked.flatMap((frame) => {
    const named = Object.fromEntries(frame.keypoints.map((point) => [point.name, point]))
    const shoulders = [named.left_shoulder, named.right_shoulder]
    const hips = [named.left_hip, named.right_hip]
    if ([...shoulders, ...hips].some((point) => point?.status !== 'detected' ||
      point.x === null || point.y === null || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return []
    return [Math.hypot(
      ((shoulders[0].x as number) + (shoulders[1].x as number) - (hips[0].x as number) - (hips[1].x as number)) / 2,
      ((shoulders[0].y as number) + (shoulders[1].y as number) - (hips[0].y as number) - (hips[1].y as number)) / 2,
    )]
  }).filter((length) => length > 1).sort((a, b) => a - b)
  const legLengths = tracked.flatMap((frame) => LEG_SEGMENTS.flatMap(([a, b]) => {
    const first = frame.keypoints.find((point) => point.name === a)
    const second = frame.keypoints.find((point) => point.name === b)
    if (!first || !second || first.status !== 'detected' || second.status !== 'detected' ||
      first.x === null || first.y === null || second.x === null || second.y === null ||
      !Number.isFinite(first.x) || !Number.isFinite(first.y) ||
      !Number.isFinite(second.x) || !Number.isFinite(second.y)) return []
    return [Math.hypot(first.x - second.x, first.y - second.y)]
  })).filter((length) => length > 1).sort((a, b) => a - b)
  const scaleLengths = torsoLengths.length ? torsoLengths : legLengths
  const bodyScale = scaleLengths[Math.floor(scaleLengths.length / 2)]
  if (!Number.isFinite(bodyScale)) return null
  const validPoints: RobustKeypoint[] = []
  for (const frame of tracked) {
    const center = frame.keypoints.filter((point) =>
      (point.name === 'left_hip' || point.name === 'right_hip') &&
      point.status === 'detected' && point.x !== null && point.y !== null &&
      Number.isFinite(point.x) && Number.isFinite(point.y))
    if (!center.length) return null
    const x = center.reduce((sum, point) => sum + (point.x as number), 0) / center.length
    const y = center.reduce((sum, point) => sum + (point.y as number), 0) / center.length
    validPoints.push(...frame.keypoints.filter((point) => point.status === 'detected' &&
      point.x !== null && point.y !== null && Number.isFinite(point.x) && Number.isFinite(point.y) &&
      Math.abs(point.x - x) <= 4 * bodyScale && Math.abs(point.y - y) <= 5 * bodyScale))
  }
  if (!validPoints.length) return null
  const xs = validPoints.map((point) => point.x as number)
  const ys = validPoints.map((point) => point.y as number)
  const side = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 1.3
  const crop = {
    x: (Math.min(...xs) + Math.max(...xs) - side) / 2,
    y: (Math.min(...ys) + Math.max(...ys) - side) / 2,
    side,
  }
  const projected = tracked.map((frame) => ({ timestamp: frame.timestamp, points: pointsForFrame(frame, crop) }))
  if (projected.some((frame) => frame.points === null)) return null
  const intervals = selected.slice(1).map((frame, index) => frame.timestamp - selected[index].timestamp)
  const sortedIntervals = [...intervals].sort((a, b) => a - b)
  const finalInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)]
  return {
    frames: projected as MotionSequence['frames'],
    duration: selected[selected.length - 1].timestamp - selected[0].timestamp + finalInterval,
    crop,
  }
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
