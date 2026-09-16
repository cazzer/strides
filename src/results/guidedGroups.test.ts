import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import {
  METRIC_GUIDANCE,
  guidanceInDisplayOrder,
} from '../guidance/metricGuidance'
import type {
  BandSource,
  GuidanceLink,
  MetricGuidance,
} from '../guidance/types'
import {
  WITHHELD_BAND_REASON,
  bandWithheld,
  captureHintFor,
  cardReferences,
  citationParts,
  citationText,
  guidedEntryId,
  guidedGroups,
  noBandReasonFor,
  noteLead,
  renderableBand,
  sourceHasProvenance,
  splitFirstSentence,
  tryLineApplies,
} from './guidedGroups'
import type { GuidedEntry } from './guidedGroups'
import { makeHeuristics, makeMetric } from './__fixtures__/metricResult'

const ids = (entries: { metric: { metric: MetricId } }[]) =>
  entries.map((e) => e.metric.metric)

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
    expect([
      groups.banded.length,
      groups.unbanded.length,
      groups.notMeasured.length,
    ]).toEqual([5, 7, 0])
  })

  it('accounts for all twelve metrics exactly once', () => {
    const groups = guidedGroups(makeHeuristics())
    const all = [
      ...groups.banded,
      ...groups.unbanded,
      ...groups.notMeasured,
    ].map((e) => e.metric.metric)
    expect([...all].sort()).toEqual([...DISPLAY_ORDER].sort())
  })

  it('moves a metric to group 3 when its value is null, keeping rank order there', () => {
    const groups = guidedGroups(
      makeHeuristics({
        cadence: makeMetric('cadence', {
          value: null,
          confidence: 0,
          caveat: 'no rhythm',
        }),
        kneeDrive: makeMetric('kneeDrive', {
          value: null,
          confidence: 0,
          caveat: 'no knee',
        }),
        trunkLean: makeMetric('trunkLean', {
          value: null,
          confidence: 0,
          caveat: 'no torso',
        }),
      }),
    )
    expect(ids(groups.notMeasured)).toEqual(
      DISPLAY_ORDER.filter((id) =>
        ['cadence', 'kneeDrive', 'trunkLean'].includes(id),
      ),
    )
    expect(ids(groups.banded)).not.toContain('cadence')
    expect(ids(groups.unbanded)).not.toContain('kneeDrive')
  })

  it("moves a measured metric with an unsuitable view to group 3 — metricTier's rule, not a value check", () => {
    const groups = guidedGroups(
      makeHeuristics({
        stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }),
      }),
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
        kneeFlexion: makeMetric('kneeFlexion', {
          value: 300,
          confidence: 0.99,
        }),
        trunkLean: makeMetric('trunkLean', { value: -40, confidence: 0.2 }),
        overstriding: makeMetric('overstriding', {
          value: 5,
          confidence: 0.05,
        }),
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
        band: {
          ...original.band,
          source: { ...original.band.source, [field]: '  ' },
        },
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
      if (guidance.band !== null)
        expect(renderableBand(guidance)).toBe(guidance.band)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Card-level helpers
// ---------------------------------------------------------------------------------------------

function link(url: string, shortTitle = url): GuidanceLink {
  return {
    title: `${shortTitle}, full title`,
    shortTitle,
    url,
    kind: 'peer-reviewed',
    summary: `About ${url}.`,
  }
}

function source(url: string): BandSource {
  return {
    title: `${url}, full`,
    shortTitle: url,
    url,
    population: `Population of ${url}`,
    populationShort: `pop ${url}`,
    sampleSize: '10',
  }
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
  // The Try line names one of `remediation`'s own URLs, or is `null` where there is nothing to name.
  const tryLine =
    remediation.length > 0
      ? {
          text: 'something studied',
          url: remediation[0].url,
          direction: 'lower' as const,
        }
      : null
  const guidance: MetricGuidance = {
    ...base,
    band,
    research,
    remediation,
    tryLine,
  }
  return { metric: makeMetric('cadence'), guidance, band }
}

describe('cardReferences — each URL an anchor once per card, visible first, nothing dropped', () => {
  it('shows exactly one study of changes and defers every other to the disclosure', () => {
    const remediation = ['a', 'b', 'c', 'd', 'e'].map((x) =>
      link(`https://${x}.example/`),
    )
    const refs = cardReferences(entryWith({ remediation }))
    expect(refs.tryLink?.url).toBe(remediation[0].url)
    // Every study is inside, the Try link among them — that is where its kind, summary and full
    // citation reach the card — and it alone shows as text, its URL already being an anchor above.
    expect(refs.moreRemediation.map((r) => [r.link.url, r.linked])).toEqual([
      [remediation[0].url, false],
      ...remediation.slice(1).map((l) => [l.url, true]),
    ])
    expect(refs.disclosureSourceCount).toBe(4)
  })

  it('shows no study of changes where the guidance names none', () => {
    const remediation = [link('https://a.example/')]
    const entry = entryWith({ remediation })
    const refs = cardReferences({
      ...entry,
      guidance: { ...entry.guidance, tryLine: null },
    })
    expect(refs.tryLink).toBeNull()
    // The study itself is not lost — it renders inside, as a link, since nothing claimed its URL.
    expect(refs.moreRemediation.map((r) => [r.link.url, r.linked])).toEqual([
      ['https://a.example/', true],
    ])
  })

  it('keeps a link whose URL already rendered, as text, and skips only an exact repeat', () => {
    const shared = 'https://shared.example/'
    const band = 'https://band.example/'
    const refs = cardReferences(
      entryWith({
        bandUrl: band,
        corroboration: [source(shared), source(band)],
        research: [
          link(band),
          link(shared),
          {
            ...link(shared),
            summary: 'Says something the visible study does not.',
          },
          link('https://r.example/'),
          link('https://r.example/'),
        ],
        remediation: [link(shared), link(band), link('https://m.example/')],
      }),
    )
    // `remediation[0]` is `shared`, which the fixture's Try line names, so that is the one visible
    // study; the band's own URL is claimed before it, so a study sharing that URL is never visible.
    expect(refs.tryLink?.url).toBe(shared)
    // A corroborating source keeps its fields but loses a duplicate link.
    expect(refs.corroboration.map((c) => c.linked)).toEqual([false, false])
    // The band's own source as a research link stays, unlinked. So do BOTH summaries for the Try
    // link's URL: the visible Try line carries a short title and no summary, so neither is already
    // on the card. Only an exact repeat of a link already placed — the second `r.example` — is
    // skipped.
    expect(
      refs.research.map(({ link: l, linked }) => [l.url, l.summary, linked]),
    ).toEqual([
      [band, `About ${band}.`, false],
      [shared, `About ${shared}.`, false],
      [shared, 'Says something the visible study does not.', false],
      ['https://r.example/', 'About https://r.example/.', true],
    ])
    // Every study goes inside. `shared` and the band-URL one repeat research links placed above
    // word for word and are skipped there; `m.example` is new and is the only one still linkable.
    expect(refs.moreRemediation.map((r) => [r.link.url, r.linked])).toEqual([
      ['https://m.example/', true],
    ])
    expect(refs.disclosureSourceCount).toBe(2)
  })

  it('withholds a Try line whose study is already the band source, and keeps the study inside', () => {
    const band = 'https://band.example/'
    const refs = cardReferences(
      entryWith({ bandUrl: band, remediation: [link(band)] }),
    )
    // Named as the Try line, but its URL is the citation line's anchor already. `TryLine` renders an
    // anchor unconditionally, so showing it would anchor one URL twice on one card; the study is not
    // lost, it renders inside the disclosure as text, with its kind, summary and full citation.
    expect(refs.tryLink).toBeNull()
    expect(refs.moreRemediation).toEqual([{ link: link(band), linked: false }])
    expect(refs.disclosureSourceCount).toBe(0)
  })

  it('still shows a Try line whose study is only its own, unclaimed URL — the rule is not "never"', () => {
    // Not vacuous: the withholding above is about a COLLISION with the band source, and this is the
    // shipped shape (no shipped metric names a Try study that is also its band's source).
    const refs = cardReferences(
      entryWith({
        bandUrl: 'https://band.example/',
        remediation: [link('https://try.example/')],
      }),
    )
    expect(refs.tryLink?.url).toBe('https://try.example/')
  })

  it("places every shipped link's summary somewhere on its card", () => {
    const { banded, unbanded } = guidedGroups(makeHeuristics())
    for (const entry of [...banded, ...unbanded]) {
      const refs = cardReferences(entry)
      const placed = [
        ...refs.research.map((r) => r.link),
        ...refs.moreRemediation.map((r) => r.link),
      ]
      for (const reference of [
        ...entry.guidance.research,
        ...entry.guidance.remediation,
      ]) {
        expect(
          placed.some(
            (l) => l.url === reference.url && l.summary === reference.summary,
          ),
          `${entry.metric.metric}: ${reference.shortTitle}`,
        ).toBe(true)
      }
    }
  })

  it('counts every distinct URL linked inside the disclosure', () => {
    const refs = cardReferences(
      entryWith({
        corroboration: [source('https://corroboration.example/')],
        research: [link('https://r1.example/'), link('https://r2.example/')],
        remediation: ['w', 'x', 'y', 'z'].map((x) =>
          link(`https://${x}.example/`),
        ),
      }),
    )
    // corroboration + 2 research + 3 of the 4 studies; `w` is the Try link, claimed above.
    expect(refs.disclosureSourceCount).toBe(6)
  })

  it('never renders a URL twice on any shipped card', () => {
    for (const entry of [
      ...guidedGroups(makeHeuristics()).banded,
      ...guidedGroups(makeHeuristics()).unbanded,
    ]) {
      const refs = cardReferences(entry)
      const urls = [
        ...(entry.band !== null ? [entry.band.source.url] : []),
        ...(refs.tryLink !== null ? [refs.tryLink.url] : []),
        ...refs.corroboration.filter((c) => c.linked).map((c) => c.source.url),
        ...refs.research.filter((r) => r.linked).map((r) => r.link.url),
        ...refs.moreRemediation.filter((r) => r.linked).map((r) => r.link.url),
      ]
      expect(new Set(urls).size, entry.metric.metric).toBe(urls.length)
    }
  })
})

describe('splitFirstSentence', () => {
  it.each([
    ['One. Two three. Four.', 'One.', 'Two three. Four.'],
    ['Only one sentence here.', 'Only one sentence here.', ''],
    [
      'Measured 9.2 ± 4.0 cm. Then more.',
      'Measured 9.2 ± 4.0 cm.',
      'Then more.',
    ],
    [
      'Heiderscheit et al. 2011 found it. Then more.',
      'Heiderscheit et al. 2011 found it.',
      'Then more.',
    ],
    [
      'Counted by J. Daniels in 1984. Then more.',
      'Counted by J. Daniels in 1984.',
      'Then more.',
    ],
    ['It said "no target." Then more.', 'It said "no target."', 'Then more.'],
    [
      'Risk fell (CI 0.91–0.98). 37 studies disagreed.',
      'Risk fell (CI 0.91–0.98).',
      '37 studies disagreed.',
    ],
    ['e.g. The case holds. Then more.', 'e.g. The case holds.', 'Then more.'],
    ['  Padded. Rest  ', 'Padded.', 'Rest'],
  ])('%j', (text, first, rest) => {
    expect(splitFirstSentence(text)).toEqual({ first, rest })
  })

  it('loses no text: first and rest together are the note', () => {
    for (const guidance of Object.values(METRIC_GUIDANCE)) {
      for (const note of guidance.mandatoryNotes) {
        const { first, rest } = splitFirstSentence(note)
        expect(note.replace(/\s+/g, '')).toBe(
          `${first}${rest}`.replace(/\s+/g, ''),
        )
      }
    }
  })
})

describe('noteLead', () => {
  it.each([
    [
      '180 steps per minute is not a target.',
      '180 steps per minute is not a target.',
    ],
    ['A negative value is not a defect.', 'A negative value is not a defect.'],
    [
      'About 8 in 10 distance runners are rearfoot strikers.',
      'About 8 in 10 distance runners…',
    ],
    [
      'There is no defensible target for trunk lean, and this range carries no preferred end.',
      'There is no defensible target for…',
    ],
    [
      'One two three four five, six seven eight nine.',
      'One two three four five, six…',
    ],
    [
      'One two three four five six, seven eight nine.',
      'One two three four five six…',
    ],
  ])('%j', (first, lead) => {
    expect(noteLead(first)).toBe(lead)
  })
})

describe('Not-measured and withheld-band wording', () => {
  it('chooses the camera-angle hint for an unsuitable view and the other hint otherwise', () => {
    const unsuitable = guidedGroups(
      makeHeuristics({
        stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }),
      }),
    ).notMeasured[0]
    expect(captureHintFor(unsuitable)).toBe(
      METRIC_GUIDANCE.stepWidth.captureHints.wrongAngle,
    )
    const sparse = guidedGroups(
      makeHeuristics({
        stepWidth: makeMetric('stepWidth', { value: null, confidence: 0 }),
      }),
    ).notMeasured[0]
    expect(sparse.metric.viewFit).not.toBe('unsuitable')
    expect(captureHintFor(sparse)).toBe(
      METRIC_GUIDANCE.stepWidth.captureHints.notEnoughData,
    )
  })

  it('gives a withheld band the neutral reason, and an unbanded metric its own', () => {
    const target = BANDED_ORDER[0]
    const original = METRIC_GUIDANCE[target]
    const groups = guidedGroups(makeHeuristics(), {
      ...METRIC_GUIDANCE,
      [target]: {
        ...original,
        band: {
          ...original.band!,
          source: { ...original.band!.source, url: '' },
        },
      },
    })
    const withheld = groups.unbanded.find((e) => e.metric.metric === target)!
    expect(bandWithheld(withheld)).toBe(true)
    expect(noBandReasonFor(withheld)).toBe(WITHHELD_BAND_REASON)
    expect(WITHHELD_BAND_REASON).not.toMatch(/no published range/i)

    const genuine = groups.unbanded.find(
      (e) => e.metric.metric === UNBANDED_ORDER[0],
    )!
    expect(bandWithheld(genuine)).toBe(false)
    expect(noBandReasonFor(genuine)).toBe(
      METRIC_GUIDANCE[UNBANDED_ORDER[0]].noBandReason,
    )
  })

  it('derives a stable, shareable element id per metric', () => {
    expect(guidedEntryId('cadence')).toBe('guided-results-cadence')
    expect(new Set(DISPLAY_ORDER.map(guidedEntryId)).size).toBe(
      DISPLAY_ORDER.length,
    )
  })
})

