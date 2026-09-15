import { describe, expect, it } from 'vitest'
import { formatMeasuredBandValue } from '../guidance/bandPosition'
import { formatGuidedValue, guidedHeadline } from './formatGuidedValue'
import { guidedGroups } from './guidedGroups'
import { makeHeuristics, makeMetric } from './__fixtures__/metricResult'

/**
 * Every expectation below is an input/output pair `MetricsPanel.test.tsx` already renders through
 * `MetricsPanel`'s private `formatValue`, so the guided view's copy of that formatter is pinned to
 * the same outputs the classic panel is. The value/unit pair is restated here with each literal's
 * origin rather than imported from that test file.
 */
describe('formatGuidedValue — matches MetricsPanel formatValue', () => {
  it('formats degrees at one decimal place with a degree sign (MetricsPanel: trunkLean 6 → 6.0°)', () => {
    expect(formatGuidedValue(makeMetric('trunkLean', { value: 6 }))).toBe('6.0°')
  })

  it('rounds steps per minute to a whole number (MetricsPanel: cadence 91 → 91 steps/min)', () => {
    expect(formatGuidedValue(makeMetric('cadence', { value: 91 }))).toBe('91 steps/min')
    expect(formatGuidedValue(makeMetric('cadence', { value: 163.5 }))).toBe('164 steps/min')
  })

  it("renders 'percent' as value × 100 at one decimal place with no suffix (MetricsPanel: 0.09 → 9.0%)", () => {
    expect(formatGuidedValue(makeMetric('verticalRatio', { value: 0.09 }))).toBe('9.0%')
  })

  it("renders 'centimeters' at one decimal place, not multiplied (MetricsPanel: 4.79 → 4.8 cm, 12.4 cm)", () => {
    expect(formatGuidedValue(makeMetric('verticalOscillationCm', { value: 4.79 }))).toBe('4.8 cm')
    expect(formatGuidedValue(makeMetric('stepWidthCm', { value: 12.4 }))).toBe('12.4 cm')
  })

  it("renders 'ratio' as a percentage of torso length (MetricsPanel: 0.18 → 18.0% of torso length)", () => {
    expect(formatGuidedValue(makeMetric('verticalOscillation', { value: 0.18 }))).toBe(
      '18.0% of torso length',
    )
  })

  it('classifies foot strike pattern instead of printing the ratio', () => {
    // footStrikeMidfootBandRatio defaults to 0.05; classifyFootStrike is strict on both sides.
    expect(formatGuidedValue(makeMetric('footStrikePattern', { value: 0.02 }))).toBe(
      'Midfoot strike (proxy)',
    )
    expect(formatGuidedValue(makeMetric('footStrikePattern', { value: 0.05 }))).toBe(
      'Midfoot strike (proxy)',
    )
    expect(formatGuidedValue(makeMetric('footStrikePattern', { value: 0.2 }))).toBe(
      'Heel strike (proxy)',
    )
    expect(formatGuidedValue(makeMetric('footStrikePattern', { value: -0.2 }))).toBe(
      'Forefoot strike (proxy)',
    )
  })

  it("says 'Not available' for a null value, as MetricsPanel's formatter does", () => {
    expect(formatGuidedValue(makeMetric('kneeDrive', { value: null }))).toBe('Not available')
  })
})

describe('guidedHeadline — one value for the card headline and the contents list', () => {
  it("prints a banded entry at its band's precision, so 163.5 is not rounded onto a bound", () => {
    const [entry] = guidedGroups(
      makeHeuristics({ cadence: makeMetric('cadence', { value: 163.5 }) }),
    ).banded
    expect(entry.metric.metric).toBe('cadence')
    expect(guidedHeadline(entry, false)).toBe(formatMeasuredBandValue(entry.band!, 163.5))
    expect(guidedHeadline(entry, false)).not.toBe(formatGuidedValue(entry.metric))
  })

  it('prints an unbanded entry exactly as the classic panel does', () => {
    for (const entry of guidedGroups(makeHeuristics()).unbanded) {
      expect(guidedHeadline(entry, false)).toBe(formatGuidedValue(entry.metric))
    }
  })

  it('prints nothing for an excluded entry, even one that carries a measured value', () => {
    const [entry] = guidedGroups(
      makeHeuristics({ stepWidth: makeMetric('stepWidth', { value: 0.2, viewFit: 'unsuitable' }) }),
    ).notMeasured
    expect(entry.metric.value).toBe(0.2)
    expect(guidedHeadline(entry, true)).toBeNull()
  })
})
