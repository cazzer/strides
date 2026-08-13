import { describe, expect, it } from 'vitest'
import { computeMetricConfidence } from './confidence'

const BASE = {
  viewFitMultiplier: 1,
  frameCoverage: 1,
  interpolatedFraction: 0,
  sampleSize: 10,
  minRequiredSampleSize: 10,
  interpolationConfidencePenalty: 0.5,
}

describe('computeMetricConfidence', () => {
  it('returns 1 when every factor is fully favorable', () => {
    expect(computeMetricConfidence(BASE)).toBeCloseTo(1)
  })

  it('multiplies in the view-fit multiplier directly', () => {
    expect(computeMetricConfidence({ ...BASE, viewFitMultiplier: 0.5 })).toBeCloseTo(0.5)
  })

  it('multiplies in frame coverage directly', () => {
    expect(computeMetricConfidence({ ...BASE, frameCoverage: 0.4 })).toBeCloseTo(0.4)
  })

  it('applies the interpolation penalty proportionally to interpolatedFraction', () => {
    // 1 - 0.5 * 0.6 = 0.7
    expect(
      computeMetricConfidence({ ...BASE, interpolatedFraction: 0.6 }),
    ).toBeCloseTo(0.7)
  })

  it('a fully-interpolated input is discounted by exactly interpolationConfidencePenalty', () => {
    expect(
      computeMetricConfidence({ ...BASE, interpolatedFraction: 1 }),
    ).toBeCloseTo(1 - BASE.interpolationConfidencePenalty)
  })

  it('caps the sample-size factor at 1 rather than rewarding an oversized sample', () => {
    const withExtra = computeMetricConfidence({ ...BASE, sampleSize: 1000 })
    const atExact = computeMetricConfidence({ ...BASE, sampleSize: 10 })
    expect(withExtra).toBeCloseTo(atExact)
  })

  it('scales the sample-size factor linearly below the minimum', () => {
    // sampleSize/minRequiredSampleSize = 5/10 = 0.5
    expect(computeMetricConfidence({ ...BASE, sampleSize: 5 })).toBeCloseTo(0.5)
  })

  it('does not divide by zero when minRequiredSampleSize is 0', () => {
    expect(() =>
      computeMetricConfidence({ ...BASE, sampleSize: 0, minRequiredSampleSize: 0 }),
    ).not.toThrow()
    expect(
      computeMetricConfidence({ ...BASE, sampleSize: 0, minRequiredSampleSize: 0 }),
    ).toBeCloseTo(1)
  })

  it('applies the 0.5 travel-direction-unknown penalty independently of the other factors', () => {
    expect(
      computeMetricConfidence({ ...BASE, travelDirectionKnown: false }),
    ).toBeCloseTo(0.5)
  })

  it('defaults travelDirectionKnown to true when omitted', () => {
    const { ...withoutTravelDirection } = BASE
    expect(computeMetricConfidence(withoutTravelDirection)).toBeCloseTo(1)
  })

  it('defaults fitQuality to 1 when omitted', () => {
    // BASE deliberately omits it — every metric that doesn't fit a model to its signal must be
    // unaffected by this factor existing.
    expect(computeMetricConfidence(BASE)).toBeCloseTo(1)
  })

  it('multiplies in fit quality directly', () => {
    expect(computeMetricConfidence({ ...BASE, fitQuality: 0.6 })).toBeCloseTo(0.6)
  })

  it('compounds fit quality with the other factors rather than overriding them', () => {
    // 0.85 * 1 * 1 * 1 * 1 * 0.75 = 0.6375
    expect(
      computeMetricConfidence({ ...BASE, viewFitMultiplier: 0.85, fitQuality: 0.75 }),
    ).toBeCloseTo(0.6375)
  })

  it('clamps an out-of-range fitQuality along with everything else', () => {
    expect(computeMetricConfidence({ ...BASE, fitQuality: 3 })).toBe(1)
    expect(computeMetricConfidence({ ...BASE, fitQuality: -2 })).toBe(0)
  })

  it('compounds multiple moderate penalties into a lower overall confidence', () => {
    const result = computeMetricConfidence({
      ...BASE,
      viewFitMultiplier: 0.8,
      frameCoverage: 0.8,
      interpolatedFraction: 0.2,
    })
    // 0.8 * 0.8 * (1 - 0.5*0.2) * 1 * 1 = 0.8*0.8*0.9 = 0.576
    expect(result).toBeCloseTo(0.576)
  })

  it('defaults scaleCoverage to 1 when omitted', () => {
    // BASE deliberately omits it — every metric that doesn't depend on a measured real-world
    // scale must be unaffected by this factor existing.
    expect(computeMetricConfidence(BASE)).toBeCloseTo(1)
  })

  it('multiplies in scale coverage directly', () => {
    expect(computeMetricConfidence({ ...BASE, scaleCoverage: 0.6 })).toBeCloseTo(0.6)
  })

  it('compounds scale coverage with the other factors rather than overriding them', () => {
    // 0.85 * 1 * 1 * 1 * 1 * 1 * 0.75 = 0.6375
    expect(
      computeMetricConfidence({ ...BASE, viewFitMultiplier: 0.85, scaleCoverage: 0.75 }),
    ).toBeCloseTo(0.6375)
  })

  it('always returns a value clamped to [0, 1]', () => {
    const result = computeMetricConfidence({
      ...BASE,
      viewFitMultiplier: 2, // out-of-range input should still clamp
    })
    expect(result).toBeLessThanOrEqual(1)
    expect(result).toBeGreaterThanOrEqual(0)
  })
})
