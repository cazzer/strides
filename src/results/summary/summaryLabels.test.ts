import { describe, expect, it } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import type { FocusAreaId } from '../../guidance/focusAreas'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import { makeHeuristics, makeMetric } from '../__fixtures__/metricResult'
import { guidedGroups } from '../guidedGroups'
import { SHORT_METRIC_LABELS, alsoMeasuredNames, formatBounceDerivation, hasCompactBar } from './summaryLabels'
import { summaryRows } from './summaryRows'

describe('SHORT_METRIC_LABELS', () => {
  it('names every metric but foot strike, whose value names itself', () => {
    const ids = Object.keys(METRIC_GUIDANCE) as MetricId[]
    expect(ids.filter((id) => SHORT_METRIC_LABELS[id] === undefined)).toEqual(['footStrikePattern'])
  })
})

function laterReadings(heuristics: FormHeuristicsResult, area: FocusAreaId) {
  return summaryRows(heuristics).areas.find(({ view }) => view.area === area)!.readings.slice(1)
}

describe('alsoMeasuredNames', () => {
  it('names the bounce composite once, by its headline', () => {
    expect(alsoMeasuredNames(laterReadings(makeHeuristics(), 'rhythm'))).toEqual(['Vertical ratio'])
    const noRatio = makeHeuristics({ verticalRatio: makeMetric('verticalRatio', { value: null, confidence: 0 }) })
    expect(alsoMeasuredNames(laterReadings(noRatio, 'rhythm'))).toEqual(['Vertical oscillation (cm)'])
  })

  it('lists every other later reading by its full name', () => {
    expect(alsoMeasuredNames(laterReadings(makeHeuristics(), 'footPath'))).toEqual([
      'Step width',
      'Swing-foot lateral excursion',
    ])
  })
})

describe('formatBounceDerivation', () => {
  const cm = { metric: 'verticalOscillationCm', value: 7.19338, unit: 'centimeters' } as const
  it('cites the bounce, the stride in torso lengths and the strides, in words', () => {
    expect(formatBounceDerivation({ bounce: cm, strideTorsoLengths: 4.567, strideCount: 5 })).toBe(
      'From bounce 7.2 cm and stride 4.6 torso lengths (5 strides)',
    )
    expect(
      formatBounceDerivation({
        bounce: { metric: 'verticalOscillation', value: 0.153, unit: 'ratio' },
        strideTorsoLengths: 3.75,
        strideCount: 1,
      }),
    ).toBe('From bounce 15.3% of torso length and stride 3.8 torso lengths (1 stride)')
  })

  it('leaves out what it cannot cite', () => {
    expect(formatBounceDerivation({ bounce: cm, strideTorsoLengths: null, strideCount: 5 })).toBe(
      'From bounce 7.2 cm and 5 strides',
    )
    expect(formatBounceDerivation({ bounce: null, strideTorsoLengths: null, strideCount: 1 })).toBe('From 1 stride')
  })

  it('stays within 14 words at its longest', () => {
    const longest = formatBounceDerivation({
      bounce: { metric: 'verticalOscillation', value: 0.153, unit: 'ratio' },
      strideTorsoLengths: 12.34,
      strideCount: 12,
    })
    expect(longest.split(/\s+/).length).toBeLessThanOrEqual(14)
  })
})

describe('hasCompactBar', () => {
  it('is true for a banded measured entry and false for an unbanded one', () => {
    const { banded, unbanded } = guidedGroups(
      makeHeuristics({ armSwingAmplitude: makeMetric('armSwingAmplitude') }),
    )
    expect(banded.length).toBeGreaterThan(0)
    for (const entry of banded) expect(hasCompactBar(entry), entry.metric.metric).toBe(true)
    for (const entry of unbanded) expect(hasCompactBar(entry), entry.metric.metric).toBe(false)
  })
})
