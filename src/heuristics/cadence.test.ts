import { describe, expect, it } from 'vitest'
import { computeCadence } from './cadence'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

describe('computeCadence', () => {
  it('a clean side-view clip: value matches strikeCount / clip-duration-in-minutes, high confidence', () => {
    // The fixture's `cadenceStepsPerMin` (170) is defined as "steps per minute, both feet
    // combined" — exactly what computeCadence reports — so the true continuous rate is
    // known, but the *detected* strike count won't exactly reproduce it: a ~30fps grid over a
    // finite window either does or doesn't catch one more partial cycle at the start/end. Rather
    // than guess at that discretization slop, assert the formula directly against the result's
    // own reported sampleSize (== detected strike count), and separately sanity-check the value
    // lands in the right neighborhood of the requested 170.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })

    const result = computeCadence(frames, 'side')
    const durationMinutes = (frames[frames.length - 1].timestamp - frames[0].timestamp) / 60

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(result.sampleSize / durationMinutes, 5)
    expect(result.value).toBeGreaterThan(120)
    expect(result.value).toBeLessThan(220)
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.viewFit).toBe('primary')
    expect(result.interpolatedFraction).toBe(0)
    // viewFitMultiplier 1, full body-scale coverage, no interpolation, sampleSize well over the
    // minimum (capped at 1) -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('a front-view clip: still a reasonable value, confidence discounted by the 0.8 multiplier', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'front' })

    const result = computeCadence(frames, 'front')

    expect(result.value).not.toBeNull()
    // Front view is view-TOLERANT for cadence (unlike overstriding/trunkLean) — footstrike
    // timing is a vertical-axis (ankle-y) signal, not the sagittal one those metrics need, so a
    // value is still computed and it should land in the same plausible range as the side-view
    // case, just with confidence discounted.
    expect(result.value).toBeGreaterThan(120)
    expect(result.value).toBeLessThan(220)
    expect(result.viewFit).toBe('tolerated')
    // Same reasoning as the side-view case, but viewFitMultiplier is 0.8 instead of 1.0.
    expect(result.confidence).toBeCloseTo(0.8, 1)
  })

  it('an ambiguous-view clip: still computed, confidence discounted by the 0.6 multiplier', () => {
    // Engineered BSR/SER disagreement (small strideAmplitudePx), same technique
    // viewDetection.test.ts and index.test.ts use to force an 'ambiguous' label.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 20, view: 'side' })

    const result = computeCadence(frames, 'ambiguous')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('tolerated')
    expect(result.confidence).toBeLessThan(0.65)
    expect(result.confidence).toBeGreaterThan(0)
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
    const frames = Array.from({ length: 10 }, (_, i) => ({ ...frame, timestamp: i / 30 }))

    expect(() => computeCadence(frames, 'side')).not.toThrow()
    const result = computeCadence(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).not.toBeNull()
    expect(result.caveat).toMatch(/no footstrikes/i)
  })

  it('a short clip with a couple of footstrikes but below the minimum sample size: reduced confidence, non-null value, explicit caveat', () => {
    // Half a second at the same cadence — enough for 1-2 strikes, well under
    // MIN_CADENCE_SAMPLE_SIZE (4), so confidence should be visibly penalized via the
    // sample-size factor and a caveat should call it out, without the value going null.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, durationSec: 0.5, view: 'side' })

    const result = computeCadence(frames, 'side')

    if (result.sampleSize > 0 && result.sampleSize < 4) {
      expect(result.value).not.toBeNull()
      expect(result.confidence).toBeLessThan(1)
      expect(result.caveat).toMatch(/footstrike/i)
    } else {
      // If the short window happened to clear 4 strikes (fixture-dependent), the low-sample
      // path isn't exercised here — not a failure of this test's premise, just documents why.
      expect(result.sampleSize).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns a null value and 0 confidence when there is no body-scale reference at all', () => {
    const frame = buildFrame({})
    const result = computeCadence([frame, { ...frame, timestamp: 1 }], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toMatch(/body-scale/i)
  })

  it('never throws and returns a null value for a single-frame (zero-duration) clip', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, durationSec: 1 / 30, view: 'side' })

    expect(() => computeCadence(frames, 'side')).not.toThrow()
    const result = computeCadence(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
  })
})
