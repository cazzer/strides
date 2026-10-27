import { describe, expect, it } from 'vitest'
import type { MetricId } from '../../heuristics/types'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import { makeHeuristics, makeMetric } from '../__fixtures__/metricResult'
import { guidedGroups } from '../guidedGroups'
import { SHORT_METRIC_LABELS, alsoMeasuredNames, hasCompactBar } from './summaryLabels'

describe('SHORT_METRIC_LABELS', () => {
  it('names every metric but foot strike, whose value names itself', () => {
    const ids = Object.keys(METRIC_GUIDANCE) as MetricId[]
    expect(ids.filter((id) => SHORT_METRIC_LABELS[id] === undefined)).toEqual(['footStrikePattern'])
  })
})

describe('alsoMeasuredNames', () => {
  it('collapses two or more bounce measures into one entry naming only those present', () => {
    expect(alsoMeasuredNames(['verticalOscillationCm', 'verticalRatio', 'verticalOscillation'])).toEqual([
      'bounce (cm, ratio, % torso)',
    ])
    expect(alsoMeasuredNames(['verticalRatio', 'verticalOscillation'])).toEqual(['bounce (ratio, % torso)'])
  })

  it('lists a lone bounce measure and everything else by its full name', () => {
    expect(alsoMeasuredNames(['verticalRatio'])).toEqual(['Vertical ratio'])
    expect(alsoMeasuredNames(['kneeDrive', 'swingFootLateralExcursion'])).toEqual([
      'Knee drive',
      'Swing-foot lateral excursion',
    ])
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
