import { describe, expect, it } from 'vitest'
import { trimToPresenceWindow } from './presenceWindow'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig } from './types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'

function makeFrame(timestamp: number, present: boolean): RobustPoseFrame {
  const keypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
    const isBodyScalePoint =
      name === 'left_shoulder' ||
      name === 'right_shoulder' ||
      name === 'left_hip' ||
      name === 'right_hip'
    const resolvable = present || !isBodyScalePoint
    return {
      name,
      status: resolvable ? 'detected' : 'unrecoverable',
      x: resolvable ? 1 : null,
      y: resolvable ? 1 : null,
      score: resolvable ? 0.9 : 0,
    }
  })
  return {
    timestamp,
    source: present ? 'detected' : 'missing',
    keypoints,
    pixelsPerMeter: null,
  }
}

const CONFIG: HeuristicsConfig = { ...DEFAULT_HEURISTICS_CONFIG, presenceMinConsecutiveFrames: 3 }

describe('trimToPresenceWindow', () => {
  it('trims leading and trailing absence', () => {
    const frames = [
      makeFrame(0, false),
      makeFrame(1, false),
      makeFrame(2, true),
      makeFrame(3, true),
      makeFrame(4, true),
      makeFrame(5, true),
      makeFrame(6, false),
      makeFrame(7, false),
    ]
    const trimmed = trimToPresenceWindow(frames, CONFIG)
    expect(trimmed.map((f) => f.timestamp)).toEqual([2, 3, 4, 5])
  })

  it('ignores an isolated spurious detection below the consecutive-run threshold', () => {
    const frames = [
      makeFrame(0, false),
      makeFrame(1, true), // isolated -- only 1 consecutive present frame, below minRun=3
      makeFrame(2, false),
      makeFrame(3, true),
      makeFrame(4, true),
      makeFrame(5, true),
      makeFrame(6, false),
    ]
    const trimmed = trimToPresenceWindow(frames, CONFIG)
    expect(trimmed.map((f) => f.timestamp)).toEqual([3, 4, 5])
  })

  it('returns frames unchanged when present throughout', () => {
    const frames = [makeFrame(0, true), makeFrame(1, true), makeFrame(2, true)]
    const trimmed = trimToPresenceWindow(frames, CONFIG)
    expect(trimmed).toEqual(frames)
  })

  it('returns an empty array when no trackable frames exist', () => {
    const frames = [makeFrame(0, false), makeFrame(1, false), makeFrame(2, false)]
    expect(trimToPresenceWindow(frames, CONFIG)).toEqual([])
  })

  it('returns an empty array for an empty input', () => {
    expect(trimToPresenceWindow([], CONFIG)).toEqual([])
  })

  it('spans from the first qualifying run to the last, even with a present-but-short run at the very end', () => {
    const frames = [
      makeFrame(0, true),
      makeFrame(1, true),
      makeFrame(2, true),
      makeFrame(3, false),
      makeFrame(4, true), // trailing isolated frame -- shouldn't extend the window
    ]
    const trimmed = trimToPresenceWindow(frames, CONFIG)
    expect(trimmed.map((f) => f.timestamp)).toEqual([0, 1, 2])
  })
})
