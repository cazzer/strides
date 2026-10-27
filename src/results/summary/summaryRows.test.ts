import { describe, expect, it } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '../../guidance/focusAreas'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillationCm,
} from '../__fixtures__/metricResult'
import { metricTier } from '../metricConfidence'
import { summaryRows } from './summaryRows'

const ALL_IDS = Object.keys(METRIC_GUIDANCE) as MetricId[]

function withUnmeasured(ids: readonly MetricId[]): FormHeuristicsResult {
  const overrides: Partial<FormHeuristicsResult> = {}
  for (const id of ids) {
    if (id === 'verticalOscillationCm') {
      overrides.verticalOscillationCm = makeVerticalOscillationCm({
        value: null,
        confidence: 0,
        calibration: null,
      })
    } else {
      Object.assign(overrides, { [id]: makeMetric(id, { value: null, confidence: 0 }) })
    }
  }
  return makeHeuristics(overrides)
}

function placements(heuristics: FormHeuristicsResult): MetricId[] {
  const { areas, notMeasured } = summaryRows(heuristics)
  return [
    ...areas.flatMap(({ entries }) => entries.map((entry) => entry.metric.metric)),
    ...notMeasured.map((entry) => entry.metric.metric),
  ]
}

describe('summaryRows', () => {
  it.each([
    ['every metric measured', makeHeuristics()],
    ['some excluded', withUnmeasured(['kneeDrive', 'stepWidthCm', 'cadence'])],
    ['a whole area excluded', withUnmeasured(['armSwingAmplitude', 'trunkLean'])],
    ['everything excluded', withUnmeasured(ALL_IDS)],
  ])('places each of the thirteen metrics exactly once (%s)', (_, heuristics) => {
    const placed = placements(heuristics)
    expect(ALL_IDS).toHaveLength(13)
    expect([...placed].sort()).toEqual([...ALL_IDS].sort())
  })

  it('never puts an excluded metric in an area row, and puts every one in Not measured', () => {
    const excluded: MetricId[] = ['kneeDrive', 'stepWidthCm', 'cadence', 'overstriding']
    const heuristics = withUnmeasured(excluded)
    const { areas, notMeasured } = summaryRows(heuristics)
    for (const { entries } of areas) {
      for (const entry of entries) {
        expect(metricTier(entry.metric), entry.metric.metric).not.toBe('excluded')
      }
    }
    expect(notMeasured.map((entry) => entry.metric.metric).sort()).toEqual(
      ALL_IDS.filter((id) => metricTier(heuristics[id]) === 'excluded').sort(),
    )
    expect(notMeasured.map((entry) => entry.metric.metric)).toEqual(
      expect.arrayContaining(excluded),
    )
  })

  it('gives an area with every metric excluded no row', () => {
    const { areas } = summaryRows(withUnmeasured(['kneeFlexion', 'kneeDrive']))
    expect(areas.map(({ view }) => view.area)).not.toContain('knees')
  })

  it('heads each row with its first measured metric, in preference order', () => {
    const { areas } = summaryRows(withUnmeasured(['cadence']))
    const rhythm = areas.find(({ view }) => view.area === 'rhythm')!
    const expected = FOCUS_AREAS.rhythm.metricIds.filter((id) => id !== 'cadence')
    expect(rhythm.entries.map((entry) => entry.metric.metric)).toEqual(
      expected.filter((id) => metricTier(withUnmeasured(['cadence'])[id]) !== 'excluded'),
    )
    expect(rhythm.entries[0].metric.metric).toBe(rhythm.view.headline!.metric.metric)
  })

  it('puts centimetre bounce in Not measured while the scale pass has not grafted it', () => {
    // The pending scale pass leaves the centimetre metrics null until it grafts them.
    const { areas, notMeasured } = summaryRows(withUnmeasured(['verticalOscillationCm', 'stepWidthCm']))
    expect(notMeasured.map((entry) => entry.metric.metric)).toContain('verticalOscillationCm')
    const rhythm = areas.find(({ view }) => view.area === 'rhythm')!
    expect(rhythm.entries.map((entry) => entry.metric.metric)).not.toContain('verticalOscillationCm')
  })

  it('orders the rows by FOCUS_AREA_ORDER, never by value', () => {
    const order = (heuristics: FormHeuristicsResult) =>
      summaryRows(heuristics).areas.map(({ view }) => view.area)
    const all = order(makeHeuristics())
    expect(all).toEqual(FOCUS_AREA_ORDER.filter((area) => all.includes(area)))
    const shifted = order(
      makeHeuristics({
        cadence: makeMetric('cadence', { value: 140 }),
        trunkLean: makeMetric('trunkLean', { value: 25 }),
      }),
    )
    expect(shifted).toEqual(all)
  })

  it('takes each entry from the guided groups, so a card gets the same band the guided view gives it', () => {
    const { areas } = summaryRows(makeHeuristics())
    for (const { entries } of areas) {
      for (const entry of entries) {
        expect(entry.guidance).toBe(METRIC_GUIDANCE[entry.metric.metric])
      }
    }
    const cadence = areas.flatMap(({ entries }) => entries).find((e) => e.metric.metric === 'cadence')!
    expect(cadence.band).not.toBeNull()
  })

  it('groups each row’s entries into readings without changing the entries', () => {
    const { areas } = summaryRows(makeHeuristics())
    const rhythm = areas.find(({ view }) => view.area === 'rhythm')!
    // `entries` keeps the area's preference order: the runner focus and the evidence map read it.
    expect(rhythm.entries.map((entry) => entry.metric.metric)).toEqual(FOCUS_AREAS.rhythm.metricIds)
    expect(rhythm.readings.map((reading) => reading.kind)).toEqual(['single', 'composite'])
    const bounce = rhythm.readings[1]
    if (bounce.kind !== 'composite') throw new Error('bounce is not a composite')
    expect([bounce.headline, ...bounce.members].map((entry) => entry.metric.metric)).toEqual([
      'verticalRatio',
      'verticalOscillationCm',
      'verticalOscillation',
    ])
    // Every other area: one reading per entry, in the same order.
    for (const { view, entries, readings } of areas.filter(({ view }) => view.area !== 'rhythm')) {
      expect(readings.map((reading) => reading.kind === 'single' && reading.item), view.area).toEqual(entries)
    }
  })

  it('carries the bounce derivation on the rhythm row only, guarded to vertical ratio’s clip', () => {
    const { areas } = summaryRows(makeHeuristics())
    expect(areas.find(({ view }) => view.area === 'rhythm')!.bounce).toEqual({
      figures: { bounceTorsoLengths: 0.15, strideTorsoLengths: expect.closeTo(3.75, 10) },
      strideCount: 7,
    })
    expect(areas.filter(({ bounce }) => bounce !== null)).toHaveLength(1)
    const sourceIndices = Object.fromEntries(ALL_IDS.map((id) => [id, 0])) as Record<MetricId, number>
    const mixed = summaryRows(makeHeuristics(), {
      sourceIndices: { ...sourceIndices, verticalOscillation: 1 },
    })
    expect(mixed.areas.find(({ view }) => view.area === 'rhythm')!.bounce).toEqual({
      figures: null,
      strideCount: 7,
    })
    expect(summaryRows(withUnmeasured(['verticalRatio'])).areas[0].bounce).toBeNull()
  })

  it('returns all six areas’ views, measured or not, in tour order', () => {
    const { views, areas } = summaryRows(withUnmeasured(['armSwingAmplitude']))
    expect(views.map((view) => view.area)).toEqual(FOCUS_AREA_ORDER)
    expect(views.find((view) => view.area === 'arms')?.measured).toBe(false)
    expect(areas.map((area) => area.view)).toEqual(views.filter((view) => view.measured))
  })
})
