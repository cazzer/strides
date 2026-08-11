import { describe, expect, it } from 'vitest'
import { estimateBodyScale } from './bodyScale'
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
