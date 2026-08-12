import { describe, expect, it } from 'vitest'
import { applyRobustness } from './interpolate'
import { COMMON_KEYPOINT_NAMES } from '../types'
import type { Keypoint, PoseFrame } from '../types'
import type { PoseSample } from './types'

const LEFT_SHOULDER = 'left_shoulder'

function makeFrame(opts: {
  score: number
  x: number
  y: number
  timestamp?: number
}): PoseFrame {
  const keypoints: Keypoint[] = COMMON_KEYPOINT_NAMES.map((name) => ({
    name,
    x: opts.x,
    y: opts.y,
    score: opts.score,
  }))
  return { keypoints, timestamp: opts.timestamp ?? 0 }
}

function findKeypoint(
  frame: ReturnType<typeof applyRobustness>[number],
  name: string,
) {
  const kp = frame.keypoints.find((k) => k.name === name)
  if (!kp) throw new Error(`keypoint ${name} not found`)
  return kp
}

describe('applyRobustness', () => {
  it('clean stream: every keypoint is detected, values unchanged', () => {
    const samples: PoseSample[] = [0, 1, 2].map((t) => ({
      timestamp: t,
      frame: makeFrame({ score: 0.9, x: t * 10, y: t * 20, timestamp: t }),
    }))

    const result = applyRobustness(samples)

    expect(result).toHaveLength(3)
    result.forEach((frame, i) => {
      expect(frame.source).toBe('detected')
      expect(frame.keypoints).toHaveLength(12)
      frame.keypoints.forEach((kp) => {
        expect(kp.status).toBe('detected')
        expect(kp.x).toBe(i * 10)
        expect(kp.y).toBe(i * 20)
        expect(kp.score).toBe(0.9)
      })
    })
  })

  it('interpolates an isolated single-frame gap with exact hand-computed lerp values', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: makeFrame({ score: 0.1, x: 999, y: 999 }) },
      { timestamp: 0.2, frame: makeFrame({ score: 0.9, x: 10, y: 20 }) },
    ]

    const result = applyRobustness(samples)

    const mid = findKeypoint(result[1], LEFT_SHOULDER)
    // t = (0.1 - 0) / (0.2 - 0) = 0.5
    expect(mid.status).toBe('interpolated')
    expect(mid.x).toBeCloseTo(5) // lerp(0, 10, 0.5)
    expect(mid.y).toBeCloseTo(10) // lerp(0, 20, 0.5)
    expect(mid.score).toBeCloseTo(0.9) // lerp(0.9, 0.9, 0.5)
  })

  it('marks a gap exceeding maxGapSeconds as unrecoverable', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 1, frame: makeFrame({ score: 0.1, x: 0, y: 0 }) },
      { timestamp: 2, frame: makeFrame({ score: 0.9, x: 10, y: 10 }) },
    ]

    // default maxGapSeconds is 0.5; gap here is 2 - 0 = 2 seconds
    const result = applyRobustness(samples)

    const mid = findKeypoint(result[1], LEFT_SHOULDER)
    expect(mid.status).toBe('unrecoverable')
    expect(mid.x).toBeNull()
    expect(mid.y).toBeNull()
    expect(mid.score).toBe(0)
  })

  it('handles a fully-missing frame mid-sequence without throwing', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: makeFrame({ score: 0.9, x: 10, y: 10 }) },
    ]

    expect(() => applyRobustness(samples)).not.toThrow()

    const result = applyRobustness(samples)
    expect(result[1].source).toBe('missing')
    result[1].keypoints.forEach((kp) => {
      expect(kp.status).toBe('interpolated')
      expect(kp.x).toBeCloseTo(5)
      expect(kp.y).toBeCloseTo(5)
    })
  })

  it('never extrapolates a leading gap, even a single-sample one', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.1, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: makeFrame({ score: 0.9, x: 10, y: 10 }) },
    ]

    const result = applyRobustness(samples)

    const first = findKeypoint(result[0], LEFT_SHOULDER)
    expect(first.status).toBe('unrecoverable')
    expect(first.x).toBeNull()
    expect(first.y).toBeNull()
    expect(first.score).toBe(0)
  })

  it('never extrapolates a trailing gap, even a single-sample one', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: makeFrame({ score: 0.1, x: 0, y: 0 }) },
    ]

    const result = applyRobustness(samples)

    const last = findKeypoint(result[1], LEFT_SHOULDER)
    expect(last.status).toBe('unrecoverable')
    expect(last.x).toBeNull()
    expect(last.y).toBeNull()
    expect(last.score).toBe(0)
  })

  it('never drops a frame: output length always equals input length', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: makeFrame({ score: 0.1, x: 0, y: 0 }) },
      { timestamp: 5, frame: makeFrame({ score: 0.9, x: 1, y: 1 }) },
    ]

    const result = applyRobustness(samples)

    expect(result).toHaveLength(samples.length)
  })

  it('gap-fills each keypoint independently: one channel missing does not affect another', () => {
    const samples: PoseSample[] = [
      {
        timestamp: 0,
        frame: {
          timestamp: 0,
          keypoints: COMMON_KEYPOINT_NAMES.map((name) => ({
            name,
            x: 0,
            y: 0,
            score: 0.9,
          })),
        },
      },
      {
        timestamp: 0.1,
        frame: {
          timestamp: 0.1,
          keypoints: COMMON_KEYPOINT_NAMES.map((name) => ({
            name,
            x: 999,
            y: 999,
            // only left_shoulder drops below threshold; every other keypoint stays present
            score: name === LEFT_SHOULDER ? 0.1 : 0.9,
          })),
        },
      },
      {
        timestamp: 0.2,
        frame: {
          timestamp: 0.2,
          keypoints: COMMON_KEYPOINT_NAMES.map((name) => ({
            name,
            x: 10,
            y: 10,
            score: 0.9,
          })),
        },
      },
    ]

    const result = applyRobustness(samples)

    expect(findKeypoint(result[1], LEFT_SHOULDER).status).toBe('interpolated')
    const otherName = COMMON_KEYPOINT_NAMES.find((n) => n !== LEFT_SHOULDER)!
    expect(findKeypoint(result[1], otherName).status).toBe('detected')
    expect(findKeypoint(result[1], otherName).x).toBe(999)
  })

  it('treats a zero-length gap between same-timestamp anchors as unrecoverable, not NaN', () => {
    const samples: PoseSample[] = [
      {
        timestamp: 0,
        frame: makeFrame({ score: 0.9, x: 0, y: 0, timestamp: 0 }),
      },
      { timestamp: 0, frame: null },
      {
        timestamp: 0,
        frame: makeFrame({ score: 0.9, x: 10, y: 10, timestamp: 0 }),
      },
    ]

    const result = applyRobustness(samples)

    const mid = findKeypoint(result[1], LEFT_SHOULDER)
    expect(mid.status).toBe('unrecoverable')
    expect(mid.x).toBeNull()
    expect(mid.y).toBeNull()
    expect(mid.score).toBe(0)
    expect(Number.isNaN(mid.x)).toBe(false)
  })

  it('is unrecoverable when anchor timestamps are out of order, not extrapolated', () => {
    const samples: PoseSample[] = [
      { timestamp: 1, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 0.5, frame: null },
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 10, y: 10 }) },
    ]

    const result = applyRobustness(samples)

    const mid = findKeypoint(result[1], LEFT_SHOULDER)
    expect(mid.status).toBe('unrecoverable')
    expect(mid.x).toBeNull()
  })

  it('lerps score toward distinct anchor values, not just echoing one side', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.4, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: makeFrame({ score: 0.1, x: 0, y: 0 }) },
      { timestamp: 0.2, frame: makeFrame({ score: 0.8, x: 10, y: 10 }) },
    ]

    const result = applyRobustness(samples)

    const mid = findKeypoint(result[1], LEFT_SHOULDER)
    expect(mid.status).toBe('interpolated')
    expect(mid.score).toBeCloseTo(0.6) // lerp(0.4, 0.8, 0.5)
  })

  it('respects a caller-supplied config instead of the defaults', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 1, frame: makeFrame({ score: 0.1, x: 0, y: 0 }) },
      { timestamp: 2, frame: makeFrame({ score: 0.9, x: 10, y: 10 }) },
    ]

    // gap is 2 seconds, which exceeds the default 0.5s cap but not this override
    const result = applyRobustness(samples, {
      minKeypointConfidence: 0.3,
      maxGapSeconds: 5,
    })

    expect(findKeypoint(result[1], LEFT_SHOULDER).status).toBe('interpolated')
  })

  it('copies a detected frame\'s pixelsPerMeter through verbatim', () => {
    const samples: PoseSample[] = [
      {
        timestamp: 0,
        frame: { ...makeFrame({ score: 0.9, x: 0, y: 0 }), pixelsPerMeter: 872.5 },
      },
    ]

    expect(applyRobustness(samples)[0].pixelsPerMeter).toBe(872.5)
  })

  it('reports a null scale for a missing frame and for a scale-less backend', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: makeFrame({ score: 0.9, x: 0, y: 0 }) },
      { timestamp: 0.1, frame: null },
    ]

    const result = applyRobustness(samples)

    expect(result[0].pixelsPerMeter).toBeNull()
    expect(result[1].pixelsPerMeter).toBeNull()
  })

  it('never fabricates a scale for an interpolated frame, even between two scaled anchors', () => {
    const samples: PoseSample[] = [
      {
        timestamp: 0,
        frame: { ...makeFrame({ score: 0.9, x: 0, y: 0 }), pixelsPerMeter: 100 },
      },
      // Carries no scale of its own; a lerp of its neighbours would be 200.
      { timestamp: 0.1, frame: makeFrame({ score: 0.1, x: 999, y: 999 }) },
      {
        timestamp: 0.2,
        frame: { ...makeFrame({ score: 0.9, x: 10, y: 20 }), pixelsPerMeter: 300 },
      },
    ]

    const result = applyRobustness(samples)

    // The middle frame's keypoints ARE interpolated...
    expect(findKeypoint(result[1], LEFT_SHOULDER).status).toBe('interpolated')
    // ...and its scale is still null, not the 200 a positional-style lerp would have produced.
    expect(result[1].pixelsPerMeter).toBeNull()
  })
})
