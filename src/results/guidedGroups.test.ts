import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE, guidanceInDisplayOrder } from '../guidance/metricGuidance'
import type { MetricGuidance } from '../guidance/types'
import { guidedGroups, renderableBand, sourceHasProvenance } from './guidedGroups'
import { makeHeuristics, makeMetric } from './__fixtures__/metricResult'

const ids = (entries: { metric: { metric: MetricId } }[]) => entries.map((e) => e.metric.metric)

/** Every metric in display order, from the data layer — never hardcoded here, so a guidance edit
 * that moves a band or a rank moves these expectations with it. */
const DISPLAY_ORDER = guidanceInDisplayOrder().map((g) => g.metric)
const BANDED_ORDER = guidanceInDisplayOrder()
  .filter((g) => g.band !== null)
  .map((g) => g.metric)
const UNBANDED_ORDER = guidanceInDisplayOrder()
  .filter((g) => g.band === null)
  .map((g) => g.metric)

describe('guidedGroups — the three groups, by what can honestly be said', () => {
  it('puts every measured metric with a band in group 1 and every other measured metric in group 2, for the default fixture', () => {
    const groups = guidedGroups(makeHeuristics())
    expect(ids(groups.banded)).toEqual(BANDED_ORDER)
    expect(ids(groups.unbanded)).toEqual(UNBANDED_ORDER)
    expect(groups.notMeasured).toEqual([])
    // The shipped record's shape, recorded as a sanity check on the derivation above.
    expect([groups.banded.length, groups.unbanded.length, groups.notMeasured.length]).toEqual([
      5, 7, 0,
    ])
  })

  it('accounts for all twelve metrics exactly once', () => {
    const groups = guidedGroups(makeHeuristics())
    const all = [...groups.banded, ...groups.unbanded, ...groups.notMeasured].map(
      (e) => e.metric.metric,
    )
    expect([...all].sort()).toEqual([...DISPLAY_ORDER].sort())
  })

  it('moves a metric to group 3 when its value is null, keeping rank order there', () => {
    const groups = guidedGroups(
      makeHeuristics({
        cadence: makeMetric('cadence', { value: null, confidence: 0, caveat: 'no rhythm' }),
        kneeDrive: makeMetric('kneeDrive', { value: null, confidence: 0, caveat: 'no knee' }),
        trunkLean: makeMetric('trunkLean', { value: null, confidence: 0, caveat: 'no torso' }),
      }),
    )
    expect(ids(groups.notMeasured)).toEqual(
      DISPLAY_ORDER.filter((id) => ['cadence', 'kneeDrive', 'trunkLean'].includes(id)),
    )
    expect(ids(groups.banded)).not.toContain('cadence')
    expect(ids(groups.unbanded)).not.toContain('kneeDrive')
  })

  it("moves a measured metric with an unsuitable view to group 3 — metricTier's rule, not a value check", () => {
    const groups = guidedGroups(
      makeHeuristics({ stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }) }),
    )
    expect(ids(groups.notMeasured)).toEqual(['stepWidth'])
    expect(groups.notMeasured[0].band).toBeNull()
  })

  it('keeps a low-confidence measured metric in its measured group (caveated is not excluded)', () => {
    const groups = guidedGroups(
      makeHeuristics({ cadence: makeMetric('cadence', { confidence: 0.1 }) }),
    )
    expect(ids(groups.banded)).toContain('cadence')
  })

  it('attaches the renderable band to group 1 entries and null to every other entry', () => {
    const groups = guidedGroups(makeHeuristics())
    for (const entry of groups.banded) {
      expect(entry.band).toBe(METRIC_GUIDANCE[entry.metric.metric].band)
    }
    for (const entry of groups.unbanded) expect(entry.band).toBeNull()
  })
})

describe('guidedGroups — rank is a property of the guidance data, never of the runner', () => {
  it('orders identically whatever the values and confidences are', () => {
    const extreme = guidedGroups(
      makeHeuristics({
        cadence: makeMetric('cadence', { value: 90, confidence: 0.71 }),
        kneeFlexion: makeMetric('kneeFlexion', { value: 300, confidence: 0.99 }),
        trunkLean: makeMetric('trunkLean', { value: -40, confidence: 0.2 }),
        overstriding: makeMetric('overstriding', { value: 5, confidence: 0.05 }),
      }),
    )
    const plain = guidedGroups(makeHeuristics())
    expect(ids(extreme.banded)).toEqual(ids(plain.banded))
    expect(ids(extreme.unbanded)).toEqual(ids(plain.unbanded))
  })

  it("follows displayRank rather than the record's key order", () => {
    // Reverse every rank: the output must reverse with it.
    const reversed = Object.fromEntries(
      Object.entries(METRIC_GUIDANCE).map(([id, g]) => [
        id,
        { ...g, displayRank: 13 - g.displayRank },
      ]),
    ) as Record<MetricId, MetricGuidance>
    const groups = guidedGroups(makeHeuristics(), reversed)
    expect(ids(groups.banded)).toEqual([...BANDED_ORDER].reverse())
    expect(ids(groups.unbanded)).toEqual([...UNBANDED_ORDER].reverse())
  })
})

describe('A band without provenance does not render', () => {
  const firstBanded = BANDED_ORDER[0]

  it.each(['title', 'url', 'population', 'sampleSize'] as const)(
    'withholds a band whose source has a blank %s, and the metric falls to the unbanded group',
    (field) => {
      const original = METRIC_GUIDANCE[firstBanded]
      if (original.band === null) throw new Error('expected a banded metric')
      const stripped: MetricGuidance = {
        ...original,
        band: { ...original.band, source: { ...original.band.source, [field]: '  ' } },
      }
      expect(sourceHasProvenance(stripped.band?.source)).toBe(false)
      expect(renderableBand(stripped)).toBeNull()

      const groups = guidedGroups(makeHeuristics(), {
        ...METRIC_GUIDANCE,
        [firstBanded]: stripped,
      })
      expect(ids(groups.banded)).not.toContain(firstBanded)
      expect(ids(groups.unbanded)).toContain(firstBanded)
    },
  )

  it('every shipped band has complete provenance', () => {
    for (const guidance of Object.values(METRIC_GUIDANCE)) {
      if (guidance.band !== null) expect(renderableBand(guidance)).toBe(guidance.band)
    }
  })
})