describe('citationParts — the one visible attribution line', () => {
  it('names the source, its short population and its sample size, in that order', () => {
    const band = METRIC_GUIDANCE.verticalOscillationCm.band!
    expect(citationParts(band.source, false)).toEqual([
      'Malisoux et al. 2023',
      'recreational runners',
      'n = 860',
    ])
    expect(citationText(band.source, false)).toBe(
      'Malisoux et al. 2023 · recreational runners · n = 860',
    )
  })

  it('labels an unpublished sample size, so it cannot read as another population', () => {
    // A source that publishes a population but no count: the sample-size field still says so, in
    // words, rather than printing a bare "Not published" that reads as a second population.
    const source = {
      ...METRIC_GUIDANCE.verticalOscillationCm.band!.source,
      sampleSize: 'Not published',
    }
    expect(citationText(source, false)).toBe(
      'Malisoux et al. 2023 · recreational runners · sample size not published',
    )
  })

  it('collapses two adjacent absences into one field, so the line states each fact once', () => {
    // Garmin publishes neither, and `population not stated · sample size not published` spent more
    // than half the line — and the reader's attention — restating one silence as two findings.
    for (const metric of ['cadence', 'verticalRatio'] as const) {
      const band = METRIC_GUIDANCE[metric].band!
      expect(citationParts(band.source, false), metric).toEqual([
        band.source.shortTitle,
        'population and sample size not published',
      ])
    }
    expect(citationText(METRIC_GUIDANCE.cadence.band!.source, false)).toBe(
      'Garmin fenix 7 manual · population and sample size not published',
    )
    // Narrow by construction: a source that states a population keeps both fields, above.
    expect(
      citationParts(METRIC_GUIDANCE.verticalOscillationCm.band!.source, false),
    ).toHaveLength(3)
  })

  it('says "derived" last, and only for a derived band', () => {
    const derived = METRIC_GUIDANCE.verticalRatio.band!
    expect(derived.derivation).not.toBeNull()
    expect(citationParts(derived.source, true).at(-1)).toBe('derived')
    expect(citationParts(derived.source, false)).not.toContain('derived')
  })

  it('reads as one line for every shipped band, with the derived flag matching the data', () => {
    for (const entry of guidedGroups(makeHeuristics()).banded) {
      const band = entry.band!
      const text = citationText(band.source, band.derivation !== null)
      // Three fields — source, population, sample size — except where the last two are both
      // absences and collapse into one, and plus one where the band is derived.
      const collapsed = text.includes('population and sample size')
      expect(text.split(' · '), entry.metric.metric).toHaveLength(
        (collapsed ? 2 : 3) + (band.derivation === null ? 0 : 1),
      )
      expect(text.includes(' · derived'), entry.metric.metric).toBe(
        band.derivation !== null,
      )
      // Short enough to read as one line on a desktop card — it wraps on a phone, which is fine.
      // The guard is against a line growing without bound, e.g. by dropping the full title in.
      expect(
        text.length,
        `${entry.metric.metric}: ${text}`,
      ).toBeLessThanOrEqual(95)
    }
  })
})

