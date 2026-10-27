import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import { makeHeuristics } from '../results/__fixtures__/metricResult'
import { METRIC_LABELS } from '../results/metricConfidence'
import type { MetricTier } from './types'
import { FOCUS_AREAS, FOCUS_AREA_ORDER, focusAreaView } from './focusAreas'

/** Every `MetricId`, as a literal; pinned against `METRIC_LABELS`' keys below. */
const METRIC_IDS: readonly MetricId[] = [
  'verticalOscillation',
  'verticalRatio',
  'verticalOscillationCm',
  'trunkLean',
  'overstriding',
  'cadence',
  'kneeFlexion',
  'footStrikePattern',
  'stepWidth',
  'stepWidthCm',
  'kneeDrive',
  'armSwingAmplitude',
  'swingFootLateralExcursion',
]

function tiersWith(
  overrides: Partial<Record<MetricId, MetricTier>> = {},
): Record<MetricId, MetricTier> {
  const tiers = Object.fromEntries(
    METRIC_IDS.map((id) => [id, 'normal' as MetricTier]),
  ) as Record<MetricId, MetricTier>
  return { ...tiers, ...overrides }
}

describe('FOCUS_AREAS', () => {
  it('names every MetricId', () => {
    expect([...METRIC_IDS].sort()).toEqual(Object.keys(METRIC_LABELS).sort())
    expect(METRIC_IDS).toHaveLength(13)
  })

  it('puts every MetricId in exactly one area', () => {
    const all = FOCUS_AREA_ORDER.flatMap((area) => FOCUS_AREAS[area].metricIds)
    expect(all).toHaveLength(METRIC_IDS.length)
    expect([...all].sort()).toEqual([...METRIC_IDS].sort())
  })

  it('keeps the tour order fixed', () => {
    expect(FOCUS_AREA_ORDER).toEqual([
      'rhythm',
      'arms',
      'posture',
      'knees',
      'landing',
      'footPath',
    ])
    expect(Object.keys(FOCUS_AREAS).sort()).toEqual(
      [...FOCUS_AREA_ORDER].sort(),
    )
  })

  it('pins each area to its metrics in headline-preference order', () => {
    expect(FOCUS_AREAS.rhythm.metricIds).toEqual([
      'cadence',
      'verticalOscillationCm',
      'verticalRatio',
      'verticalOscillation',
    ])
    expect(FOCUS_AREAS.arms.metricIds).toEqual(['armSwingAmplitude'])
    expect(FOCUS_AREAS.posture.metricIds).toEqual(['trunkLean'])
    expect(FOCUS_AREAS.knees.metricIds).toEqual(['kneeFlexion', 'kneeDrive'])
    expect(FOCUS_AREAS.landing.metricIds).toEqual([
      'overstriding',
      'footStrikePattern',
    ])
    expect(FOCUS_AREAS.footPath.metricIds).toEqual([
      'stepWidthCm',
      'stepWidth',
      'swingFootLateralExcursion',
    ])
  })

  it.each(FOCUS_AREA_ORDER)('labels %s in one or two words', (area) => {
    const words = FOCUS_AREAS[area].label.trim().split(/\s+/).filter(Boolean)
    expect(words.length).toBeGreaterThanOrEqual(1)
    expect(words.length).toBeLessThanOrEqual(2)
  })
})

describe('focusAreaView', () => {
  const fused = makeHeuristics()

  it('headlines the first metric in preference order when all are measured', () => {
    const view = focusAreaView('rhythm', fused, tiersWith())
    expect(view.area).toBe('rhythm')
    expect(view.label).toBe('Rhythm')
    expect(view.measured).toBe(true)
    expect(view.headline?.metric.metric).toBe('cadence')
    expect(view.headline?.tier).toBe('normal')
    expect(view.supporting.map((focus) => focus.metric.metric)).toEqual([
      'verticalOscillationCm',
      'verticalRatio',
      'verticalOscillation',
    ])
  })

  it('skips excluded metrics for the headline and the supporting list', () => {
    const view = focusAreaView(
      'rhythm',
      fused,
      tiersWith({ cadence: 'excluded', verticalRatio: 'excluded' }),
    )
    expect(view.headline?.metric.metric).toBe('verticalOscillationCm')
    expect(view.supporting.map((focus) => focus.metric.metric)).toEqual([
      'verticalOscillation',
    ])
    expect(view.excluded.map((focus) => focus.metric.metric)).toEqual([
      'cadence',
      'verticalRatio',
    ])
  })

  it('headlines a caveated metric ahead of a later normal one', () => {
    const view = focusAreaView(
      'footPath',
      fused,
      tiersWith({ stepWidthCm: 'caveated' }),
    )
    expect(view.headline?.metric.metric).toBe('stepWidthCm')
    expect(view.headline?.tier).toBe('caveated')
  })

  it('respects the preference order in every area', () => {
    for (const area of FOCUS_AREA_ORDER) {
      const ids = FOCUS_AREAS[area].metricIds
      ids.forEach((id, index) => {
        const excluded = Object.fromEntries(
          ids
            .slice(0, index)
            .map((earlier) => [earlier, 'excluded' as MetricTier]),
        )
        const view = focusAreaView(area, fused, tiersWith(excluded))
        expect(view.headline?.metric.metric, `${area} at ${index}`).toBe(id)
        expect(view.supporting.map((focus) => focus.metric.metric)).toEqual(
          ids.slice(index + 1),
        )
      })
    }
  })

  it('reports measured=false when every metric in the area is excluded', () => {
    for (const area of FOCUS_AREA_ORDER) {
      const excluded = Object.fromEntries(
        FOCUS_AREAS[area].metricIds.map((id) => [id, 'excluded' as MetricTier]),
      )
      const view = focusAreaView(area, fused, tiersWith(excluded))
      expect(view.measured).toBe(false)
      expect(view.headline).toBeNull()
      expect(view.supporting).toEqual([])
      expect(view.excluded.map((focus) => focus.metric.metric)).toEqual(
        FOCUS_AREAS[area].metricIds,
      )
    }
  })
})
