import { describe, expect, it } from 'vitest'
import { computeVerticalOscillation } from './verticalOscillation'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample } from '../pose/robustness/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { Keypoint, PoseFrame } from '../pose/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  trunkLeanDeg: 5,
}

describe('computeVerticalOscillation', () => {
  it('a clean side-view clip: value close to verticalBouncePx / torsoLengthPx, confidence 1', () => {
    // TORSO_LENGTH_PX = 150 (fixed in the fixture generator). Consecutive extrema of a clean
    // sinusoid differ by exactly verticalBouncePx (peak-to-trough, by the generator's design),
    // so the expected torso-normalized value is 20/150 = 0.1333. Assert "close to" rather than
    // exact: the extrema algorithm reports the raw sample nearest the true peak/trough, which a
    // discrete sampling grid won't land on exactly.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'side' })

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(20 / 150, 1)
    expect(result.frameCoverage).toBe(1)
    expect(result.interpolatedFraction).toBe(0)
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    // side view multiplier 1.0, full coverage, no interpolation, sampleSize capped at 1 ->
    // every confidence factor is exactly 1.
    expect(result.confidence).toBeCloseTo(1)
    expect(result.viewFit).toBe('primary')
    expect(result.caveat).toBeNull()
    expect(result.series).toHaveLength(frames.length)
    expect(result.series.every((point) => point.value !== null)).toBe(true)
    expect(result.series.map((point) => point.timestamp)).toEqual(
      frames.map((frame) => frame.timestamp),
    )
  })

  it('a front-view clip: still a reasonable value, confidence discounted by the 0.85 multiplier', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'front' })

    const result = computeVerticalOscillation(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(20 / 150, 1)
    // Same reasoning as the side-view case, but viewFitMultiplier is 0.85 instead of 1.0.
    expect(result.confidence).toBeCloseTo(0.85)
    expect(result.viewFit).toBe('tolerated')
    expect(result.series).toHaveLength(frames.length)
  })

  it('a heavily-interpolated/unrecoverable stream: reduced confidence, no crash, a non-null value', () => {
    const strideFreqHz = 170 / 120
    const fps = 30
    const frameCount = 120 // 4 seconds

    function rawFrame(t: number): PoseFrame {
      const hipY = 400 + 20 * Math.sin(2 * Math.PI * 2 * strideFreqHz * t)
      const shoulderY = hipY - 150
      const keypoints: Keypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
        if (name === 'left_hip' || name === 'right_hip') {
          return { name, x: 200, y: hipY, score: 0.9 }
        }
        if (name === 'left_shoulder' || name === 'right_shoulder') {
          return { name, x: 200, y: shoulderY, score: 0.9 }
        }
        return { name, x: 200, y: 400, score: 0.9 }
      })
      return { keypoints, timestamp: t }
    }

    // Two 1-second gaps (indices [20,50) and [70,100), 30 samples each at 30fps) -- well beyond
    // the robustness layer's default 0.5s maxGapSeconds, so these become genuinely
    // 'unrecoverable', not merely 'interpolated'. ~50% of frames remain resolvable.
    const samples: PoseSample[] = Array.from({ length: frameCount }, (_, i) => {
      const t = i / fps
      const inGap = (i >= 20 && i < 50) || (i >= 70 && i < 100)
      return { timestamp: t, frame: inGap ? null : rawFrame(t) }
    })

    const robustFrames = applyRobustness(samples)

    expect(() => computeVerticalOscillation(robustFrames, 'side')).not.toThrow()
    const result = computeVerticalOscillation(robustFrames, 'side')

    expect(result.frameCoverage).toBeCloseTo(0.5, 1)
    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBeGreaterThan(0)
    // Visibly reduced from the ~1.0 a clean, fully-resolvable clip would get.
    expect(result.confidence).toBeLessThan(0.9)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.series).toHaveLength(robustFrames.length)
    // The two gapped stretches were unrecoverable — a real gap, not interpolated for charting.
    expect(result.series.some((point) => point.value === null)).toBe(true)
  })

  it('returns a null value and 0 confidence when no hip position is resolvable at all', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'side' })
    // Strip every frame's hip keypoints down to unrecoverable.
    const stripped = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_hip' || kp.name === 'right_hip'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }))

    const result = computeVerticalOscillation(stripped, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
    // Stripping hips also makes bodyScale unresolvable (it needs hip+shoulder together in the
    // same frame) — per the `series` contract, empty only when bodyScale is null, which is
    // exactly the case here.
    expect(result.series).toEqual([])
  })

  it('populates series even when hip is tracked but no complete cycle is detected', () => {
    // Zero bounce amplitude: hip position is fully tracked (body scale resolves), but no
    // extremum ever clears the prominence threshold, so there's no computable amplitude.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' })

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toMatch(/no complete vertical-oscillation cycle/i)
    expect(result.series).toHaveLength(frames.length)
    expect(result.series.every((point) => point.value !== null)).toBe(true)
  })
})
