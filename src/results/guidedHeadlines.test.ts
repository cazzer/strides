import { describe, expect, it } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import type { MetricGuidance } from '../guidance/types'
import { guidedGroups } from './guidedGroups'
import type { ScalePassStatus } from './types'
import type { StoryStatus } from './guidedHeadlines'
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
  scalePassStatus: ScalePassStatus = 'done',
) {
  return selectHeadlines(guidedGroups(heuristics, guidance), scalePassStatus)
}

function statuses(
  heuristics: FormHeuristicsResult,
  guidance: Record<MetricId, MetricGuidance> = METRIC_GUIDANCE,
  scalePassStatus: ScalePassStatus = 'done',
): Record<string, StoryStatus> {
  return Object.fromEntries(
    select(heuristics, guidance, scalePassStatus).stories.map((s) => [
      s.story,
      s.status,
    ]),
  )
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
    expect(statuses(heuristics).stepRate).toBe('unmeasured')
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
    expect(statuses(heuristics).bounce).toBe('unmeasured')
  })

  it('produces none from an excluded spokesman even when its value is past the band', () => {
    const heuristics = heuristicsWith({
      extra: {
        cadence: makeMetric('cadence', { value: 140, viewFit: 'unsuitable' }),
      },
    })
    expect(spokesmen(heuristics)).toEqual([])
    expect(statuses(heuristics).stepRate).toBe('unmeasured')
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
    // Measured, so not "unmeasured" either: there is no shown band to place it against.
    expect(result.stories[0].status).toBe('unbanded')
    // And no position is named against a band the page withholds.
    expect(result.stories[0].threshold).toBeNull()
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

  it('reports both stories in rank order, whatever their status', () => {
    const { stories } = select(heuristicsWith({ cadence: null, vo: 10.4 }))
    expect(stories.map((s) => [s.story, s.status])).toEqual([
      ['stepRate', 'unmeasured'],
      ['bounce', 'headline'],
    ])
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

  it('names no position against a band withheld for missing provenance', () => {
    const withheld: MetricGuidance = {
      ...METRIC_GUIDANCE.verticalOscillationCm,
      band: {
        ...METRIC_GUIDANCE.verticalOscillationCm.band!,
        source: {
          ...METRIC_GUIDANCE.verticalOscillationCm.band!.source,
          title: ' ',
        },
      },
    }
    expect(costlyThreshold(withheld)).toBeNull()
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

describe('only a normal-tier reading headlines (review round 1)', () => {
  it('headlines a normal-tier 10.4 cm', () => {
    expect(statuses(heuristicsWith({ vo: 10.4 })).bounce).toBe('headline')
  })

  it('reports a caveated 10.4 cm as past its point at low confidence, without a headline', () => {
    const heuristics = makeHeuristics({
      verticalOscillationCm: makeVerticalOscillationCm({
        value: 10.4,
        confidence: 0.05,
      }),
    })
    expect(select(heuristics).headlines).toEqual([])
    expect(statuses(heuristics).bounce).toBe('caveated-past')
  })

  it('reports a caveated reading inside its point as inside, not as caveated', () => {
    const heuristics = makeHeuristics({
      cadence: makeMetric('cadence', { value: 170, confidence: 0.3 }),
    })
    expect(statuses(heuristics).stepRate).toBe('inside')
  })
})

describe('story status', () => {
  it('reads an unmeasured centimetre bounce as pending while the scale pass runs', () => {
    for (const status of ['pending', 'running'] as const) {
      expect(
        statuses(heuristicsWith({ vo: null }), METRIC_GUIDANCE, status).bounce,
        status,
      ).toBe('pending')
    }
    for (const status of ['done', 'failed', 'idle'] as const) {
      expect(
        statuses(heuristicsWith({ vo: null }), METRIC_GUIDANCE, status).bounce,
        status,
      ).toBe('unmeasured')
    }
  })

  it('never reads an unmeasured step rate as pending: it is not a scale-pass metric', () => {
    expect(
      statuses(heuristicsWith({ cadence: null }), METRIC_GUIDANCE, 'running')
        .stepRate,
    ).toBe('unmeasured')
  })

  it('reads both inside on an unremarkable clip', () => {
    expect(statuses(heuristicsWith({ cadence: 174, vo: 4.42 }))).toEqual({
      stepRate: 'inside',
      bounce: 'inside',
    })
  })
})
