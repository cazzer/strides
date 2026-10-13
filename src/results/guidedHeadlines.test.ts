import { describe, expect, it } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import type { MetricGuidance } from '../guidance/types'
import { guidedGroups } from './guidedGroups'
import {
  STORY_SPOKESMEN,
  costlyThreshold,
  pastCostlySide,
  selectHeadlines,
} from './guidedHeadlines'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillationCm,
} from './__fixtures__/metricResult'

function heuristicsWith({
  cadence,
  vo,
  extra = {},
}: {
  cadence?: number | null
  vo?: number | null
  extra?: Partial<FormHeuristicsResult>
}): FormHeuristicsResult {
  return makeHeuristics({
    ...(cadence === undefined
      ? {}
      : {
          cadence: makeMetric('cadence', {
            value: cadence,
            ...(cadence === null ? { confidence: 0 } : {}),
          }),
        }),
    ...(vo === undefined
      ? {}
      : {
          verticalOscillationCm: makeVerticalOscillationCm({
            value: vo,
            ...(vo === null ? { confidence: 0, calibration: null } : {}),
          }),
        }),
    ...extra,
  })
}

function select(
  heuristics: FormHeuristicsResult,
  guidance: Record<MetricId, MetricGuidance> = METRIC_GUIDANCE,
) {
  return selectHeadlines(guidedGroups(heuristics, guidance))
}

function spokesmen(heuristics: FormHeuristicsResult): MetricId[] {
  return select(heuristics).headlines.map(({ entry }) => entry.metric.metric)
}

describe('which reading earns a headline', () => {
  it('gives bounce a headline at 10.4 cm, above the 6.0–9.5 cm band', () => {
    const { headlines } = select(heuristicsWith({ vo: 10.4 }))
    expect(headlines.map((h) => h.story)).toEqual(['bounce'])
    expect(headlines[0].entry.metric.metric).toBe('verticalOscillationCm')
    expect(headlines[0].consequence).toBe(
      METRIC_GUIDANCE.verticalOscillationCm.economyConsequence,
    )
  })

  it('gives bounce none inside the band, below it, or exactly on its upper bound', () => {
    for (const vo of [4.42, 8.0, 9.5]) {
      expect(spokesmen(heuristicsWith({ vo })), String(vo)).toEqual([])
    }
  })

  it('gives step rate a headline at 150, below Garmin’s 5th-percentile cut', () => {
    expect(spokesmen(heuristicsWith({ cadence: 150 }))).toEqual(['cadence'])
  })

  it('gives step rate none at exactly 153, or at 174', () => {
    expect(spokesmen(heuristicsWith({ cadence: 153 }))).toEqual([])
    expect(spokesmen(heuristicsWith({ cadence: 174 }))).toEqual([])
  })

  it('never triggers on the side the association does not point away from', () => {
    // A very high cadence and a very small bounce are past their bands the other way.
    expect(spokesmen(heuristicsWith({ cadence: 200, vo: 2 }))).toEqual([])
  })
})

describe('one fixed spokesman per story, with no fallback', () => {
  it('names cadence and centimetre bounce as the only spokesmen', () => {
    expect(STORY_SPOKESMEN.map((s) => [s.story, s.spokesman])).toEqual([
      ['stepRate', 'cadence'],
      ['bounce', 'verticalOscillationCm'],
    ])
  })

  it('produces no step-rate headline when cadence is not measured, whatever overstriding reads', () => {
    const heuristics = heuristicsWith({
      cadence: null,
      extra: { overstriding: makeMetric('overstriding', { value: 0.9 }) },
    })
    expect(spokesmen(heuristics)).toEqual([])
    expect(select(heuristics).unmeasured).toEqual(['cadence'])
  })

  it('produces no bounce headline from a large torso-relative bounce when centimetres are null', () => {
    const heuristics = heuristicsWith({
      vo: null,
      extra: {
        verticalOscillation: {
          ...makeHeuristics().verticalOscillation,
          value: 0.6,
        },
        verticalRatio: makeMetric('verticalRatio', { value: 0.2 }),
      },
    })
    expect(spokesmen(heuristics)).toEqual([])
    expect(select(heuristics).unmeasured).toEqual(['verticalOscillationCm'])
  })

  it('produces none from an excluded spokesman even when its value is past the band', () => {
    const heuristics = heuristicsWith({
      extra: {
        cadence: makeMetric('cadence', { value: 140, viewFit: 'unsuitable' }),
      },
    })
    expect(spokesmen(heuristics)).toEqual([])
    expect(select(heuristics).unmeasured).toEqual(['cadence'])
  })

  it('produces none from a spokesman whose band is withheld for missing provenance', () => {
    const guidance: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      cadence: {
        ...METRIC_GUIDANCE.cadence,
        band: {
          ...METRIC_GUIDANCE.cadence.band!,
          source: { ...METRIC_GUIDANCE.cadence.band!.source, sampleSize: '' },
        },
      },
    }
    const result = select(heuristicsWith({ cadence: 140 }), guidance)
    expect(result.headlines).toEqual([])
    // Measured, so not "unmeasured" either.
    expect(result.unmeasured).toEqual([])
  })
})

describe('order is evidence rank, never the readings', () => {
  it('puts step rate before bounce when both trigger', () => {
    expect(spokesmen(heuristicsWith({ cadence: 150, vo: 10.4 }))).toEqual([
      'cadence',
      'verticalOscillationCm',
    ])
  })

  it('keeps that order however far each reading sits past its band', () => {
    expect(spokesmen(heuristicsWith({ cadence: 152.9, vo: 30 }))).toEqual([
      'cadence',
      'verticalOscillationCm',
    ])
    expect(spokesmen(heuristicsWith({ cadence: 100, vo: 9.6 }))).toEqual([
      'cadence',
      'verticalOscillationCm',
    ])
  })

  it('lists both unmeasured spokesmen in rank order', () => {
    expect(
      select(heuristicsWith({ cadence: null, vo: null })).unmeasured,
    ).toEqual(['cadence', 'verticalOscillationCm'])
  })
})

describe('pastCostlySide and costlyThreshold', () => {
  it('is false for a metric with no economy consequence', () => {
    const { banded } = guidedGroups(
      makeHeuristics({ trunkLean: makeMetric('trunkLean', { value: 80 }) }),
    )
    const trunk = banded.find((e) => e.metric.metric === 'trunkLean')!
    expect(pastCostlySide(trunk)).toBe(false)
  })

  it('states each trigger as a position taken from the band itself', () => {
    expect(costlyThreshold(METRIC_GUIDANCE.cadence)).toBe(
      "below the 5th percentile of Garmin's table",
    )
    expect(costlyThreshold(METRIC_GUIDANCE.verticalOscillationCm)).toBe(
      'above 9.5 cm',
    )
    expect(costlyThreshold(METRIC_GUIDANCE.trunkLean)).toBeNull()
  })
})
