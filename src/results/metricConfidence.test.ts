import { describe, expect, it } from 'vitest'
import {
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  metricTier,
} from './metricConfidence'
import type { MetricResult } from '../heuristics/types'

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 20,
    caveat: null,
    ...overrides,
  }
}

describe('metricTier', () => {
  it('is "normal" exactly at the high-confidence boundary (0.7)', () => {
    expect(metricTier(makeMetric({ confidence: HIGH_CONFIDENCE_THRESHOLD }))).toBe('normal')
  })

  it('is "normal" above the high-confidence boundary', () => {
    expect(metricTier(makeMetric({ confidence: 0.95 }))).toBe('normal')
  })

  it('is "caveated" exactly at the low-confidence boundary (0.4)', () => {
    expect(metricTier(makeMetric({ confidence: LOW_CONFIDENCE_THRESHOLD }))).toBe('caveated')
  })

  it('is "caveated" just below the high-confidence boundary', () => {
    expect(metricTier(makeMetric({ confidence: 0.69 }))).toBe('caveated')
  })

  it('is "excluded" just below the low-confidence boundary', () => {
    expect(metricTier(makeMetric({ confidence: 0.39 }))).toBe('excluded')
  })

  it('is "excluded" for a null value even at high confidence', () => {
    expect(
      metricTier(makeMetric({ value: null, confidence: 0.95 })),
    ).toBe('excluded')
  })

  it('is "excluded" for a null value at confidence 0', () => {
    expect(metricTier(makeMetric({ value: null, confidence: 0 }))).toBe('excluded')
  })

  it('is "excluded" for confidence 0 with a non-null value', () => {
    expect(metricTier(makeMetric({ value: 5, confidence: 0 }))).toBe('excluded')
  })

  it('is "excluded" for confidence 1 exactly at the null-value boundary', () => {
    // A pathological but type-legal combination (a "perfectly confident" null) — null still wins.
    expect(metricTier(makeMetric({ value: null, confidence: 1 }))).toBe('excluded')
  })

  it('is "excluded" for any viewFit: unsuitable metric, via the confidence clause alone', () => {
    // DEFAULT_VIEW_FIT_TABLE caps every 'unsuitable' multiplier at 0.2 -- confidence, a product of
    // factors each <= 1, can never clear LOW_CONFIDENCE_THRESHOLD (0.4) from there. metricTier
    // deliberately doesn't inspect viewFit at all; this documents why that's still correct.
    expect(
      metricTier(makeMetric({ viewFit: 'unsuitable', confidence: 0.2, value: 3 })),
    ).toBe('excluded')
  })
})