describe('tryLineApplies — a studied change may not point further out of the band', () => {
  /** The shipped `verticalOscillationCm` entry at one measured value. Its band is 6.0–9.5 cm. */
  function vocmAt(value: number): GuidedEntry {
    const guidance = METRIC_GUIDANCE.verticalOscillationCm
    return {
      metric: makeMetric('verticalOscillationCm', { value }),
      guidance,
      band: guidance.band,
    }
  }

  it("withholds a 'lower' line from a value already below the band", () => {
    // 4.4215 cm is what this repo's own side-view clip measures (CLAUDE.md's standing anchor), and
    // the line it sat under said to stay lower still.
    expect(METRIC_GUIDANCE.verticalOscillationCm.tryLine?.direction).toBe(
      'lower',
    )
    expect(tryLineApplies(vocmAt(4.421467928439415))).toBe(false)
  })

  it('shows the same line for a value inside the band', () => {
    expect(tryLineApplies(vocmAt(7.5))).toBe(true)
    // The bounds themselves are inside: a closed zone is inclusive on both (bandPosition.ts).
    expect(tryLineApplies(vocmAt(6.0))).toBe(true)
    expect(tryLineApplies(vocmAt(9.5))).toBe(true)
  })

  it("shows a 'lower' line to a value ABOVE the band — that is the direction that helps", () => {
    expect(tryLineApplies(vocmAt(12))).toBe(true)
  })

  it("withholds a 'higher' line from a value already above the band", () => {
    const guidance = METRIC_GUIDANCE.verticalOscillationCm
    const higher: MetricGuidance = {
      ...guidance,
      tryLine: { ...guidance.tryLine!, direction: 'higher' },
    }
    const above: GuidedEntry = {
      metric: makeMetric('verticalOscillationCm', { value: 12 }),
      guidance: higher,
      band: guidance.band,
    }
    expect(tryLineApplies(above)).toBe(false)
    expect(
      tryLineApplies({
        ...above,
        metric: makeMetric('verticalOscillationCm', { value: 4 }),
      }),
    ).toBe(true)
  })

  it('shows a line on a metric with no band, and on one with no value to place', () => {
    const overstriding = METRIC_GUIDANCE.overstriding
    expect(overstriding.band).toBeNull()
    expect(overstriding.tryLine?.direction).toBe('lower')
    for (const value of [-5, 0, 5]) {
      expect(
        tryLineApplies({
          metric: makeMetric('overstriding', { value }),
          guidance: overstriding,
          band: null,
        }),
        `${value}`,
      ).toBe(true)
    }
  })

  it('shows nothing where the guidance names no studied change', () => {
    expect(METRIC_GUIDANCE.trunkLean.tryLine).toBeNull()
    expect(
      tryLineApplies({
        metric: makeMetric('trunkLean'),
        guidance: METRIC_GUIDANCE.trunkLean,
        band: METRIC_GUIDANCE.trunkLean.band,
      }),
    ).toBe(false)
  })

  it("never withholds cadence's line: an open-ended outer zone is inside the band", () => {
    // Garmin's `<153` and `>183` cover every value, so `locateInBand` never reports `outside` here —
    // a runner at 200 steps/min is in the band's top zone, not past its end.
    const cadence = METRIC_GUIDANCE.cadence
    for (const value of [120, 172, 200]) {
      expect(
        tryLineApplies({
          metric: makeMetric('cadence', { value }),
          guidance: cadence,
          band: cadence.band,
        }),
        `${value}`,
      ).toBe(true)
    }
  })
})
