import { describe, expect, it } from 'vitest'
import { toPoseFrame } from './common'
import { MOVENET_RAW_KEYPOINTS } from './__fixtures__/movenet-keypoints.fixture'
import { COMMON_KEYPOINT_NAMES } from '../types'

describe('toPoseFrame', () => {
  it('returns exactly 19 keypoints in COMMON_KEYPOINT_NAMES order', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    expect(frame.keypoints).toHaveLength(19)
    expect(frame.keypoints.map((k) => k.name)).toEqual([
      ...COMMON_KEYPOINT_NAMES,
    ])
  })

  it('drops raw keypoints outside the common subset', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    const names = frame.keypoints.map((k) => k.name)
    expect(names).not.toContain('left_eye')
    expect(names).not.toContain('right_eye')
  })

  it('passes through x/y/score for keypoints in the common subset', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    const leftShoulder = frame.keypoints.find(
      (k) => k.name === 'left_shoulder',
    )
    expect(leftShoulder).toEqual({
      name: 'left_shoulder',
      x: 360,
      y: 160,
      score: 0.95,
    })
  })

  it('passes through x/y/score for the newly widened head keypoints', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    expect(frame.keypoints.find((k) => k.name === 'nose')).toEqual({
      name: 'nose',
      x: 320,
      y: 100,
      score: 0.98,
    })
    expect(frame.keypoints.find((k) => k.name === 'left_ear')).toEqual({
      name: 'left_ear',
      x: 340,
      y: 95,
      score: 0.9,
    })
    expect(frame.keypoints.find((k) => k.name === 'right_ear')).toEqual({
      name: 'right_ear',
      x: 300,
      y: 95,
      score: 0.89,
    })
  })

  it('passes through x/y/score for the newly widened foot keypoints', () => {
    // MOVENET_RAW_KEYPOINTS never carries foot points (MoveNet is COCO-17 and structurally
    // cannot produce them) — a local raw-keypoint literal exercises the pass-through path
    // instead, standing in for a MediaPipe-shaped source.
    const rawKeypointsWithFeet = [
      ...MOVENET_RAW_KEYPOINTS,
      { name: 'left_heel', x: 362, y: 495, score: 0.83 },
      { name: 'right_heel', x: 278, y: 495, score: 0.82 },
      { name: 'left_foot_index', x: 365, y: 500, score: 0.8 },
      { name: 'right_foot_index', x: 275, y: 500, score: 0.79 },
    ]
    const frame = toPoseFrame(rawKeypointsWithFeet, 1.5)

    expect(frame.keypoints.find((k) => k.name === 'left_heel')).toEqual({
      name: 'left_heel',
      x: 362,
      y: 495,
      score: 0.83,
    })
    expect(frame.keypoints.find((k) => k.name === 'right_heel')).toEqual({
      name: 'right_heel',
      x: 278,
      y: 495,
      score: 0.82,
    })
    expect(frame.keypoints.find((k) => k.name === 'left_foot_index')).toEqual({
      name: 'left_foot_index',
      x: 365,
      y: 500,
      score: 0.8,
    })
    expect(frame.keypoints.find((k) => k.name === 'right_foot_index')).toEqual({
      name: 'right_foot_index',
      x: 275,
      y: 500,
      score: 0.79,
    })
  })

  it('echoes the given timestamp', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 42.125)

    expect(frame.timestamp).toBe(42.125)
  })

  it('omits pixelsPerMeter entirely when no scale is supplied', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    // The key must be absent, not present-and-undefined: backends that don't measure scale
    // (MoveNet) must keep producing byte-for-byte the frame they produced before this existed.
    expect('pixelsPerMeter' in frame).toBe(false)
    expect(JSON.parse(JSON.stringify(frame))).toStrictEqual(
      JSON.parse(JSON.stringify({ keypoints: frame.keypoints, timestamp: 1.5 })),
    )
  })

  it('carries a supplied pixelsPerMeter through unchanged', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5, 872.5)

    expect(frame.pixelsPerMeter).toBe(872.5)
  })

  it('defaults missing common keypoints to zero x/y/score', () => {
    const frame = toPoseFrame(
      MOVENET_RAW_KEYPOINTS.filter((k) => k.name !== 'left_ankle'),
      0,
    )

    const leftAnkle = frame.keypoints.find((k) => k.name === 'left_ankle')
    expect(leftAnkle).toEqual({ name: 'left_ankle', x: 0, y: 0, score: 0 })
  })

  it('defaults a missing head keypoint to zero x/y/score, same as a missing limb keypoint', () => {
    const frame = toPoseFrame(
      MOVENET_RAW_KEYPOINTS.filter((k) => k.name !== 'nose'),
      0,
    )

    const nose = frame.keypoints.find((k) => k.name === 'nose')
    expect(nose).toEqual({ name: 'nose', x: 0, y: 0, score: 0 })
  })

  it('defaults a missing foot keypoint to zero x/y/score, same as a missing limb keypoint', () => {
    // MOVENET_RAW_KEYPOINTS never carries left_heel in the first place -- this is the ordinary
    // "not in the raw source" path, same shape as MoveNet's real behavior for every foot name.
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 0)

    const leftHeel = frame.keypoints.find((k) => k.name === 'left_heel')
    expect(leftHeel).toEqual({ name: 'left_heel', x: 0, y: 0, score: 0 })
  })
})
