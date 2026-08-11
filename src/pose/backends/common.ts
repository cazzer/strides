import { COMMON_KEYPOINT_NAMES } from '../types'
import type { KeypointName, PoseFrame } from '../types'

export interface RawKeypoint {
  x: number
  y: number
  score?: number
  name?: string
}

export function toPoseFrame(
  rawKeypoints: RawKeypoint[],
  timestamp: number,
): PoseFrame {
  const byName = new Map<string, RawKeypoint>()
  for (const raw of rawKeypoints) {
    if (raw.name) byName.set(raw.name, raw)
  }

  const keypoints = COMMON_KEYPOINT_NAMES.map((name: KeypointName) => {
    const raw = byName.get(name)
    return {
      name,
      x: raw?.x ?? 0,
      y: raw?.y ?? 0,
      score: raw?.score ?? 0,
    }
  })

  return { keypoints, timestamp }
}
