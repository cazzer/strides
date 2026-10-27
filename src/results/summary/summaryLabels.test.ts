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
  it('cites the hip bounce and the stride length in torso lengths, and the median count', () => {
    expect(
      formatBounceDerivation({ figures: { bounceTorsoLengths: 0.153, strideTorsoLengths: 6.3 }, strideCount: 3 }),
    ).toBe('From hip bounce 15.3% of torso ÷ stride length 6.30 torsos (median of 3)')
    expect(
      formatBounceDerivation({ figures: { bounceTorsoLengths: 0.15, strideTorsoLengths: 3.75 }, strideCount: 1 }),
    ).toBe('From hip bounce 15.0% of torso ÷ stride length 3.75 torsos (one measurement)')
  })

  it('prints figures whose division agrees with the vertical ratio they derive', () => {
    for (let ratio = 0.04; ratio <= 0.11; ratio += 0.0013) {
      for (let stride = 3; stride <= 7; stride += 0.037) {
        const line = formatBounceDerivation({
          figures: { bounceTorsoLengths: ratio * stride, strideTorsoLengths: stride },
          strideCount: 3,
        })
        const [, bounce, strideShown] = /hip bounce ([\d.]+)% of torso ÷ stride length ([\d.]+) torsos/.exec(line)!
        expect(Math.abs(Number(bounce) / Number(strideShown) - ratio * 100)).toBeLessThan(0.05)
      }
    }
  })

  it('names the inputs alone when it has no same-clip figures', () => {
    expect(formatBounceDerivation({ figures: null, strideCount: 5 })).toBe(
      'From hip bounce ÷ stride length (median of 5)',
    )
  })

  it('stays within 14 words at its longest', () => {
    const longest = formatBounceDerivation({
      figures: { bounceTorsoLengths: 0.153, strideTorsoLengths: 12.34 },
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
