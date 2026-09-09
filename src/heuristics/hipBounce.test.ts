import { describe, expect, it } from 'vitest'
import { analyzeHipBounce } from './hipBounce'
import { buildFrame } from './__fixtures__/testFrames'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { DEFAULT_HEURISTICS_CONFIG } from './types'

describe('analyzeHipBounce', () => {
  it('an empty frame list: zero coverage, no fit, never throws', () => {
    expect(() => analyzeHipBounce([], DEFAULT_HEURISTICS_CONFIG)).not.toThrow()
    const result = analyzeHipBounce([], DEFAULT_HEURISTICS_CONFIG)

    expect(result.hipY).toEqual([])
    expect(result.resolvedCount).toBe(0)
    expect(result.interpolatedCount).toBe(0)
    // Guarded, not a 0/0 NaN.
    expect(result.frameCoverage).toBe(0)
    expect(result.interpolatedFraction).toBe(0)
    expect(result.fit.ok).toBe(false)
    if (!result.fit.ok) {
      expect(result.fit.reason).toBe('too-few-samples')
      expect(result.fit.sampleCount).toBe(0)
    }
  })

  it('single-side hip fallback raises interpolatedFraction without changing frameCoverage', () => {
    // Every frame has a resolvable left hip; every OTHER frame is also missing the right hip
    // entirely, forcing resolveMidpoint's single-side fallback (flagged interpolated: true) on
    // those frames. Every frame still resolves a hip position, so frameCoverage stays 1 in both
    // cases -- only interpolatedFraction should move.
    const frameCount = 20
    const bothSidesFrames = Array.from({ length: frameCount }, (_, i) =>
      buildFrame(
        {
          left_hip: { x: 195, y: 400 + i },
          right_hip: { x: 205, y: 400 + i },
        },
        i / 30,
      ),
    )
    const mixedFrames = Array.from({ length: frameCount }, (_, i) =>
      buildFrame(
        i % 2 === 0
          ? { left_hip: { x: 195, y: 400 + i }, right_hip: { x: 205, y: 400 + i } }
          : { left_hip: { x: 195, y: 400 + i } },
        i / 30,
      ),
    )

    const bothSides = analyzeHipBounce(bothSidesFrames, DEFAULT_HEURISTICS_CONFIG)
    const mixed = analyzeHipBounce(mixedFrames, DEFAULT_HEURISTICS_CONFIG)

    expect(bothSides.frameCoverage).toBe(1)
    expect(bothSides.interpolatedFraction).toBe(0)

    expect(mixed.resolvedCount).toBe(frameCount)
    expect(mixed.frameCoverage).toBe(1)
    expect(mixed.interpolatedCount).toBe(frameCount / 2)
    expect(mixed.interpolatedFraction).toBeCloseTo(0.5, 10)
  })

  it('subFloorRhythm is false on an ordinary in-band clip', () => {
    const frames = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })

    const result = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.fit.ok).toBe(true)
    expect(result.subFloorRhythm).toBe(false)
  })

  it('subFloorRhythm is false on a clip with no fittable rhythm at all', () => {
    // The other existing fixture: a hip that only ramps. Nothing periodic in band, and nothing
    // below it either — so the second pass must not manufacture a verdict out of a straight line.
    const frames = Array.from({ length: 200 }, (_, i) =>
      buildFrame(
        { left_hip: { x: 195, y: 400 + i * 0.5 }, right_hip: { x: 205, y: 400 + i * 0.5 } },
        i / 30,
      ),
    )

    expect(analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG).subFloorRhythm).toBe(false)
  })

  it('subFloorRhythm is true when the bounce is slower than any human gait', () => {
    // 26 steps/min on screen over 12 s at 30 fps — a ~7x retimed clip, the shape
    // `park-side-portrait.mp4` has. Every other field is unchanged in meaning; only the band the
    // fit came from differs.
    const frames = generateSyntheticGait({
      durationSec: 12,
      fps: 30,
      cadenceStepsPerMin: 26,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })

    const result = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.subFloorRhythm).toBe(true)
    expect(result.fit.ok).toBe(true)
    if (!result.fit.ok) return
    expect(result.fit.frequencyHz).toBeLessThan(DEFAULT_HEURISTICS_CONFIG.spectralFitMinFrequencyHz)
    // The bounce is one per STEP, so 26 spm is 26/60 Hz on screen.
    expect(result.fit.frequencyHz).toBeCloseTo(26 / 60, 1)
  })
})
