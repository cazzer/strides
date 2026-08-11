import { describe, expect, it } from 'vitest'
import { toPoseFrame } from './common'
import { MOVENET_RAW_KEYPOINTS } from './__fixtures__/movenet-keypoints.fixture'
import { COMMON_KEYPOINT_NAMES } from '../types'

describe('toPoseFrame', () => {
  it('returns exactly 12 keypoints in COMMON_KEYPOINT_NAMES order', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    expect(frame.keypoints).toHaveLength(12)
    expect(frame.keypoints.map((k) => k.name)).toEqual([
      ...COMMON_KEYPOINT_NAMES,
    ])
  })

  it('drops raw keypoints outside the common subset', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 1.5)

    const names = frame.keypoints.map((k) => k.name)
    expect(names).not.toContain('nose')
    expect(names).not.toContain('left_eye')
    expect(names).not.toContain('right_eye')
    expect(names).not.toContain('left_ear')
    expect(names).not.toContain('right_ear')
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

  it('echoes the given timestamp', () => {
    const frame = toPoseFrame(MOVENET_RAW_KEYPOINTS, 42.125)

    expect(frame.timestamp).toBe(42.125)
  })

  it('defaults missing common keypoints to zero x/y/score', () => {
    const frame = toPoseFrame(
      MOVENET_RAW_KEYPOINTS.filter((k) => k.name !== 'left_ankle'),
      0,
    )

    const leftAnkle = frame.keypoints.find((k) => k.name === 'left_ankle')
    expect(leftAnkle).toEqual({ name: 'left_ankle', x: 0, y: 0, score: 0 })
  })
})
