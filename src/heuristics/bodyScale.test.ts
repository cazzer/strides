import { describe, expect, it } from 'vitest'
import { estimateBodyScale, estimateHipWidth } from './bodyScale'
import { buildFrame } from './__fixtures__/testFrames'

describe('estimateBodyScale', () => {
  it('computes the median torso length across frames with a straight vertical torso', () => {
    // shoulder-mid (0,0), hip-mid (0,100) -> distance 100 for every frame
    const frames = [
      buildFrame({
        left_shoulder: { x: -5, y: 0 },
        right_shoulder: { x: 5, y: 0 },
        left_hip: { x: -5, y: 100 },
        right_hip: { x: 5, y: 100 },
      }),
      buildFrame({
        left_shoulder: { x: -5, y: 0 },
        right_shoulder: { x: 5, y: 0 },
        left_hip: { x: -5, y: 100 },
        right_hip: { x: 5, y: 100 },
      }),
    ]

    const result = estimateBodyScale(frames)
    expect(result).not.toBeNull()
    expect(result?.torsoLengthPx).toBeCloseTo(100)
    expect(result?.sampleCoverage).toBe(1)
  })

  it('uses the median, not the mean, so one outlier frame does not dominate', () => {
    const goodFrame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 0, y: 100 },
    })
    const outlierFrame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 1000 },
      right_hip: { x: 0, y: 1000 },
    })
    const frames = [goodFrame, goodFrame, goodFrame, outlierFrame]

    const result = estimateBodyScale(frames)
    expect(result?.torsoLengthPx).toBeCloseTo(100)
  })

  it('excludes frames where shoulder-mid or hip-mid cannot resolve, reflected in sampleCoverage', () => {
    const resolvable = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 0, y: 100 },
    })
    const unresolvable = buildFrame({
      left_shoulder: null,
      right_shoulder: null,
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 0, y: 100 },
    })
    const frames = [resolvable, resolvable, unresolvable, unresolvable]

    const result = estimateBodyScale(frames)
    expect(result?.sampleCoverage).toBe(0.5)
  })

  it('returns null when zero frames have a resolvable body scale', () => {
    const unresolvable = buildFrame({ left_shoulder: null, right_shoulder: null })
    const result = estimateBodyScale([unresolvable, unresolvable])
    expect(result).toBeNull()
  })

  it('returns null for an empty frame list', () => {
    expect(estimateBodyScale([])).toBeNull()
  })
})

describe('estimateHipWidth', () => {
  it('computes the median hip separation across frames', () => {
    const frames = [
      buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } }),
      buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } }),
    ]

    const result = estimateHipWidth(frames)
    expect(result).not.toBeNull()
    expect(result?.hipWidthPx).toBeCloseTo(40)
    expect(result?.sampleCoverage).toBe(1)
  })

  it('uses the median, not the mean, so one outlier frame does not dominate', () => {
    const goodFrame = buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } })
    const outlierFrame = buildFrame({
      left_hip: { x: -200, y: 100 },
      right_hip: { x: 200, y: 100 },
    })
    const frames = [goodFrame, goodFrame, goodFrame, outlierFrame]

    const result = estimateHipWidth(frames)
    expect(result?.hipWidthPx).toBeCloseTo(40)
  })

  it('excludes frames where both hips cannot resolve together, reflected in sampleCoverage', () => {
    const resolvable = buildFrame({ left_hip: { x: -20, y: 100 }, right_hip: { x: 20, y: 100 } })
    const unresolvable = buildFrame({ left_hip: null, right_hip: { x: 20, y: 100 } })
    const frames = [resolvable, resolvable, unresolvable, unresolvable]

    const result = estimateHipWidth(frames)
    expect(result?.sampleCoverage).toBe(0.5)
  })

  it('returns null when zero frames have both hips resolvable', () => {
    const unresolvable = buildFrame({ left_hip: null, right_hip: null })
    const result = estimateHipWidth([unresolvable, unresolvable])
    expect(result).toBeNull()
  })

  it('returns null for an empty frame list', () => {
    expect(estimateHipWidth([])).toBeNull()
  })
})
