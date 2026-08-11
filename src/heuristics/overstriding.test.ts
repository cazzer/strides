import { describe, expect, it } from 'vitest'
import { computeOverstriding } from './overstriding'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

describe('computeOverstriding', () => {
  it('a clean side-view clip: value close to strideAmplitudePx / torsoLengthPx, sane sample size', () => {
    // By the fixture's construction (see syntheticGait.ts's doc comment), each footstrike's
    // ankle-x sits exactly strideAmplitudePx ahead of the hip at the instant ankle-y peaks, for
    // both legs -- so every overstrideRatio_i should be close to 80/150 = 0.5333. "Close to" not
    // exact: the footstrike index is the discretely-sampled point nearest the continuous phase
    // peak, which a ~30fps grid against a ~1.4Hz stride won't land on exactly.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' })

    const result = computeOverstriding(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(80 / 150, 1)
    expect(result.value).toBeGreaterThan(0) // foot lands ahead of the hip, in travel direction
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1) // hip is resolvable at every candidate footstrike
    expect(result.viewFit).toBe('primary')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1), travelDirectionKnown true -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('a front-view clip: viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'front' })

    const result = computeOverstriding(frames, 'front')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('front view')
  })

  it('too few footstrikes: null value, 0 confidence, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all.
    const frame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 200, y: 400 },
      left_shoulder: { x: 200, y: 250 },
      right_shoulder: { x: 200, y: 250 },
      left_ankle: { x: 190, y: 550 },
      right_ankle: { x: 210, y: 550 },
    })
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeOverstriding(frames, 'side')).not.toThrow()
    const result = computeOverstriding(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  it('returns a null value and 0 confidence when there is no body-scale reference at all', () => {
    const frame = buildFrame({})
    const result = computeOverstriding([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
  })
})
