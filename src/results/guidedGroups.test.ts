import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE, guidanceInDisplayOrder } from '../guidance/metricGuidance'
import type { BandSource, GuidanceLink, MetricGuidance } from '../guidance/types'
import {
  VISIBLE_REMEDIATION_LIMIT,
  WITHHELD_BAND_REASON,
  bandWithheld,
  captureHintFor,
  cardReferences,
  guidedEntryId,
  guidedGroups,
  noBandReasonFor,
  renderableBand,
  sourceHasProvenance,
  splitFirstSentence,
} from './guidedGroups'
import type { GuidedEntry } from './guidedGroups'
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

// ---------------------------------------------------------------------------------------------
// Card-level helpers
// ---------------------------------------------------------------------------------------------

function link(url: string, shortTitle = url): GuidanceLink {
  return { title: `${shortTitle}, full title`, shortTitle, url, kind: 'peer-reviewed', summary: `About ${url}.` }
}

function source(url: string): BandSource {
  return { title: `${url}, full`, shortTitle: url, url, population: `Population of ${url}`, sampleSize: '10' }
}

/** A guidance entry for `cadence` with the given references, and a band whose source is `bandUrl`. */
function entryWith({
  bandUrl = 'https://band.example/',
  corroboration = [] as BandSource[],
  research = [] as GuidanceLink[],
  remediation = [] as GuidanceLink[],
}): GuidedEntry {
  const base = METRIC_GUIDANCE.cadence
  const band = { ...base.band!, source: source(bandUrl), corroboration }
  const guidance: MetricGuidance = { ...base, band, research, remediation }
  return { metric: makeMetric('cadence'), guidance, band }
}

describe('cardReferences — each URL once per card, visible first', () => {
  it('shows at most three studies of changes and defers the rest to the disclosure', () => {
    const remediation = ['a', 'b', 'c', 'd', 'e'].map((x) => link(`https://${x}.example/`))
    const refs = cardReferences(entryWith({ remediation }))
    expect(refs.visibleRemediation.map((l) => l.url)).toEqual(remediation.slice(0, 3).map((l) => l.url))
    expect(refs.moreRemediation.map((l) => l.url)).toEqual(remediation.slice(3).map((l) => l.url))
    expect(VISIBLE_REMEDIATION_LIMIT).toBe(3)
  })

  it('drops a link whose URL already rendered — the band source, a visible study, or an earlier link', () => {
    const shared = 'https://shared.example/'
    const refs = cardReferences(
      entryWith({
        bandUrl: 'https://band.example/',
        corroboration: [source(shared), source('https://band.example/')],
        research: [link('https://band.example/'), link(shared), link('https://r.example/'), link('https://r.example/')],
        remediation: [link(shared), link('https://band.example/'), link('https://m.example/')],
      }),
    )
    // The band source claims its URL first, so remediation skips it; `shared` goes to the visible list.
    expect(refs.visibleRemediation.map((l) => l.url)).toEqual([shared, 'https://m.example/'])
    // A corroborating source keeps its fields but loses a duplicate link.
    expect(refs.corroboration.map((c) => c.linked)).toEqual([false, false])
    expect(refs.research.map((l) => l.url)).toEqual(['https://r.example/'])
    expect(refs.moreRemediation).toEqual([])
    expect(refs.disclosureSourceCount).toBe(1)
  })

  it('counts every distinct URL linked inside the disclosure', () => {
    const refs = cardReferences(
      entryWith({
        corroboration: [source('https://corroboration.example/')],
        research: [link('https://r1.example/'), link('https://r2.example/')],
        remediation: ['w', 'x', 'y', 'z'].map((x) => link(`https://${x}.example/`)),
      }),
    )
    expect(refs.disclosureSourceCount).toBe(4)
  })

  it('never renders a URL twice on any shipped card', () => {
    for (const entry of [...guidedGroups(makeHeuristics()).banded, ...guidedGroups(makeHeuristics()).unbanded]) {
      const refs = cardReferences(entry)
      const urls = [
        ...(entry.band !== null ? [entry.band.source.url] : []),
        ...refs.visibleRemediation.map((l) => l.url),
        ...refs.corroboration.filter((c) => c.linked).map((c) => c.source.url),
        ...refs.research.map((l) => l.url),
        ...refs.moreRemediation.map((l) => l.url),
      ]
      expect(new Set(urls).size, entry.metric.metric).toBe(urls.length)
    }
  })
})

