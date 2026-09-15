import { describe, expect, it } from 'vitest'
import {
  formatBandNumber,
  formatBandRange,
  formatBandValue,
  toDisplayNumber,
} from './formatBandValue'
import { METRIC_GUIDANCE } from './metricGuidance'
import type { ReferenceBand } from './types'

function bandOf(metric: keyof typeof METRIC_GUIDANCE): ReferenceBand {
  const band = METRIC_GUIDANCE[metric].band
  if (band === null) throw new Error(`${metric} carries no band`)
  return band
}

describe('toDisplayNumber', () => {
  it('scales exactly the two 0..1 units by 100, and leaves the others as computed', () => {
    expect(toDisplayNumber(0.0375, 'percent')).toBeCloseTo(3.75, 12)
    expect(toDisplayNumber(0.15, 'ratio')).toBeCloseTo(15, 12)
    expect(toDisplayNumber(163, 'stepsPerMinute')).toBe(163)
    expect(toDisplayNumber(6, 'centimeters')).toBe(6)
    expect(toDisplayNumber(-2.5, 'degrees')).toBe(-2.5)
  })
})

describe('formatBandValue', () => {
  it('formats each unit at its published precision', () => {
    expect(formatBandValue(171.6, 'stepsPerMinute')).toBe('172 steps/min')
    expect(formatBandValue(0.0305, 'percent')).toBe('3.05%')
    expect(formatBandValue(4.421467928439415, 'centimeters')).toBe('4.4 cm')
    expect(formatBandValue(10.34, 'degrees')).toBe('10.3°')
    expect(formatBandValue(0.1234, 'ratio')).toBe('12.3% of torso length')
  })

  it("multiplies 'percent' by 100 exactly once: 0.031 is 3.10%, not 0.03% or 310.00%", () => {
    expect(formatBandValue(0.031, 'percent')).toBe('3.10%')
  })

  it("prints verticalRatio's real bounds as Garmin's halved table, gaps intact", () => {
    const printed = bandOf('verticalRatio').zones.map((zone) =>
      formatBandRange(zone.min, zone.max, 'percent'),
    )
    expect(printed).toEqual([
      'below 3.05%',
      '3.05–3.70%',
      '3.75–4.30%',
      '4.35–5.05%',
      'above 5.05%',
    ])
  })

  it("prints cadence's real bounds with the published one-step gaps", () => {
    const printed = bandOf('cadence').zones.map((zone) =>
      formatBandRange(zone.min, zone.max, 'stepsPerMinute'),
    )
    expect(printed).toEqual([
      'below 153 steps/min',
      '153–163 steps/min',
      '164–173 steps/min',
      '174–183 steps/min',
      'above 183 steps/min',
    ])
  })

  it('adds precision on request', () => {
    expect(formatBandValue(163.44, 'stepsPerMinute', 1)).toBe('163.4 steps/min')
    expect(formatBandNumber(0.03702, 'percent', 1)).toBe('3.702')
  })

  it('never prints a signed zero', () => {
    expect(formatBandValue(-0.04, 'degrees')).toBe('0.0°')
    expect(formatBandValue(-0.0004, 'ratio')).toBe('0.0% of torso length')
    expect(formatBandValue(-0.4, 'degrees')).toBe('-0.4°')
  })

  it('separates a range with a negative lower bound by "to", not a dash', () => {
    expect(formatBandRange(-2, 5, 'degrees')).toBe('-2.0 to 5.0°')
    expect(formatBandRange(71.3, 129, 'degrees')).toBe('71.3–129.0°')
  })

  it('in the spoken style, separates by " to " and spells the unit, for sentences and text alternatives', () => {
    expect(formatBandRange(164, 173, 'stepsPerMinute', 'spoken')).toBe(
      '164 to 173 steps per minute',
    )
    expect(formatBandRange(null, 153, 'stepsPerMinute', 'spoken')).toBe(
      'below 153 steps per minute',
    )
    expect(formatBandRange(0.0305, 0.037, 'percent', 'spoken')).toBe(
      '3.05 to 3.70%',
    )
    expect(formatBandRange(6, 9.5, 'centimeters', 'spoken')).toBe(
      '6.0 to 9.5 centimetres',
    )
    expect(formatBandValue(105, 'degrees', 0, 'spoken')).toBe('105.0 degrees')
    expect(formatBandValue(0.1234, 'ratio', 0, 'spoken')).toBe(
      '12.3% of torso length',
    )
  })

  it('keeps the compact visual form by default, for aria-hidden tick and value labels', () => {
    expect(formatBandRange(164, 173, 'stepsPerMinute')).toBe(
      '164–173 steps/min',
    )
    expect(formatBandValue(6, 'centimeters')).toBe('6.0 cm')
  })
})
