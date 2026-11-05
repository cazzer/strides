import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type { IndexEntry, IndexMetric } from '../storage/assessmentRecord'
import { ALL_METRIC_IDS } from '../storage/assessmentRecord'
import { PROGRESS_METRIC_ORDER, axisValue, dateLabels, progressSeries } from './progressSeries'

function entry(id: string, savedAt: string, overrides: Partial<Record<MetricId, Partial<IndexMetric>>> = {}): IndexEntry {
  const metrics = Object.fromEntries(
    ALL_METRIC_IDS.map((m) => [
      m,
      { value: null, unit: 'ratio', tier: 'excluded', confidence: 0, definitionVersion: 1, ...overrides[m] },
    ]),
  ) as Record<MetricId, IndexMetric>
  return { id, savedAt, localDate: savedAt.slice(0, 10), methodologyVersion: 1, views: ['side'], clipCount: 1, folderId: 'f', analysisFileId: 'a', metrics }
}

const cadence = (value: number, definitionVersion = 1, tier: IndexMetric['tier'] = 'normal') => ({
  cadence: { value, unit: 'stepsPerMinute' as const, tier, confidence: 0.9, definitionVersion },
})

describe('progressSeries', () => {
  it('orders every metric by focus area', () => {
    expect([...PROGRESS_METRIC_ORDER].sort()).toEqual([...ALL_METRIC_IDS].sort())
    expect(PROGRESS_METRIC_ORDER[0]).toBe('cadence')
  })

  it('omits metrics never measured and orders points oldest first', () => {
    const series = progressSeries([
      entry('b', '2026-11-12T09:00:00Z', cadence(170)),
      entry('a', '2026-11-05T09:00:00Z', cadence(165)),
    ])
    expect(series.map((s) => s.metric)).toEqual(['cadence'])
    expect(series[0].runs).toEqual([
      {
        definitionVersion: 1,
        points: [
          { id: 'a', savedAt: '2026-11-05T09:00:00Z', localDate: '2026-11-05', value: 165, tier: 'normal' },
          { id: 'b', savedAt: '2026-11-12T09:00:00Z', localDate: '2026-11-12', value: 170, tier: 'normal' },
        ],
      },
    ])
  })

  it('never joins readings across definition versions', () => {
    const [s] = progressSeries([
      entry('a', '2026-11-01T00:00:00Z', cadence(160, 1)),
      entry('b', '2026-11-02T00:00:00Z', cadence(162, 1)),
      entry('c', '2026-11-03T00:00:00Z', cadence(175, 2)),
    ])
    // Version 2 is newer than this build knows (1), so it is listed, not plotted.
    expect(s.runs.map((r) => [r.definitionVersion, r.points.map((p) => p.id)])).toEqual([[1, ['a', 'b']]])
    expect(s.newer).toEqual([{ id: 'c', localDate: '2026-11-03', savedAt: '2026-11-03T00:00:00Z', definitionVersion: 2 }])
  })

  it('splits readings into one run per definition version a newer build knows', () => {
    const [s] = progressSeries(
      [
        entry('a', '2026-11-01T00:00:00Z', cadence(160, 1)),
        entry('b', '2026-11-02T00:00:00Z', cadence(162, 1, 'caveated')),
        entry('c', '2026-11-03T00:00:00Z', cadence(175, 2)),
      ],
      () => 2,
    )
    expect(s.runs.map((r) => [r.definitionVersion, r.points.map((p) => `${p.id}:${p.tier}`)])).toEqual([
      [1, ['a:normal', 'b:caveated']],
      [2, ['c:normal']],
    ])
    expect(s.newer).toEqual([])
  })

  it('lists excluded readings as not measured and never plots them', () => {
    const [s] = progressSeries([
      entry('a', '2026-11-01T00:00:00Z', cadence(160)),
      entry('b', '2026-11-02T00:00:00Z'),
      entry('c', '2026-11-03T00:00:00Z', cadence(163)),
    ])
    expect(s.runs[0].points.map((p) => p.id)).toEqual(['a', 'c'])
    expect(s.notMeasured).toEqual([{ id: 'b', localDate: '2026-11-02', savedAt: '2026-11-02T00:00:00Z' }])
  })

  it('adds the time only where two saves share a day', () => {
    const labels = dateLabels([
      { id: 'a', localDate: '2026-11-05', savedAt: new Date(2026, 10, 5, 9, 5).toISOString() },
      { id: 'b', localDate: '2026-11-05', savedAt: new Date(2026, 10, 5, 14, 32).toISOString() },
      { id: 'c', localDate: '2026-11-06', savedAt: new Date(2026, 10, 6, 8, 0).toISOString() },
    ])
    expect([...labels.values()]).toEqual(['2026-11-05 09.05', '2026-11-05 14.32', '2026-11-06'])
  })

  it('shows ratios as percentages on the axis', () => {
    expect(axisValue('ratio', 0.081)).toBeCloseTo(8.1)
    expect(axisValue('centimeters', 7.2)).toBe(7.2)
  })
})
