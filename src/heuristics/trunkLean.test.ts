import { describe, expect, it } from 'vitest'
import { computeTrunkLean } from './trunkLean'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
}

describe('computeTrunkLean', () => {
  it('a clean side-view clip: value equals the configured lean angle exactly, confidence 1', () => {
    // The fixture's torso is a rigid segment rotated by exactly trunkLeanDeg around the hip
    // (torsoOffset()), and travel direction is unambiguously forward (+1) since hip-x advances
    // steadily -- so atan2(dx, -dy) recovers trunkLeanDeg exactly on every single frame, and the
    // median of a constant series is that same constant.
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      trunkLeanDeg: 8,
      view: 'side',
    })

    const result = computeTrunkLean(frames, 'side')

    expect(result.value).toBeCloseTo(8, 5)
    expect(result.viewFit).toBe('primary')
    expect(result.unit).toBe('degrees')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1), travelDirectionKnown true -> every factor is exactly 1.
    expect(result.confidence).toBeCloseTo(1, 5)
    expect(result.caveat).toBeNull()
  })

  it('a front-view clip: value is 0 (shoulders/hips stay x-aligned), viewFit unsuitable, low confidence', () => {
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      trunkLeanDeg: 8,
      view: 'front',
    })

    const result = computeTrunkLean(frames, 'front')

    expect(result.value).toBeCloseTo(0, 5)
    expect(result.viewFit).toBe('unsuitable')
    // viewFitMultiplier 0.1, every other factor 1 -> confidence exactly 0.1.
    expect(result.confidence).toBeCloseTo(0.1, 5)
    expect(result.caveat).toContain('front view')
  })

  it('indeterminate travel direction: value still reported (unsigned), caveat present, confidence penalized', () => {
    const leanDeg = 6
    const leanRad = (leanDeg * Math.PI) / 180
    const torsoLength = 150
    const dx = torsoLength * Math.sin(leanRad)
    const dy = -torsoLength * Math.cos(leanRad)

    // 12 identical frames -> zero net hip-x displacement -> travelDirection === 0.
    const frame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 200, y: 400 },
      left_shoulder: { x: 200 + dx, y: 400 + dy },
      right_shoulder: { x: 200 + dx, y: 400 + dy },
    })
    const frames = Array.from({ length: 12 }, () => frame)

    const result = computeTrunkLean(frames, 'side')

    // travelDirection unknown -> forwardLeanDeg falls back to the raw (unsigned-by-direction)
    // screen-relative angle, which is exactly leanDeg here by construction.
    expect(result.value).toBeCloseTo(leanDeg, 5)
    expect(result.caveat).toContain('Direction of travel')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize factor 1,
    // travelDirectionKnown false -> the only active penalty is the 0.5 travel-direction factor.
    expect(result.confidence).toBeCloseTo(0.5, 5)
  })

  it('few resolvable frames: caveat names the shortfall, mirroring overstriding/verticalOscillation', () => {
    const leanDeg = 6
    const leanRad = (leanDeg * Math.PI) / 180
    const torsoLength = 150
    const dx = torsoLength * Math.sin(leanRad)
    const dy = -torsoLength * Math.cos(leanRad)

    // 5 frames (< MIN_TRUNK_LEAN_SAMPLE_SIZE), each shifted in x so net hip displacement clears
    // the travel-direction threshold -- isolates the sample-size caveat from the
    // travel-direction-unknown one, which is covered by a separate test above.
    const frames = Array.from({ length: 5 }, (_, i) => {
      const hipX = 200 + i * 20
      return buildFrame({
        left_hip: { x: hipX, y: 400 },
        right_hip: { x: hipX, y: 400 },
        left_shoulder: { x: hipX + dx, y: 400 + dy },
        right_shoulder: { x: hipX + dx, y: 400 + dy },
      })
    })

    const result = computeTrunkLean(frames, 'side')

    expect(result.sampleSize).toBe(5)
    expect(result.caveat).toContain('Only 5 resolvable frame(s)')
    expect(result.confidence).toBeLessThan(1)
  })

  it('returns a null value and 0 confidence when no torso position is resolvable', () => {
    const frame = buildFrame({})
    const result = computeTrunkLean([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
  })
})
