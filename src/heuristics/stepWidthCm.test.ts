import { describe, expect, it } from 'vitest'
import { computeStepWidthCm } from './stepWidthCm'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

/**
 * Rewrites every frame's ankle x-position so that `ankle.x - hipMid.x === offsetPx` exactly, on
 * both legs, at every frame — not just at footstrikes. Same technique
 * `footStrikePattern.test.ts`'s `withKneeAnkleOffset` uses: it pins the signal this metric reads
 * to a known value while leaving footstrike timing (still driven by the fixture's own ankle-y)
 * and everything else about the clip realistic, so the expected centimetre value is exact rather
 * than approximate (no dependence on how closely a discretely-sampled frame lands on the
 * continuous ankle-y peak).
 */
function withAnkleHipOffset(frames: RobustPoseFrame[], offsetPx: number): RobustPoseFrame[] {
  return frames.map((frame) => {
    const leftHip = frame.keypoints.find((k) => k.name === 'left_hip')
    const rightHip = frame.keypoints.find((k) => k.name === 'right_hip')
    const hipMidX = ((leftHip?.x ?? 0) + (rightHip?.x ?? 0)) / 2
    return {
      ...frame,
      keypoints: frame.keypoints.map((kp) => {
        if (kp.name !== 'left_ankle' && kp.name !== 'right_ankle') return kp
        return { ...kp, x: hipMidX + offsetPx }
      }),
    }
  })
}

describe('computeStepWidthCm', () => {
  it('a clean front-view clip with a pinned offset: value close to offsetPx / scale in cm, sane sample size, high confidence', () => {
    const scale = 300 // px/m
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const frames = withAnkleHipOffset(base, 15) // 15px = 5cm at 300px/m

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(5, 6)
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    expect(result.viewFit).toBe('primary')
    expect(result.unit).toBe('centimeters')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1) -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('a signed offset (foot lands to the other side of the hip midline) reports a negative value', () => {
    const scale = 300
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const frames = withAnkleHipOffset(base, -15)

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(-5, 6)
  })

  it('a side-view clip: viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const scale = 300
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side', pixelsPerMeter: scale })

    const result = computeStepWidthCm(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it("reports the backend-gate availability caveat, verbatim, when no frame carries a measured scale", () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'front' }) // no pixelsPerMeter
    const NO_SCALE_CAVEAT =
      "No real-world scale could be measured for this clip, so step width can't be reported in centimetres. Step width measures the same offset without it."

    expect(() => computeStepWidthCm(frames, 'front')).not.toThrow()
    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.unit).toBe('centimeters')
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toBe(NO_SCALE_CAVEAT)
  })

  it('behaves identically on an empty frame list', () => {
    expect(() => computeStepWidthCm([], 'front')).not.toThrow()
    const result = computeStepWidthCm([], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toMatch(/no real-world scale could be measured/i)
  })

  it('excludes candidate footstrikes on frames with no usable scale, using only the scaled ones', () => {
    const scale = 300
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const pinned = withAnkleHipOffset(base, 15)
    // Null out the scale on every OTHER frame -- some footstrike candidates now sit on an
    // unscaled frame and must be excluded rather than crash or corrupt the median.
    const mixed = pinned.map((frame, i) => ({
      ...frame,
      pixelsPerMeter: i % 2 === 0 ? null : frame.pixelsPerMeter,
    }))

    const scaledOnly = computeStepWidthCm(pinned, 'front')
    const result = computeStepWidthCm(mixed, 'front')

    expect(result.value).not.toBeNull()
    // The pinned offset is identical on every frame, so which subset of footstrikes survives the
    // scale filter doesn't move the value -- only coverage/confidence should differ.
    expect(result.value).toBeCloseTo(scaledOnly.value ?? 0, 6)
    expect(result.frameCoverage).toBeLessThan(1)
    expect(result.sampleSize).toBeLessThan(scaledOnly.sampleSize)
  })

  it('too few footstrikes: null value, 0 confidence, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all. Carries a scale so this reaches the "no footstrikes" branch, not the
    // backend gate.
    const frame = buildFrame(
      {
        left_hip: { x: 200, y: 400 },
        right_hip: { x: 200, y: 400 },
        left_shoulder: { x: 70, y: 250 },
        right_shoulder: { x: 330, y: 250 },
        left_ankle: { x: 190, y: 550 },
        right_ankle: { x: 210, y: 550 },
      },
      0,
      300,
    )
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeStepWidthCm(frames, 'front')).not.toThrow()
    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toBe('No footstrikes could be detected in this clip.')
  })

  it('reports a below-minimum-sample caveat and reduced confidence with fewer than 4 footstrikes', () => {
    const scale = 300
    // A short clip at a slow cadence yields only a couple of footstrikes.
    const base = generateSyntheticGait({
      ...BASE_PARAMS,
      durationSec: 0.5,
      cadenceStepsPerMin: 170,
      view: 'front',
      pixelsPerMeter: scale,
    })
    const frames = withAnkleHipOffset(base, 15)

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBeLessThan(4)
    expect(result.sampleSize).toBeGreaterThan(0)
    expect(result.caveat).toMatch(/footstrike\(s\) detected/i)
    expect(result.confidence).toBeLessThan(1)
  })

  it('returns a null value and 0 confidence when there is no resolvable hip/ankle at any candidate (degenerate scale-only input)', () => {
    // A scale is present, but no keypoints resolve at all -- detectFootstrikes needs a body-scale
    // reference (shoulders/hips) to size its prominence threshold, so it returns no candidates,
    // landing this on the "no footstrikes" branch rather than crashing on missing points.
    const frame = buildFrame({}, 0, 300)
    const result = computeStepWidthCm([frame, frame], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toBe('No footstrikes could be detected in this clip.')
  })
})