describe('splitFirstSentence', () => {
  it.each([
    ['One. Two three. Four.', 'One.', 'Two three. Four.'],
    ['Only one sentence here.', 'Only one sentence here.', ''],
    ['Measured 9.2 ± 4.0 cm. Then more.', 'Measured 9.2 ± 4.0 cm.', 'Then more.'],
    ['Heiderscheit et al. 2011 found it. Then more.', 'Heiderscheit et al. 2011 found it.', 'Then more.'],
    ['Counted by J. Daniels in 1984. Then more.', 'Counted by J. Daniels in 1984.', 'Then more.'],
    ['It said "no target." Then more.', 'It said "no target."', 'Then more.'],
    ['Risk fell (CI 0.91–0.98). 37 studies disagreed.', 'Risk fell (CI 0.91–0.98).', '37 studies disagreed.'],
    ['e.g. The case holds. Then more.', 'e.g. The case holds.', 'Then more.'],
    ['  Padded. Rest  ', 'Padded.', 'Rest'],
  ])('%j', (text, first, rest) => {
    expect(splitFirstSentence(text)).toEqual({ first, rest })
  })

  it('loses no text: first and rest together are the note', () => {
    for (const guidance of Object.values(METRIC_GUIDANCE)) {
      for (const note of guidance.mandatoryNotes) {
        const { first, rest } = splitFirstSentence(note)
        expect(note.replace(/\s+/g, '')).toBe(`${first}${rest}`.replace(/\s+/g, ''))
      }
    }
  })
})

describe('Not-measured and withheld-band wording', () => {
  it('chooses the camera-angle hint for an unsuitable view and the other hint otherwise', () => {
    const unsuitable = guidedGroups(
      makeHeuristics({ stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }) }),
    ).notMeasured[0]
    expect(captureHintFor(unsuitable)).toBe(METRIC_GUIDANCE.stepWidth.captureHints.wrongAngle)
    const sparse = guidedGroups(
      makeHeuristics({ stepWidth: makeMetric('stepWidth', { value: null, confidence: 0 }) }),
    ).notMeasured[0]
    expect(sparse.metric.viewFit).not.toBe('unsuitable')
    expect(captureHintFor(sparse)).toBe(METRIC_GUIDANCE.stepWidth.captureHints.notEnoughData)
  })

  it('gives a withheld band the neutral reason, and an unbanded metric its own', () => {
    const target = BANDED_ORDER[0]
    const original = METRIC_GUIDANCE[target]
    const groups = guidedGroups(makeHeuristics(), {
      ...METRIC_GUIDANCE,
      [target]: { ...original, band: { ...original.band!, source: { ...original.band!.source, url: '' } } },
    })
    const withheld = groups.unbanded.find((e) => e.metric.metric === target)!
    expect(bandWithheld(withheld)).toBe(true)
    expect(noBandReasonFor(withheld)).toBe(WITHHELD_BAND_REASON)
    expect(WITHHELD_BAND_REASON).not.toMatch(/no published range/i)

    const genuine = groups.unbanded.find((e) => e.metric.metric === UNBANDED_ORDER[0])!
    expect(bandWithheld(genuine)).toBe(false)
    expect(noBandReasonFor(genuine)).toBe(METRIC_GUIDANCE[UNBANDED_ORDER[0]].noBandReason)
  })

  it('derives a stable, shareable element id per metric', () => {
    expect(guidedEntryId('cadence')).toBe('guided-results-cadence')
    expect(new Set(DISPLAY_ORDER.map(guidedEntryId)).size).toBe(DISPLAY_ORDER.length)
  })
})
