import { describe, expect, it } from 'vitest'
import { classifyFrame } from './confidenceFilter'
import { COMMON_KEYPOINT_NAMES } from '../types'
import type { Keypoint, PoseFrame } from '../types'

function buildFrame(scores: number[]): PoseFrame {
  const keypoints: Keypoint[] = COMMON_KEYPOINT_NAMES.map((name, i) => ({
    name,
    x: i,
    y: i,
    score: scores[i],
  }))
  return { keypoints, timestamp: 0 }
}

describe('classifyFrame', () => {
  it('classifies a score above the threshold as present', () => {
    const frame = buildFrame(COMMON_KEYPOINT_NAMES.map(() => 0.5))

    const states = classifyFrame(frame, 0.3)

    expect(states.every((s) => s.kind === 'present')).toBe(true)
  })

  it('classifies a score below the threshold as missing', () => {
    const frame = buildFrame(COMMON_KEYPOINT_NAMES.map(() => 0.1))

    const states = classifyFrame(frame, 0.3)

    expect(states.every((s) => s.kind === 'missing')).toBe(true)
  })

  it('classifies a score exactly at the threshold as present (inclusive)', () => {
    const frame = buildFrame(COMMON_KEYPOINT_NAMES.map(() => 0.3))

    const states = classifyFrame(frame, 0.3)

    expect(states.every((s) => s.kind === 'present')).toBe(true)
  })

  it('classifies every keypoint as missing when the frame is null', () => {
    const states = classifyFrame(null, 0.3)

    expect(states).toHaveLength(COMMON_KEYPOINT_NAMES.length)
    expect(states.every((s) => s.kind === 'missing')).toBe(true)
  })

  it('classifies each keypoint independently within a mixed frame', () => {
    const scores = COMMON_KEYPOINT_NAMES.map((_, i) =>
      i % 2 === 0 ? 0.9 : 0.1,
    )
    const frame = buildFrame(scores)

    const states = classifyFrame(frame, 0.3)

    states.forEach((state, i) => {
      expect(state.kind).toBe(i % 2 === 0 ? 'present' : 'missing')
    })
  })
})
