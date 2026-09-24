import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_FIT_TABLE } from '../heuristics/types'
import type { MetricId, MetricResult } from '../heuristics/types'
import { METRIC_GUIDANCE, guidanceInDisplayOrder } from './metricGuidance'
import { referenceBandEnvelope } from './types'
import type { MetricGuidance, ReferenceBand } from './types'

/**
 * Every metric, named as a literal rather than derived from the record under test.
 *
 * Deriving this list from `METRIC_GUIDANCE`'s own keys would make the exhaustiveness test
 * tautological. Deriving it from the `MetricId` union is impossible at runtime — a union erases —
 * so it is transcribed here and cross-checked against `DEFAULT_VIEW_FIT_TABLE`, the heuristics
 * package's own `Record<MetricId, …>`, which a thirteenth metric could not be added to the union
 * without updating.
 */
const EXPECTED_METRIC_IDS: MetricId[] = [
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

/**
 * Which metrics carry a band, named one at a time and in full.
 *
 * The point of listing all twelve rather than asserting a count is that adding a band later — or
 * losing one — shows up in a diff as a line that says which metric changed and in which
 * direction. design.md's pre-registered rule R1 says that if a future contributor believes a
 * metric deserves a band this design does not list, the correct move is to stop and say so, not to
 * pick a number; this test is where that conversation starts.
 */
const EXPECTED_BANDED: Record<MetricId, boolean> = {
  cadence: true,
  verticalRatio: true,
  verticalOscillationCm: true,
  trunkLean: true,
  kneeFlexion: true,
  verticalOscillation: false,
  overstriding: false,
  footStrikePattern: false,
  stepWidth: false,
  stepWidthCm: false,
  kneeDrive: false,
  armSwingAmplitude: false,
  swingFootLateralExcursion: false,
}

/** The five metrics design.md D2 bands, as a type, so a pinned-literal table must name all five. */
type BandedMetricId =
  | 'cadence'
  | 'verticalRatio'
  | 'verticalOscillationCm'
  | 'trunkLean'
  | 'kneeFlexion'

/** design.md D2 fixes this order and fixes it by evidence strength, not by metric interest. */
const EXPECTED_BANDED_RANKS: Array<[MetricId, number]> = [
  ['cadence', 1],
  ['verticalRatio', 2],
  ['verticalOscillationCm', 3],
  ['trunkLean', 4],
  ['kneeFlexion', 5],
]

/**
 * The unit each banded metric's own `MetricResult` carries, transcribed from the modules that
 * produce it: `cadence.ts` (`'stepsPerMinute'`), `verticalRatio.ts` (`'percent'`),
 * `verticalOscillationCm.ts` (`'centimeters'`), `trunkLean.ts` and `kneeFlexion.ts`
 * (`'degrees'`). A band stated in a unit the metric does not report in would compare two
 * different quantities and look entirely plausible doing it.
 */
const EXPECTED_BAND_UNITS: Partial<Record<MetricId, MetricResult['unit']>> = {
  cadence: 'stepsPerMinute',
  verticalRatio: 'percent',
  verticalOscillationCm: 'centimeters',
  trunkLean: 'degrees',
  kneeFlexion: 'degrees',
}

/**
 * The physically possible extent of each banded metric's own value, in the domain
 * `MetricResult.value` is computed in.
 *
 * **These are sanity intervals and nothing else.** They are not reference bands, they are not
 * rendered anywhere, and they must never be mistaken for one — their whole job is to fail loudly
 * if a bound is entered in the wrong domain. `verticalRatio` is the one that matters: its unit is
 * `'percent'`, which in this codebase means a dimensionless 0..1 number that the panel renders as
 * `value × 100`, so Garmin's published 3.05% is `0.0305` here. A bound entered as `3.05` would be
 * a hundred times too large, would sail past every other test in this file, and would render a
 * band wider than any value could ever reach — so it is caught here, by being outside 0..1.
 */
const METRIC_VALUE_DOMAIN: Partial<
  Record<MetricId, { min: number; max: number }>
> = {
  // A human step rate. Nobody runs at 0 or at 300 steps per minute.
  cadence: { min: 0, max: 300 },
  // Dimensionless 0..1, per `MetricResult.unit`'s own documentation of `'percent'`.
  verticalRatio: { min: 0, max: 1 },
  // Absolute centimetres of hip bounce. A metre would be a pogo stick.
  verticalOscillationCm: { min: 0, max: 100 },
  // Degrees of trunk lean, either direction from vertical.
  trunkLean: { min: -90, max: 90 },
  // Degrees of knee flexion where 0° is full extension; a knee cannot fold past straight-back.
  kneeFlexion: { min: 0, max: 180 },
}

/**
 * Every URL the research pass loaded and that returned HTTP 200, transcribed from the two research
 * digests it produced.
 *
 * **This set is closed.** A URL that is not in it cannot be added to the guidance record without
 * this test failing, which is the point: a guidance page whose citations rot is worse than one
 * with no citations, because it still looks attributable. Sources that returned 403 — the JOSPT
 * original of Teng & Powers 2014, both Meardon crossover papers, Novacheck 1998, the MDPI original
 * of Gaudette 2022 — are deliberately absent, and their absence is not filled by a secondary
 * source restating them.
 *
 * Not every member has to be used. Membership means "verified reachable", not "must appear".
 */
const VERIFIED_URLS: ReadonlySet<string> = new Set([
  // Reference ranges
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4000471/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC9441414/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC10588426/',
  'https://www8.garmin.com/manuals/webhelp/GUID-C001C335-A8EC-4A41-AB0E-BAC434259F92/EN-US/GUID-EE9E7F6F-49BE-4452-82E6-B40371D0AEC1.html',
  'https://www8.garmin.com/manuals/webhelp/GUID-676967A0-1B23-4384-9BC9-76F3D643F1C8/EN-US/GUID-62A09512-518A-424A-8491-FE2B80CD2091.html',
  'https://www8.garmin.com/manuals-apac/webhelp/fenix7series/EN-SG/GUID-CC006ABA-CE80-45BE-BD87-5B5A0FBC1125-3223.html',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC9671438/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5426356/',
  'https://eprints.leedsbeckett.ac.uk/id/eprint/7491/6/TheBiomechanicsOfDistanceRunningAM-HANLEY.pdf',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC3022995/',
  'https://journals.biologists.com/jeb/article/218/21/3406/14416/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4714754/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC7740069/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC8581084/',
  'https://doras.dcu.ie/28875/1/burke-et-al-2021-risk-factors-for-injuries-in-runners-a-systematic-review-of-foot-strike-technique-and-its.pdf',
  // Remediation
  'https://uwnmbl.engr.wisc.edu/pubs/msse14_lenhart.pdf',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC9655004/',
  'https://ijspt.scholasticahq.com/article/90909-a-one-session-gait-retraining-protocol-with-metronome-augmentation-increases-cadence-in-novice-and-recreational-runners',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC10761631/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC7083994/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC13269574/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4887549/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11283446/',
  'https://lermagazine.com/article/a-new-approach-to-iliotibial-band-syndrome-in-runners',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11520670/',
  'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0302249',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5317187/',
])

function entries(): MetricGuidance[] {
  return Object.values(METRIC_GUIDANCE)
}

function bandedEntries(): Array<[MetricId, ReferenceBand]> {
  return entries()
    .filter(
      (entry): entry is MetricGuidance & { band: ReferenceBand } =>
        entry.band !== null,
    )
    .map((entry) => [entry.metric, entry.band])
}

/** Every URL anywhere in one entry — band source, band corroboration, research, remediation. */
function urlsIn(entry: MetricGuidance): string[] {
  const bandUrls = entry.band
    ? [
        entry.band.source.url,
        ...entry.band.corroboration.map((source) => source.url),
      ]
    : []
  return [
    ...bandUrls,
    ...entry.research.map((link) => link.url),
    ...entry.remediation.map((link) => link.url),
  ]
}

function boundsOf(band: ReferenceBand): number[] {
  const zoneBounds = band.zones.flatMap((zone) => [zone.min, zone.max])
  const central = band.centralTendency ? [band.centralTendency.value] : []
  return [...zoneBounds, ...central].filter(
    (value): value is number => value !== null,
  )
}

describe('METRIC_GUIDANCE exhaustiveness', () => {
  it('has exactly one entry per MetricId', () => {
    expect(Object.keys(METRIC_GUIDANCE).sort()).toEqual(
      [...EXPECTED_METRIC_IDS].sort(),
    )
  })

  it('covers the whole MetricId union — a thirteenth metric fails here', () => {
    // `DEFAULT_VIEW_FIT_TABLE` is the heuristics package's own `Record<MetricId, …>`: a metric
    // added to the union must appear in it, so this comparison detects a new member at runtime
    // rather than leaving the guidance record silently short of one. (The `Record` type on
    // METRIC_GUIDANCE would also fail to compile — this is the second of the two locks, and the
    // one that says which metric is missing.)
    expect(Object.keys(DEFAULT_VIEW_FIT_TABLE).sort()).toEqual(
      [...EXPECTED_METRIC_IDS].sort(),
    )
  })

  it('gives every entry the metric id it is filed under', () => {
    for (const id of EXPECTED_METRIC_IDS) {
      expect(METRIC_GUIDANCE[id].metric).toBe(id)
    }
  })

  it('returns all twelve in rank order from guidanceInDisplayOrder', () => {
    const ordered = guidanceInDisplayOrder()
    expect(ordered).toHaveLength(EXPECTED_METRIC_IDS.length)
    expect(ordered.map((entry) => entry.displayRank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ])
  })
})

describe('which metrics carry a band', () => {
  for (const id of Object.keys(EXPECTED_BANDED) as MetricId[]) {
    const banded = EXPECTED_BANDED[id]
    it(`${id} ${banded ? 'has' : 'has no'} reference band`, () => {
      expect(METRIC_GUIDANCE[id].band === null).toBe(!banded)
    })
  }

  it('bands exactly five of the twelve', () => {
    expect(bandedEntries()).toHaveLength(5)
  })

  it('gives every unbanded metric a reason, and no banded metric one', () => {
    for (const entry of entries()) {
      expect(entry.noBandReason === null).toBe(entry.band !== null)
      if (entry.noBandReason !== null)
        expect(entry.noBandReason.length).toBeGreaterThan(80)
    }
  })
})

describe('display rank', () => {
  it('is unique and dense across 1..13', () => {
    const ranks = entries()
      .map((entry) => entry.displayRank)
      .sort((a, b) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('puts the five banded metrics in design.md D2 order at ranks 1-5', () => {
    for (const [id, rank] of EXPECTED_BANDED_RANKS) {
      expect(METRIC_GUIDANCE[id].displayRank).toBe(rank)
    }
  })

  it('ranks every unbanded metric below every banded one', () => {
    for (const entry of entries()) {
      if (entry.band === null) expect(entry.displayRank).toBeGreaterThan(5)
      else expect(entry.displayRank).toBeLessThanOrEqual(5)
    }
  })
})

describe('band provenance', () => {
  it('names a source with a title, a URL, a population and a sample size', () => {
    for (const [id, band] of bandedEntries()) {
      for (const source of [band.source, ...band.corroboration]) {
        expect(source.title.length, `${id} source title`).toBeGreaterThan(0)
        expect(source.url.length, `${id} source url`).toBeGreaterThan(0)
        expect(
          source.population.length,
          `${id} source population`,
        ).toBeGreaterThan(0)
        expect(
          source.sampleSize.length,
          `${id} source sample size`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('states a sample size even where the publisher never published one', () => {
    // Garmin's two bands. The absence is a fact about the source and renders as one — it is not
    // hidden behind a null the view would have to invent wording for. design.md D9.3.
    expect(METRIC_GUIDANCE.cadence.band?.source.sampleSize).toBe(
      'Not published',
    )
    expect(METRIC_GUIDANCE.verticalRatio.band?.source.sampleSize).toBe(
      'Not published',
    )
  })

  it('marks exactly two bands as derived, and says what each derivation rests on', () => {
    const derived = bandedEntries().filter(
      ([, band]) => band.derivation !== null,
    )
    expect(derived.map(([id]) => id)).toEqual([
      'verticalRatio',
      'verticalOscillationCm',
    ])
    const derivation = METRIC_GUIDANCE.verticalRatio.band?.derivation
    // One leg per side: Garmin's denominator is a step, this app's is a true stride. R1(ii) admits
    // the conversion only because each leg is a stated definition rather than a fitted constant.
    expect(derivation?.restsOn).toHaveLength(2)
    expect(derivation?.statement).toContain('halved')
    // …and it discloses that the zone LABELS are restated, not quoted (design.md D3).
    expect(derivation?.statement).toContain('value order')
    expect(derivation?.statement).toContain('100 minus Garmin')
  })

  it("declares verticalOscillationCm's 6.0–9.5 cm as a pairing of two published rows, not one published range", () => {
    // Malisoux publishes 10th–90th percentiles by sex only: men 64–95 mm, women 60–85 mm at
    // 10 km/h. 6.0 is women's P10 and 9.5 is men's P90, so no single published row spans the band.
    const band = METRIC_GUIDANCE.verticalOscillationCm.band!
    const derivation = band.derivation
    expect(derivation).not.toBeNull()
    expect(derivation?.restsOn).toEqual([
      'Malisoux et al. 2023, men at 10 km/h: 10th–90th percentile 64–95 mm, which is 6.4–9.5 cm.',
      'Malisoux et al. 2023, women at 10 km/h: 10th–90th percentile 60–85 mm, which is 6.0–8.5 cm.',
    ])
    expect(derivation?.statement).toContain("women's 10th percentile, 6.0 cm")
    expect(derivation?.statement).toContain("men's 90th percentile, 9.5 cm")
    // The label must not claim a single published 10th–90th percentile range, or "pooled".
    expect(band.zones.map((zone) => zone.label)).toEqual([
      "From women's 10th to men's 90th percentile in Malisoux's 860 runners, at 10 km/h (6:00 per km)",
    ])
    expect(band.zones[0].label).not.toMatch(/pooled|10th–90th/i)
  })
})

describe('every URL is verified and https', () => {
  it('uses only URLs from the pinned verified set', () => {
    for (const entry of entries()) {
      for (const url of urlsIn(entry)) {
        expect(
          VERIFIED_URLS.has(url),
          `${entry.metric} links an unverified URL: ${url}`,
        ).toBe(true)
      }
    }
  })

  it('uses https everywhere', () => {
    for (const entry of entries()) {
      for (const url of urlsIn(entry)) {
        expect(url.startsWith('https://'), `${entry.metric}: ${url}`).toBe(true)
      }
    }
  })

  it('pins a set that is itself all https', () => {
    for (const url of VERIFIED_URLS) {
      expect(url.startsWith('https://'), url).toBe(true)
    }
  })

  it('labels the Hanley 2021 book chapter as one, and keeps link facts out of its title', () => {
    const hanley = METRIC_GUIDANCE.kneeFlexion.research.find((link) =>
      link.title.startsWith('Hanley 2021'),
    )
    expect(hanley?.kind).toBe('book-chapter')
    expect(hanley?.title).not.toMatch(/manuscript/i)
  })

  it('gives every link and every source a short title of at most 30 characters', () => {
    for (const entry of entries()) {
      const cited = [
        ...(entry.band ? [entry.band.source, ...entry.band.corroboration] : []),
        ...entry.research,
        ...entry.remediation,
      ]
      for (const item of cited) {
        expect(
          item.shortTitle.length,
          `${entry.metric}: ${item.title}`,
        ).toBeGreaterThan(0)
        expect(
          item.shortTitle.length,
          `${entry.metric}: ${item.shortTitle}`,
        ).toBeLessThanOrEqual(30)
      }
    }
  })

  it('names the same source with the same short title everywhere, and starts from its first author', () => {
    const shortTitleByUrl = new Map<string, string>()
    for (const entry of entries()) {
      const cited = [
        ...(entry.band ? [entry.band.source, ...entry.band.corroboration] : []),
        ...entry.research,
        ...entry.remediation,
      ]
      for (const item of cited) {
        const seen = shortTitleByUrl.get(item.url)
        if (seen !== undefined)
          expect(item.shortTitle, `${entry.metric}: ${item.url}`).toBe(seen)
        shortTitleByUrl.set(item.url, item.shortTitle)
        // "Malisoux et al. 2023" abbreviates "Malisoux et al. 2023, …"; "Garmin fenix 7 manual"
        // abbreviates "Garmin fenix 7 owner's manual …". The first word must be the title's.
        expect(item.title.split(/[\s,]/)[0], item.shortTitle).toBe(
          item.shortTitle.split(/[\s,]/)[0],
        )
      }
    }
  })

  it('gives every link a title and a summary', () => {
    for (const entry of entries()) {
      for (const link of [...entry.research, ...entry.remediation]) {
        expect(link.title.length, `${entry.metric} link title`).toBeGreaterThan(
          0,
        )
        expect(
          link.summary.length,
          `${entry.metric} link summary`,
        ).toBeGreaterThan(0)
      }
    }
  })
})

describe('band numbers are in the metric’s own value domain', () => {
  it('matches each band unit to the unit its metric reports in', () => {
    for (const [id, band] of bandedEntries()) {
      expect(band.unit, id).toBe(EXPECTED_BAND_UNITS[id])
    }
  })

  it('keeps every bound inside the metric’s physically possible extent', () => {
    for (const [id, band] of bandedEntries()) {
      const domain = METRIC_VALUE_DOMAIN[id]
      expect(domain, `no value domain declared for ${id}`).toBeDefined()
      if (!domain) continue
      for (const bound of boundsOf(band)) {
        expect(bound, `${id} bound ${bound}`).toBeGreaterThanOrEqual(domain.min)
        expect(bound, `${id} bound ${bound}`).toBeLessThanOrEqual(domain.max)
      }
    }
  })

  it('stores verticalRatio as the 0..1 value the pipeline computes, not the percentage it displays', () => {
    const band = METRIC_GUIDANCE.verticalRatio.band
    expect(band).not.toBeNull()
    if (!band) return
    // The convention, proved in the direction that would catch the defect: multiplying every
    // stored bound by 100 — which is exactly what `MetricsPanel`'s `formatValue` does to a
    // `'percent'` value — gives back the figures Garmin published, halved. A bound stored as
    // `3.05` would come back as 305.
    const displayed = boundsOf(band).map((bound) =>
      Number((bound * 100).toFixed(2)),
    )
    expect(displayed).toEqual([3.05, 3.05, 3.7, 3.75, 4.3, 4.35, 5.05, 5.05])
    for (const bound of boundsOf(band)) {
      expect(bound).toBeLessThan(1)
    }
  })
})

describe('band zones', () => {
  it('orders zones ascending and gives each a label', () => {
    for (const [id, band] of bandedEntries()) {
      expect(band.zones.length, id).toBeGreaterThan(0)
      let previous = Number.NEGATIVE_INFINITY
      for (const zone of band.zones) {
        expect(zone.label.length, `${id} zone label`).toBeGreaterThan(0)
        const lower = zone.min ?? Number.NEGATIVE_INFINITY
        const upper = zone.max ?? Number.POSITIVE_INFINITY
        expect(upper, `${id} zone ${zone.label}`).toBeGreaterThanOrEqual(lower)
        expect(lower, `${id} zone ${zone.label}`).toBeGreaterThanOrEqual(
          previous,
        )
        previous = lower
      }
    }
  })

  it('opens the outermost zone of each five-zone percentile table at both ends', () => {
    for (const id of ['cadence', 'verticalRatio'] as const) {
      const zones = METRIC_GUIDANCE[id].band?.zones ?? []
      expect(zones).toHaveLength(5)
      expect(zones[0].min).toBeNull()
      expect(zones[4].max).toBeNull()
    }
  })

  it("restates verticalRatio's zone labels in value order: each percentile is 100 minus Garmin's", () => {
    // Garmin ranks vertical ratio so that a LOWER value is a HIGHER percentile — a rank of
    // performance, not of value — and prints its table as >95 / 70–95 / 30–69 / 5–29 / <5, in
    // ascending order of value. Quoted verbatim, "3.00% falls in the Above-the-95th-percentile
    // zone" tells the runner low ranks higher. The shipped labels are the value-order percentiles.
    const GARMIN_PERCENTILES_ASCENDING_BY_VALUE: Array<[number, number]> = [
      [96, 100], // Garmin: ">95"
      [70, 95],
      [30, 69],
      [5, 29],
      [0, 4], // Garmin: "<5"
    ]
    const flipped = GARMIN_PERCENTILES_ASCENDING_BY_VALUE.map(([lo, hi]) => [
      100 - hi,
      100 - lo,
    ])
    expect(flipped).toEqual([
      [0, 4],
      [5, 30],
      [31, 70],
      [71, 95],
      [96, 100],
    ])
    const labels = METRIC_GUIDANCE.verticalRatio.band!.zones.map(
      (zone) => zone.label,
    )
    expect(labels).toEqual([
      "Lowest 5% of Garmin's table", // 0–4
      "5th–30th percentile of Garmin's table",
      "31st–70th percentile of Garmin's table",
      "71st–95th percentile of Garmin's table",
      "Highest 5% of Garmin's table", // 96–100
    ])
    // The three closed zones' label numbers ARE the flipped ranges, digit for digit.
    for (let i = 1; i <= 3; i++) {
      expect(labels[i].match(/\d+/g)?.map(Number), labels[i]).toEqual(
        flipped[i],
      )
    }
    // And the labels ascend with value, like the zones they name.
    for (const label of labels) expect(label).not.toMatch(/above|below/i)
  })

  it("keeps cadence's Garmin labels verbatim: that table already runs in value order", () => {
    // A higher cadence is a higher Garmin percentile, so these need no restating. Do not
    // "harmonise" them with verticalRatio's restated labels.
    const labels = METRIC_GUIDANCE.cadence.band!.zones.map((zone) => zone.label)
    expect(labels).toEqual([
      'Below the 5th percentile',
      '5th–29th percentile',
      '30th–69th percentile',
      '70th–95th percentile',
      'Above the 95th percentile',
    ])
    const firstPercentile = labels.map((label) =>
      Number(label.match(/\d+/)![0]),
    )
    expect(firstPercentile).toEqual([5, 5, 30, 70, 95])
    expect(labels[0]).toMatch(/^Below/)
    expect(labels[4]).toMatch(/^Above/)
  })

  it('leaves the publisher’s gaps open rather than closing them for tidiness', () => {
    // design.md D3: Garmin prints these tables with non-contiguous bounds, and halving preserves
    // the discontinuity exactly. Closing a gap would mean inventing a boundary — the precise thing
    // this module refuses to do — for a purely cosmetic gain. If these assertions ever fail
    // because a gap was closed, the fix is to reopen it, not to update the test.
    const verticalRatio = METRIC_GUIDANCE.verticalRatio.band?.zones ?? []
    expect(verticalRatio[1].max).toBe(0.037)
    expect(verticalRatio[2].min).toBe(0.0375)
    expect(verticalRatio[2].max).toBe(0.043)
    expect(verticalRatio[3].min).toBe(0.0435)

    const cadence = METRIC_GUIDANCE.cadence.band?.zones ?? []
    expect(cadence[1].max).toBe(163)
    expect(cadence[2].min).toBe(164)
    expect(cadence[2].max).toBe(173)
    expect(cadence[3].min).toBe(174)
  })
})

/**
 * Every string reachable from `value`, with the path it was reached by — so a failure names the
 * field rather than just the text.
 */
function stringsIn(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value))
    return value.flatMap((item, index) => stringsIn(item, `${path}[${index}]`))
  if (value !== null && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) =>
      stringsIn(item, `${path}.${key}`),
    )
  return []
}

describe('no grading word anywhere in the guidance record', () => {
  /**
   * A band has no preferred end (design.md D7.8, D10 R2 and the spec's "never a verdict"
   * requirement), and neither does anything said around one. This walks EVERY string reachable
   * from `METRIC_GUIDANCE` — labels, notes, reasons, summaries, hints, titles, even enum literals —
   * because a grading word erodes the rule wherever it lands, not only in a zone label.
   *
   * Word-boundary and case-insensitive, so `worsened` and `normalises` do not trip it while
   * `Worse` and `NORMAL` do.
   */
  const GRADING_WORDS =
    /\b(good|bad|poor|better|worse|best|worst|optimal|ideal|excessive|healthy|unhealthy|target|goal|should|correct|incorrect|normal|abnormal)\b/i

  /**
   * The only exemptions, each an EXACT phrase, each with the reason it is not a verdict on the
   * runner. The list is never widened by dropping a word from `GRADING_WORDS`; a new legitimate
   * use gets its own exact phrase here, and a cited paper's title that happens to contain one of
   * these words — a title is a quotation — is exempted by its exact title text, not by field.
   * No title in the record trips the list today.
   */
  const EXEMPT_PHRASES: Array<{ phrase: string; why: string }> = [
    {
      phrase: 'association-without-target',
      why: 'An `EvidenceDirection` literal whose whole meaning is that there is NO target.',
    },
    {
      phrase: '180 steps per minute is not a target',
      why: 'design.md D2 requires this negation on screen, in bold.',
    },
    {
      phrase: 'an association with no target attached',
      why: 'A negation: design.md D2 rank 1, "an association without a target".',
    },
    {
      phrase: 'There is no defensible target for trunk lean',
      why: 'A negation: design.md D2 rank 4, "no target angle".',
    },
    {
      phrase: 'no target angle at all',
      why: 'A negation, paraphrasing Braun 2024 exactly as design.md D2 rank 4 does.',
    },
    {
      phrase: 'No published target range',
      why: 'A negation: design.md D5.3/4, "No published target range in centimetres exists".',
    },
    {
      phrase: 'correlated with better running performance',
      why: "Folland 2017's own words about a performance outcome, quoted in design.md D2 rank 4.",
    },
    {
      phrase:
        '"there is currently no consensus on what qualifies as excessive overstriding"',
      why: 'A verbatim quotation of Baker 2024, and a statement that no threshold exists.',
    },
    {
      phrase: '"normal step width is 8–10 cm"',
      why: 'Quotes a claim in circulation in order to say it is unsourced and about walking.',
    },
    {
      phrase: 'Crossover is normal at speed',
      why: "Stiffler-Joachim's finding that a negative value is NOT a defect (design.md D5.3/4).",
    },
    {
      phrase: '"may be normal in a healthy population"',
      why: 'A verbatim quotation of Stiffler-Joachim 2020.',
    },
  ]

  const allStrings = stringsIn(METRIC_GUIDANCE, 'METRIC_GUIDANCE')

  it('walks a record that genuinely contains strings to check', () => {
    // Guards the walker itself: a walk that returned nothing would pass every assertion below.
    expect(allStrings.length).toBeGreaterThan(200)
  })

  it('carries none of the grading words outside the exact exempt phrases', () => {
    const offenders: string[] = []
    for (const [path, text] of allStrings) {
      const stripped = EXEMPT_PHRASES.reduce(
        (remaining, { phrase }) => remaining.split(phrase).join(' '),
        text,
      )
      const match = GRADING_WORDS.exec(stripped)
      if (match) offenders.push(`${path}: "${match[0]}" in ${text}`)
    }
    expect(offenders).toEqual([])
  })

  it('has no stale exemption — every exempt phrase still occurs somewhere', () => {
    for (const { phrase } of EXEMPT_PHRASES) {
      expect(
        allStrings.some(([, text]) => text.includes(phrase)),
        `exempt phrase no longer used: ${phrase}`,
      ).toBe(true)
    }
  })

  it('exempts only phrases that would otherwise trip the list', () => {
    for (const { phrase } of EXEMPT_PHRASES) {
      expect(GRADING_WORDS.test(phrase), phrase).toBe(true)
    }
  })
})

/**
 * Every string that renders to a runner, with its path. URLs are links, not prose, and are
 * excluded; everything else in the record — labels, notes, reasons, summaries, hints, titles —
 * reaches the screen somewhere.
 */
function renderedStrings(): Array<[string, string]> {
  return stringsIn(METRIC_GUIDANCE, 'METRIC_GUIDANCE').filter(
    ([path]) => !path.endsWith('.url'),
  )
}

describe('no implementation detail or jargon leaks into the rendered copy', () => {
  /**
   * Every string in the record renders to a runner. None of them may mention a source file, this
   * change's design document or its decision numbers, the word "ship", a bracketed "[derived]"
   * tag (the derivations say so in words instead), a p-value, a statistics shorthand ("CI", or
   * "GRADE"), a paper's own abbreviations ("FST", "RRIs"), anatomical shorthand ("ASIS"), a
   * units string a reader cannot parse, or an all-caps word used for emphasis.
   */
  const LEAKS =
    /src\/|\.tsx?\b|design\.md|\bD\d+\b|\bship(s|ped)?\b|\[derived|\bp\s*[<=>]|\bGRADE\b|\bRRIs?\b|\bASIS\b|\bFST\b|\bCI\b|this repo|Nm·s/

  /**
   * An all-caps word is emphasis or an unexplained acronym, and neither belongs in copy a runner
   * reads. Titles and short titles of cited works are exempt — a title is a quotation and keeps its
   * own capitalisation ("PLOS ONE", "IJSPT", "Garmin fenix 7 manual (APAC)").
   */
  const ALL_CAPS_WORD = /\b[A-Z]{3,}\b/
  const ALL_CAPS_ALLOWED: ReadonlySet<string> = new Set([])
  const isTitle = (path: string) => /\.(title|shortTitle)$/.test(path)

  it('walks a record that genuinely contains strings to check', () => {
    expect(renderedStrings().length).toBeGreaterThan(200)
  })

  it('carries no file path, design reference, "ship", "[derived]", p-value or shorthand', () => {
    const offenders = renderedStrings()
      .map(([path, text]) => [path, LEAKS.exec(text)?.[0], text] as const)
      .filter(([, match]) => match !== undefined)
      .map(([path, match, text]) => `${path}: "${match}" in ${text}`)
    expect(offenders).toEqual([])
  })

  it('uses no all-caps word outside the titles of cited works', () => {
    const offenders: string[] = []
    for (const [path, text] of renderedStrings()) {
      if (isTitle(path)) continue
      for (const word of text.match(new RegExp(ALL_CAPS_WORD, 'g')) ?? []) {
        if (!ALL_CAPS_ALLOWED.has(word)) offenders.push(`${path}: "${word}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('catches what it claims to catch', () => {
    for (const leak of [
      'see src/heuristics/strideLength.ts',
      'strideLength.ts pairs',
      'design.md D4 refuses one',
      'this band ships because',
      '4.06% [derived]',
      'no relationship (p = .074)',
      'a difference (p<0.05)',
      'not significant (p > .05)',
      'design decision D10 says',
      '(CI 0.91–0.98)',
      'with GRADE applied',
      'between FST and RRIs',
      'ASIS width',
      '3.26 Nm·s/kg/1000 m',
      'this repo’s own readings'.replace('’', "'"),
    ]) {
      expect(LEAKS.test(leak), leak).toBe(true)
    }
    expect(ALL_CAPS_WORD.test('step rate was NOT correlated')).toBe(true)
    expect(ALL_CAPS_WORD.test('relationship between two steps')).toBe(false)
  })
})

describe('pace beside a speed', () => {
  /** Exact seconds per kilometre (or per mile) for a speed in metres per second. */
  function paceSeconds(metresPerSecond: number, metresPerUnit: number): number {
    return metresPerUnit / metresPerSecond
  }
  /** `m:ss` → seconds. */
  function secondsOf(stated: string): number {
    const [minutes, seconds] = stated.split(':').map(Number)
    return minutes * 60 + seconds
  }
  /**
   * A stated `m:ss` is correct when it is the exact pace to the whole second, rounded either way:
   * 2.68 m/s is 600.5 s per mile, which the source study means as a 10:00 mile, and a runner reads
   * "10:00" and "10:01" as the same pace. Anything a second or more out is a typo.
   */
  function statesPace(stated: string, exactSeconds: number): boolean {
    return Math.abs(secondsOf(stated) - exactSeconds) < 1
  }
  const METRES_PER_MILE = 1609.344

  /**
   * One or more speeds followed by a parenthesised pace for each: "10 km/h (6:00 per km, 9:39 per
   * mile)", "2.68 to 3.83 m/s (6:13 to 4:21 per km, 10:00 to 7:00 per mile)", "2.5, 3.5 and 4.5
   * m/s (6:40, 4:46 and 3:42 per km)". A parenthesis that is not a pace — a quoted "(6:00-minute
   * mile)" — has no "per km" and is skipped.
   */
  const SPEED_WITH_PACE =
    /((?:\d+(?:\.\d+)?(?:, | and | to |–))*\d+(?:\.\d+)?) (m\/s|km\/h) \(([^)]*per km[^)]*)\)/g

  function numbersIn(text: string): number[] {
    return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
  }
  function pacesIn(text: string): string[] {
    return text.match(/\d+:\d\d/g) ?? []
  }

  const conversions = renderedStrings().flatMap(([path, text]) =>
    [...text.matchAll(SPEED_WITH_PACE)].map((match) => ({
      path,
      speeds: numbersIn(match[1]).map((value) =>
        match[2] === 'km/h' ? value / 3.6 : value,
      ),
      perKm: pacesIn(match[3].split('per km')[0]),
      perMile: match[3].includes('per mile')
        ? pacesIn(match[3].split('per km')[1])
        : [],
      raw: match[0],
    })),
  )

  it('finds the paces it is meant to check', () => {
    // 10 km/h, 10–12 km/h, 9.9 km/h, 9.9–10 km/h, 2.9 m/s, 2.68→3.83 m/s, 2.5/3.5/4.5 m/s and the
    // three step-width speeds, across the record. A walker that matched nothing would pass below.
    expect(conversions.length).toBeGreaterThanOrEqual(14)
  })

  it('states every pace as the exact conversion of the speed beside it', () => {
    for (const { path, speeds, perKm, perMile, raw } of conversions) {
      expect(perKm.length, `${path}: ${raw}`).toBe(speeds.length)
      speeds.forEach((speed, index) => {
        expect(
          statesPace(perKm[index], paceSeconds(speed, 1000)),
          `${path}: ${raw} — ${perKm[index]} per km`,
        ).toBe(true)
      })
      if (perMile.length === 0) continue
      expect(perMile.length, `${path}: ${raw}`).toBe(speeds.length)
      speeds.forEach((speed, index) => {
        expect(
          statesPace(perMile[index], paceSeconds(speed, METRES_PER_MILE)),
          `${path}: ${raw} — ${perMile[index]} per mile`,
        ).toBe(true)
      })
    }
  })

  it('checks the checker: right paces pass, a one-second typo fails', () => {
    const pinned: Array<[string, number, number]> = [
      ['6:00', 10 / 3.6, 1000],
      ['9:39', 10 / 3.6, METRES_PER_MILE],
      ['6:13', 2.68, 1000],
      ['4:21', 3.83, 1000],
      ['10:00', 2.68, METRES_PER_MILE],
      ['7:00', 3.83, METRES_PER_MILE],
      ['5:45', 2.9, 1000],
      ['6:40', 2.5, 1000],
      ['4:46', 3.5, 1000],
      ['3:42', 4.5, 1000],
    ]
    for (const [stated, speed, unit] of pinned) {
      expect(statesPace(stated, paceSeconds(speed, unit)), stated).toBe(true)
    }
    expect(statesPace('5:47', paceSeconds(2.9, 1000))).toBe(false)
    expect(statesPace('6:31', paceSeconds(2.68, 1000))).toBe(false)
  })

  it('gives a pace in the first string of each card that names a running speed', () => {
    // A runner thinks in pace and cannot convert metres per second in their head. A speed
    // DIFFERENCE ("per extra 1 m/s") has no pace and is skipped; a quoted pace ("6:00-minute
    // mile") counts as one.
    for (const entry of entries()) {
      const first = stringsIn(entry, entry.metric)
        .filter(([path]) => !path.endsWith('.url'))
        .map(([, text]) => text.replace(/per (extra )?1 m\/s/g, ''))
        .find((text) => /\d (m\/s|km\/h)/.test(text))
      if (first === undefined) continue
      expect(first, entry.metric).toMatch(/per km|-minute mile/)
    }
  })
})

describe('links within one metric', () => {
  it('never lists the same URL twice across a metric’s research and remediation', () => {
    for (const entry of entries()) {
      const urls = [...entry.research, ...entry.remediation].map(
        (link) => link.url,
      )
      const repeated = urls.filter((url, index) => urls.indexOf(url) !== index)
      expect(repeated, entry.metric).toEqual([])
    }
  })

  it('links no practitioner handout as remediation', () => {
    for (const entry of entries()) {
      expect(
        entry.remediation.filter((link) => link.kind === 'handout'),
        entry.metric,
      ).toEqual([])
    }
  })
})

describe('band labels describe people, never a target', () => {
  it('names the measured population in every single-zone label', () => {
    expect(METRIC_GUIDANCE.trunkLean.band!.zones[0].label).toBe(
      "Range across Folland's 97 runners",
    )
    expect(METRIC_GUIDANCE.kneeFlexion.band!.zones[0].label).toBe(
      "Range across Folland's 97 runners",
    )
    expect(
      METRIC_GUIDANCE.verticalOscillationCm.band!.zones[0].label,
    ).toContain("Malisoux's 860 runners")
  })

  it("labels every verticalRatio zone as a position in Garmin's table", () => {
    for (const zone of METRIC_GUIDANCE.verticalRatio.band!.zones) {
      expect(zone.label).toMatch(/of Garmin's table$/)
    }
  })

  it('keeps a central-tendency label a short noun that does not repeat its own value', () => {
    // The view prints "{label}: {value}", so a label carrying the value prints it twice.
    for (const [id, band] of bandedEntries()) {
      if (band.centralTendency === null) continue
      const { label, value } = band.centralTendency
      expect(label.length, id).toBeLessThanOrEqual(40)
      expect(label, id).not.toContain(String(value))
      expect(label, id).not.toMatch(/\bmean\b/i)
    }
  })
})

describe('guided-view-only copy', () => {
  it('bridges cadence to overstriding in one sentence above the remediation links', () => {
    const cadence = METRIC_GUIDANCE.cadence
    expect(cadence.remediationIntro).toBe(
      'Raising step rate is also the most-studied way to reduce overstriding — how far the foot lands ahead of the body. The Heiderscheit and Lenhart studies below measured that directly.',
    )
    // The two studies the sentence names sit straight after the self-administered protocol.
    expect(cadence.remediation.map((link) => link.shortTitle)).toEqual([
      'Huber & Verhoff 2024',
      'Heiderscheit et al. 2011',
      'Lenhart et al. 2014',
      'Petri et al. 2026',
      'Davis et al. 2020',
      'Gaudette et al. 2022',
    ])
  })

  it('leaves remediationIntro null everywhere else', () => {
    for (const entry of entries()) {
      if (entry.metric === 'cadence') continue
      expect(entry.remediationIntro, entry.metric).toBeNull()
    }
  })

  it('overrides the shared description on exactly overstriding and footStrikePattern', () => {
    const overridden = entries()
      .filter((entry) => entry.guidedDescription !== null)
      .map((entry) => entry.metric)
      .sort()
    expect(overridden).toEqual(['footStrikePattern', 'overstriding'])
    expect(METRIC_GUIDANCE.overstriding.guidedDescription).toBe(
      'How far your foot lands ahead of your hips at footstrike, relative to your torso length.',
    )
    expect(METRIC_GUIDANCE.footStrikePattern.guidedDescription).toBe(
      'Whether your foot tends to land heel-, midfoot- or forefoot-first.',
    )
    for (const entry of entries()) {
      expect(entry.guidedDescription ?? '', entry.metric).not.toMatch(
        /proxy|pipeline|risk/i,
      )
    }
  })

  it('drops the "Within one runner" and "Between runners" prefixes the view now renders as labels', () => {
    for (const entry of entries()) {
      const speed = entry.speedSensitivity
      if (speed === null) continue
      expect(speed.withinRunner ?? '', entry.metric).not.toMatch(/^within/i)
      expect(speed.betweenRunners ?? '', entry.metric).not.toMatch(/^between/i)
    }
  })
})

describe('referenceBandEnvelope', () => {
  /** A band to vary only the zones of. Everything but `zones` is irrelevant to the envelope. */
  function withZones(zones: ReferenceBand['zones']): ReferenceBand {
    return { ...METRIC_GUIDANCE.cadence.band!, zones }
  }

  it('returns exactly these envelopes for the five shipped bands', () => {
    expect(referenceBandEnvelope(METRIC_GUIDANCE.cadence.band!)).toEqual({
      min: 153,
      max: 183,
    })
    expect(referenceBandEnvelope(METRIC_GUIDANCE.verticalRatio.band!)).toEqual({
      min: 0.0305,
      max: 0.0505,
    })
    expect(
      referenceBandEnvelope(METRIC_GUIDANCE.verticalOscillationCm.band!),
    ).toEqual({
      min: 6.0,
      max: 9.5,
    })
    expect(referenceBandEnvelope(METRIC_GUIDANCE.trunkLean.band!)).toEqual({
      min: 1.8,
      max: 21.4,
    })
    expect(referenceBandEnvelope(METRIC_GUIDANCE.kneeFlexion.band!)).toEqual({
      min: 71.3,
      max: 129,
    })
  })

  it('contains every finite bound of every shipped band', () => {
    for (const [id, band] of bandedEntries()) {
      const envelope = referenceBandEnvelope(band)
      expect(envelope, id).not.toBeNull()
      if (!envelope) continue
      for (const zone of band.zones) {
        for (const bound of [zone.min, zone.max]) {
          if (bound === null) continue
          expect(bound, `${id} ${zone.label}`).toBeGreaterThanOrEqual(
            envelope.min,
          )
          expect(bound, `${id} ${zone.label}`).toBeLessThanOrEqual(envelope.max)
        }
      }
    }
  })

  it('takes its lower edge from a finite max and its upper edge from a finite min when those are the extremes', () => {
    // Two open-ended zones and nothing else: the only finite `min` is 12 and the only finite
    // `max` is 10. Reading edges from `min`s and `max`es separately would return {12, 10}.
    expect(
      referenceBandEnvelope(
        withZones([
          { label: 'below', min: null, max: 10, shareOfRunners: null },
          { label: 'above', min: 12, max: null, shareOfRunners: null },
        ]),
      ),
    ).toEqual({ min: 10, max: 12 })
  })

  it('spans a gapped table from its lowest to its highest published bound', () => {
    expect(
      referenceBandEnvelope(
        withZones([
          { label: 'below', min: null, max: 150, shareOfRunners: null },
          { label: 'middle', min: 153, max: 163, shareOfRunners: null },
          { label: 'above', min: 164, max: null, shareOfRunners: null },
        ]),
      ),
    ).toEqual({ min: 150, max: 164 })
  })

  it('returns a single closed zone as its own bounds', () => {
    expect(
      referenceBandEnvelope(
        withZones([{ label: 'only', min: 6, max: 9.5, shareOfRunners: null }]),
      ),
    ).toEqual({ min: 6, max: 9.5 })
  })

  it('returns null for a band that publishes no finite bound', () => {
    expect(
      referenceBandEnvelope(
        withZones([
          {
            label: 'Anything at all',
            min: null,
            max: null,
            shareOfRunners: null,
          },
        ]),
      ),
    ).toBeNull()
  })

  it('returns null rather than a zero-width envelope', () => {
    expect(
      referenceBandEnvelope(
        withZones([{ label: 'a point', min: 7, max: 7, shareOfRunners: null }]),
      ),
    ).toBeNull()
    expect(
      referenceBandEnvelope(
        withZones([
          { label: 'below', min: null, max: 7, shareOfRunners: null },
        ]),
      ),
    ).toBeNull()
  })
})

/**
 * Every published number in the five bands, transcribed from design.md D2/D3 as literals.
 *
 * The domain and ordering tests above would stay green through a plausible-looking typo — a
 * cadence bound of 158 instead of 153, a Malisoux n of 680 instead of 860 — because a wrong
 * published number is still a number in range. These are the only assertions that would catch
 * one, so they name every bound, every central statistic and every sample size individually.
 */
describe('pinned band numbers', () => {
  const EXPECTED_ZONE_BOUNDS: Record<
    BandedMetricId,
    Array<[number | null, number | null]>
  > = {
    cadence: [
      [null, 153],
      [153, 163],
      [164, 173],
      [174, 183],
      [183, null],
    ],
    // design.md D3, halved: <3.05 / 3.05–3.70 / 3.75–4.30 / 4.35–5.05 / >5.05 %, stored 0..1.
    verticalRatio: [
      [null, 0.0305],
      [0.0305, 0.037],
      [0.0375, 0.043],
      [0.0435, 0.0505],
      [0.0505, null],
    ],
    verticalOscillationCm: [[6.0, 9.5]],
    trunkLean: [[1.8, 21.4]],
    // Folland 2017 Table 2, minimum knee extension angle during swing, (−129, −71.3), sign flipped.
    kneeFlexion: [[71.3, 129]],
  }

  const EXPECTED_CENTRAL_TENDENCY: Record<BandedMetricId, number | null> = {
    cadence: null,
    verticalRatio: null,
    verticalOscillationCm: 7.7,
    trunkLean: 10.3,
    kneeFlexion: 94.1,
  }

  /** `[source, ...corroboration]` sample sizes, in order. */
  const EXPECTED_SAMPLE_SIZES: Record<BandedMetricId, string[]> = {
    cadence: ['Not published', '860', '97'],
    verticalRatio: ['Not published', '97'],
    verticalOscillationCm: ['860', '45'],
    trunkLean: ['97'],
    kneeFlexion: ['97', '28', 'Book chapter; the cohort is not restated'],
  }

  it("sources kneeFlexion's band from Folland's published swing distribution, not a pooled span", () => {
    const band = METRIC_GUIDANCE.kneeFlexion.band!
    expect(band.source.url).toBe(
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370',
    )
    expect(band.source.sampleSize).toBe('97')
    expect(band.centralTendency?.label).toBe('Average in this study (± 11.1°)')
    expect(band.zones.map((zone) => zone.label)).toEqual([
      "Range across Folland's 97 runners",
    ])
    expect(band.derivation).toBeNull()
    // Fukuchi's three speed means and Hanley now stand beside the band, not inside it.
    expect(band.corroboration.map((source) => source.title)).toEqual([
      'Fukuchi, Fukuchi & Duarte 2017, PeerJ 5:e3298',
      'Hanley 2021, "The Biomechanics of Distance Running"',
    ])
    expect(band.corroboration[0].population).toContain('93.5 ± 10.4°')
    expect(band.corroboration[0].population).toContain('108.7 ± 10.7°')
    expect(band.corroboration[0].population).toContain('119.1 ± 10.4°')
    expect(JSON.stringify(band)).not.toMatch(/pooled|deliberately wide/i)
    expect(band.note).toContain('93–119° must be swing')
    expect(band.note).toContain('Novacheck 1998')
    expect(METRIC_GUIDANCE.kneeFlexion.speedSensitivity).not.toBeNull()
  })

  it('pins every zone bound of every band', () => {
    for (const [id, band] of bandedEntries()) {
      expect(
        band.zones.map((zone) => [zone.min, zone.max]),
        id,
      ).toEqual(EXPECTED_ZONE_BOUNDS[id as BandedMetricId])
    }
  })

  it('pins every central-tendency value', () => {
    for (const [id, band] of bandedEntries()) {
      expect(band.centralTendency?.value ?? null, id).toBe(
        EXPECTED_CENTRAL_TENDENCY[id as BandedMetricId],
      )
    }
  })

  it('pins every source and corroboration sample size', () => {
    for (const [id, band] of bandedEntries()) {
      expect(
        [band.source, ...band.corroboration].map((source) => source.sampleSize),
        id,
      ).toEqual(EXPECTED_SAMPLE_SIZES[id as BandedMetricId])
    }
  })

  it('puts every central-tendency value inside its own band envelope', () => {
    for (const [id, band] of bandedEntries()) {
      if (band.centralTendency === null) continue
      const envelope = referenceBandEnvelope(band)
      expect(envelope, id).not.toBeNull()
      if (!envelope) continue
      expect(band.centralTendency.value, id).toBeGreaterThanOrEqual(
        envelope.min,
      )
      expect(band.centralTendency.value, id).toBeLessThanOrEqual(envelope.max)
    }
  })
})

describe('mandatory notes', () => {
  /**
   * The exact set of metrics that must say something extra whenever they render, pinned in full so
   * that adding or removing one is a visible diff rather than a silent omission.
   *
   * design.md D5 makes four of these mandatory by name — `overstriding`, `stepWidth`,
   * `stepWidthCm` and `footStrikePattern`. `cadence` carries the statement D2 puts in bold (that
   * 180 steps per minute is not a target and must not appear as one), and `verticalOscillationCm`
   * carries the height confound D9.4 says must be said on screen.
   */
  const EXPECTED_NOTE_CARRIERS: MetricId[] = [
    'cadence',
    'verticalOscillationCm',
    'trunkLean',
    'overstriding',
    'stepWidth',
    'stepWidthCm',
    'footStrikePattern',
    'swingFootLateralExcursion',
  ]

  it('carries a note on exactly the metrics that need one', () => {
    const carriers = entries()
      .filter((entry) => entry.mandatoryNotes.length > 0)
      .map((entry) => entry.metric)
      .sort()
    expect(carriers).toEqual([...EXPECTED_NOTE_CARRIERS].sort())
  })

  it('carries the note design.md D5 requires on overstriding', () => {
    const notes = METRIC_GUIDANCE.overstriding.mandatoryNotes.join(' ')
    expect(METRIC_GUIDANCE.overstriding.mandatoryNotes.length).toBeGreaterThan(
      0,
    )
    // The two published measurements disagree by 3.4x, and the only defensible statement is the
    // relative one.
    expect(notes).toContain('3.4')
    expect(notes).toContain('24%')
    // In the two papers' own published units, with the ratio labelled as arithmetic. A torso-length
    // conversion would rest on an assumed torso constant, so none renders.
    expect(notes).toContain(
      "about 3.4× apart (our arithmetic from the two papers' figures)",
    )
    expect(notes).not.toMatch(/torso length/i)
  })

  it('labels the derived step-width figure as derived, on screen', () => {
    expect(METRIC_GUIDANCE.stepWidthCm.noBandReason).toContain(
      "about 1.8 cm in this app's convention (half of Arellano & Kram's foot-to-foot figure)",
    )
  })

  it('carries the note design.md D5 requires on both step-width metrics', () => {
    for (const id of ['stepWidth', 'stepWidthCm'] as const) {
      const notes = METRIC_GUIDANCE[id].mandatoryNotes.join(' ')
      expect(METRIC_GUIDANCE[id].mandatoryNotes.length, id).toBeGreaterThan(0)
      // Crossover is normal at speed, and neither metric may treat a negative value as a defect.
      expect(notes, id).toContain('not a defect')
      expect(notes, id).toContain('crossover')
    }
  })

  it('carries the prevalence note design.md D5 requires on footStrikePattern', () => {
    const notes = METRIC_GUIDANCE.footStrikePattern.mandatoryNotes.join(' ')
    expect(notes).toContain('8 in 10')
    expect(notes).toContain('rearfoot')
  })

  it('says on the cadence card that 180 steps per minute is not a target', () => {
    expect(METRIC_GUIDANCE.cadence.mandatoryNotes.join(' ')).toContain(
      '180 steps per minute is not a target',
    )
  })

  it('never leaves mandatoryNotes null', () => {
    for (const entry of entries()) {
      expect(Array.isArray(entry.mandatoryNotes), entry.metric).toBe(true)
    }
  })
})

describe('speed sensitivity', () => {
  it('records it on every banded metric whose published values move with speed', () => {
    for (const id of [
      'cadence',
      'verticalRatio',
      'verticalOscillationCm',
      'kneeFlexion',
    ] as const) {
      const speed = METRIC_GUIDANCE[id].speedSensitivity
      expect(speed, id).not.toBeNull()
      expect(speed?.summary.length, id).toBeGreaterThan(0)
    }
  })

  it('leaves it null on trunkLean — an absence of evidence, not evidence of absence', () => {
    // design.md D9.2: trunk lean is the one banded metric with no speed dependence stated in the
    // research pass. The spec requires the caveat NOT to render where nothing was established, so
    // that it keeps meaning something on the four where something was.
    expect(METRIC_GUIDANCE.trunkLean.speedSensitivity).toBeNull()
  })

  it('keeps a non-speed statement out of the speed slot on both step-width metrics', () => {
    // Pelvis width is a body dimension, not a speed effect. It renders as a mandatory note.
    for (const id of ['stepWidth', 'stepWidthCm'] as const) {
      const speed = METRIC_GUIDANCE[id].speedSensitivity
      expect(speed?.betweenRunners, id).toBeNull()
      expect(JSON.stringify(speed), id).not.toMatch(/pelvis/i)
      expect(METRIC_GUIDANCE[id].mandatoryNotes.join(' '), id).toContain(
        'pelvis width',
      )
    }
  })

  it('separates the within-runner claim from the between-runner one on cadence', () => {
    const speed = METRIC_GUIDANCE.cadence.speedSensitivity
    expect(speed?.withinRunner).not.toBeNull()
    expect(speed?.betweenRunners).not.toBeNull()
    expect(speed?.betweenRunners).toContain('not correlated')
    // The view labels the two halves, so neither may restate its own label as a prefix.
    expect(speed?.withinRunner).not.toMatch(/^within one runner/i)
    expect(speed?.betweenRunners).not.toMatch(/^between runners/i)
  })
})

describe('evidence direction', () => {
  it('records a direction for every metric, banded or not', () => {
    for (const entry of entries()) {
      expect(entry.evidenceDirection, entry.metric).toBeTruthy()
    }
  })

  it('marks the two contested metrics and the one redistribution as such', () => {
    expect(METRIC_GUIDANCE.trunkLean.evidenceDirection).toBe('contested')
    expect(METRIC_GUIDANCE.stepWidth.evidenceDirection).toBe('contested')
    expect(METRIC_GUIDANCE.stepWidthCm.evidenceDirection).toBe('contested')
    expect(METRIC_GUIDANCE.footStrikePattern.evidenceDirection).toBe(
      'redistribution-not-improvement',
    )
  })
})

describe('remediation', () => {
  /**
   * design.md D8, and the single most likely thing in this file for a future reader to "fix".
   *
   * `overstriding` cannot carry a band, so its actionable answer is deliberately attached to
   * `cadence` as well as to itself: the evidenced intervention for overstriding IS a 5-10% step
   * rate increase, and the literature makes the link explicitly. These three links appearing on
   * two cards is the feature, not a copy-paste error.
   */
  it('puts the overstriding intervention links on the cadence card too', () => {
    const cadenceUrls = METRIC_GUIDANCE.cadence.remediation.map(
      (link) => link.url,
    )
    for (const link of METRIC_GUIDANCE.overstriding.remediation) {
      expect(cadenceUrls, `cadence is missing ${link.title}`).toContain(
        link.url,
      )
    }
    expect(METRIC_GUIDANCE.overstriding.remediation.length).toBeGreaterThan(0)
  })

  it('leaves footStrikePattern with none, which is the finding', () => {
    // With the injury link rated low evidence and the mechanical difference a redistribution
    // rather than an improvement, there is nothing to remediate toward.
    expect(METRIC_GUIDANCE.footStrikePattern.remediation).toEqual([])
  })
})

describe('capture hints', () => {
  /** Every (metric, hint) pair, so each assertion below names the metric and the cause. */
  function allHints(): Array<[string, string]> {
    return entries().flatMap((entry) => [
      [`${entry.metric}.wrongAngle`, entry.captureHints.wrongAngle],
      [`${entry.metric}.notEnoughData`, entry.captureHints.notEnoughData],
    ])
  }

  it('gives every metric both hints', () => {
    for (const [path, hint] of allHints()) {
      expect(hint.length, path).toBeGreaterThan(40)
    }
  })

  it('talks about filming, never about how the runner runs', () => {
    for (const [path, hint] of allHints()) {
      expect(hint, path).toMatch(/\b(film|record)/i)
    }
  })

  it('keeps camera-angle advice out of the not-enough-data hint', () => {
    // That hint is shown when the angle was fine and something else ran short. Telling the reader
    // to change the angle there sends them to re-film for the wrong reason.
    for (const entry of entries()) {
      expect(entry.captureHints.notEnoughData, entry.metric).not.toMatch(
        /in front of or behind|square to/i,
      )
    }
  })

  /** Whether any view makes this metric 'unsuitable' — the only way `wrongAngle` is ever shown. */
  function hasUnsuitableView(id: MetricId): boolean {
    const row = DEFAULT_VIEW_FIT_TABLE[id]
    return [row.side, row.front, row.ambiguous].some(
      (cell) => cell.fit === 'unsuitable',
    )
  }

  const ASKS_FOR_SIDE_ON = /^Film side-on/
  const ASKS_FOR_FRONT_OR_REAR = /^Film from directly in front of or behind/
  const NO_ANGLE_RULED_OUT = /still works at reduced confidence/

  it('asks for side-on exactly where a front view is unsuitable, and front-or-rear exactly where a side view is', () => {
    // Cross-checked against `DEFAULT_VIEW_FIT_TABLE`, in both directions: a hint that asked for the
    // wrong angle would send a reader away to re-film a clip that still could not be measured.
    for (const entry of entries()) {
      const row = DEFAULT_VIEW_FIT_TABLE[entry.metric]
      const hint = entry.captureHints.wrongAngle
      if (row.front.fit === 'unsuitable') {
        expect(row.side.fit, entry.metric).toBe('primary')
        expect(hint, entry.metric).toMatch(ASKS_FOR_SIDE_ON)
      } else {
        expect(hint, entry.metric).not.toMatch(ASKS_FOR_SIDE_ON)
      }
      if (row.side.fit === 'unsuitable') {
        expect(row.front.fit, entry.metric).toBe('primary')
        expect(hint, entry.metric).toMatch(ASKS_FOR_FRONT_OR_REAR)
      } else {
        expect(hint, entry.metric).not.toMatch(ASKS_FOR_FRONT_OR_REAR)
      }
    }
  })

  it('says no angle rules the metric out exactly where no view is unsuitable', () => {
    for (const entry of entries()) {
      const hint = entry.captureHints.wrongAngle
      if (hasUnsuitableView(entry.metric)) {
        expect(hint, entry.metric).not.toMatch(NO_ANGLE_RULED_OUT)
      } else {
        expect(hint, entry.metric).toMatch(NO_ANGLE_RULED_OUT)
      }
    }
  })

  it('pins which metrics get which angle hint, by name', () => {
    const byKind = (pattern: RegExp) =>
      entries()
        .filter((entry) => pattern.test(entry.captureHints.wrongAngle))
        .map((entry) => entry.metric)
        .sort()
    expect(byKind(ASKS_FOR_SIDE_ON)).toEqual(
      [
        'footStrikePattern',
        'kneeDrive',
        'kneeFlexion',
        'overstriding',
        'trunkLean',
        'verticalRatio',
      ].sort(),
    )
    expect(byKind(ASKS_FOR_FRONT_OR_REAR)).toEqual(
      ['armSwingAmplitude', 'stepWidth', 'stepWidthCm', 'swingFootLateralExcursion'].sort(),
    )
    expect(byKind(NO_ANGLE_RULED_OUT)).toEqual(
      ['cadence', 'verticalOscillation', 'verticalOscillationCm'].sort(),
    )
  })

  it('explains arm swing by the far arm being hidden, not by side-to-side placement', () => {
    expect(METRIC_GUIDANCE.armSwingAmplitude.captureHints.wrongAngle).toBe(
      "Film from directly in front of or behind the runner. From the side, the far arm is hidden behind the body, so only one arm's swing can be seen.",
    )
  })

  it('names the real-size requirement on exactly the two centimetre metrics', () => {
    for (const entry of entries()) {
      const needsScale =
        entry.metric === 'verticalOscillationCm' ||
        entry.metric === 'stepWidthCm'
      expect(
        entry.captureHints.notEnoughData.includes(
          "work out the runner's real size",
        ),
        entry.metric,
      ).toBe(needsScale)
    }
  })

  it('never advises a side-on pass on a metric that needs a front or rear camera', () => {
    expect(METRIC_GUIDANCE.stepWidthCm.captureHints.notEnoughData).not.toMatch(
      /side-on/i,
    )
    expect(
      METRIC_GUIDANCE.verticalOscillationCm.captureHints.notEnoughData,
    ).toMatch(/steady side-on pass/)
  })
})

describe('zone shares — how many runners each zone holds', () => {
  it('publishes a share for every zone of a band or for none of them', () => {
    for (const [id, band] of bandedEntries()) {
      const shares = band.zones.map((zone) => zone.shareOfRunners)
      const published = shares.filter((share) => share !== null).length
      expect(
        published === 0 || published === shares.length,
        `${id}: ${published} of ${shares.length} zones carry a share`,
      ).toBe(true)
    }
  })

  it("sums a published band's shares to exactly 1", () => {
    let checked = 0
    for (const [id, band] of bandedEntries()) {
      const shares = band.zones.map((zone) => zone.shareOfRunners)
      if (shares.some((share) => share === null)) continue
      checked++
      const total = (shares as number[]).reduce((sum, share) => sum + share, 0)
      expect(total, id).toBeCloseTo(1, 10)
    }
    expect(checked, 'some shipped band publishes shares').toBeGreaterThan(0)
  })

  it("derives cadence's shares from Garmin's cut points, not from its own zone labels", () => {
    // Garmin's published cut points are the 5th, 30th, 70th and 95th percentiles; the zones are
    // the spans between them. Transcribed here rather than read from the labels, which is exactly
    // the mistake this pins against: reading the LABELS as spans sums to 1.01, because writing
    // half-open intervals as inclusive integers is an artefact of English.
    const CUT_POINTS = [0, 5, 30, 70, 95, 100]
    const expected = CUT_POINTS.slice(1).map(
      (cut, index) => (cut - CUT_POINTS[index]) / 100,
    )
    const band = METRIC_GUIDANCE.cadence.band!
    expect(band.zones.map((zone) => zone.shareOfRunners)).toEqual(expected)
    expect(expected.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it("derives verticalRatio's shares from the same cut points, not from its restated labels", () => {
    // ⚠️ This used to assert `ratio === reverse(cadence)` AND `ratio === cadence`, which is one
    // statement about a palindrome and holds for any symmetric list — including a wrong one.
    //
    // Garmin's cut points are the 5th, 30th, 70th and 95th percentiles. Vertical ratio is Garmin's
    // table read in value order (design.md D3), and the four cuts fall in the same four places.
    const CUT_POINTS = [0, 5, 30, 70, 95, 100]
    const expected = CUT_POINTS.slice(1).map(
      (cut, index) => (cut - CUT_POINTS[index]) / 100,
    )
    const band = METRIC_GUIDANCE.verticalRatio.band!
    expect(band.zones.map((zone) => zone.shareOfRunners)).toEqual(expected)
    expect(expected.reduce((a, b) => a + b, 0)).toBe(1)

    // And the mistake that pins against: reading the LABELS as spans. They restate half-open
    // intervals as inclusive integers ("5th–30th", "31st–70th"), so counting the integers each
    // names sums to 101, not 100 — the extra point is an artefact of English.
    const fromLabels = band.zones.map((zone) => {
      const span = /^(\d+)(?:st|nd|rd|th)–(\d+)(?:st|nd|rd|th) percentile/.exec(
        zone.label,
      )
      if (span !== null) return Number(span[2]) - Number(span[1]) + 1
      const tail = /^(?:Lowest|Highest) (\d+)%/.exec(zone.label)
      if (tail !== null) return Number(tail[1])
      throw new Error(`unparsed zone label: ${zone.label}`)
    })
    expect(fromLabels.reduce((a, b) => a + b, 0)).toBe(101)
    expect(fromLabels.map((points) => points / 100)).not.toEqual(expected)
  })

  it('publishes no share for a band that is one observed range', () => {
    for (const id of [
      'verticalOscillationCm',
      'trunkLean',
      'kneeFlexion',
    ] as const) {
      const band = METRIC_GUIDANCE[id].band!
      expect(band.zones, id).toHaveLength(1)
      // verticalOscillationCm especially: its own derivation says "no percentile of the combined
      // cohort is claimed", so a share here would contradict the statement beside it.
      expect(band.zones[0].shareOfRunners, id).toBeNull()
    }
  })
})

describe('zone owner — whose zones a headline names', () => {
  it('names the population exactly where the zone labels do not', () => {
    for (const [id, band] of bandedEntries()) {
      const labelsSayWhose = band.zones.every((zone) =>
        /Garmin|Folland|Malisoux/.test(zone.label),
      )
      expect(band.zoneOwner === null, `${id} zoneOwner`).toBe(labelsSayWhose)
    }
    // "of Garmin's table", not "of Garmin's runners": the same manual's own citation line says the
    // population is not published, so naming a cohort here would name one nobody has described.
    expect(METRIC_GUIDANCE.cadence.band!.zoneOwner).toBe("of Garmin's table")
  })

  it('reads as a trailing phrase, so a label plus an owner is one noun phrase', () => {
    for (const [id, band] of bandedEntries()) {
      if (band.zoneOwner === null) continue
      expect(band.zoneOwner, id).toMatch(/^of /)
      expect(band.zoneOwner.length, id).toBeLessThanOrEqual(40)
    }
  })
})

describe('the short population, for the visible citation line', () => {
  it('is a short noun phrase with no digits and no pace', () => {
    for (const [id, band] of bandedEntries()) {
      for (const source of [band.source, ...band.corroboration]) {
        const short = source.populationShort
        expect(short.length, `${id}: ${short}`).toBeGreaterThan(0)
        expect(short.length, `${id}: ${short}`).toBeLessThanOrEqual(40)
        // A digit here would be a pace, a sample size or a percentile — the line already carries
        // the sample size, and a pace needs the full sentence around it to mean anything.
        expect(short, `${id}: ${short}`).not.toMatch(/\d/)
        expect(short, `${id}: ${short}`).not.toMatch(
          /km\/h|m\/s|per km|per mile|pace|speed/i,
        )
        // Mid-line, so it does not open with a capital.
        expect(short[0], `${id}: ${short}`).toBe(short[0].toLowerCase())
      }
    }
  })

  it("says Garmin's population is not stated, in both manuals, from one constant", () => {
    expect(METRIC_GUIDANCE.cadence.band!.source.populationShort).toBe(
      'population not stated',
    )
    expect(METRIC_GUIDANCE.verticalRatio.band!.source.populationShort).toBe(
      METRIC_GUIDANCE.cadence.band!.source.populationShort,
    )
  })

  it('is a compression of the full population, not a different claim', () => {
    // Every word of the short form appears in the full sentence — except Garmin's, whose full
    // sentence is a paragraph about the absence of a population and says "Not stated" instead.
    for (const [id, band] of bandedEntries()) {
      for (const source of [band.source, ...band.corroboration]) {
        if (source.populationShort === 'population not stated') {
          expect(source.population, id).toMatch(/^Not stated/)
          continue
        }
        for (const word of source.populationShort.split(' ')) {
          expect(source.population.toLowerCase(), `${id}: ${word}`).toContain(
            word.toLowerCase(),
          )
        }
      }
    }
  })
})

describe('the one studied change a card may show', () => {
  /**
   * Which metrics carry a Try line, named one at a time. A thirteenth line is then a deliberate
   * act with a reviewable diff, which is the same discipline `BANDED_METRICS` applies to bands.
   */
  const WITH_TRY_LINE: MetricId[] = [
    'cadence',
    'verticalOscillationCm',
    'verticalOscillation',
    'overstriding',
  ]

  it('is carried by exactly the metrics named here', () => {
    const carrying = entries()
      .filter((entry) => entry.tryLine !== null)
      .map((entry) => entry.metric)
    expect(new Set(carrying)).toEqual(new Set(WITH_TRY_LINE))
  })

  it("links a study from that metric's own remediation list", () => {
    for (const entry of entries()) {
      if (entry.tryLine === null) continue
      expect(
        entry.remediation.map((link) => link.url),
        entry.metric,
      ).toContain(entry.tryLine.url)
    }
  })

  it('is absent wherever the metric has no study of a change to name', () => {
    for (const entry of entries()) {
      if (entry.remediation.length > 0) continue
      expect(entry.tryLine, entry.metric).toBeNull()
    }
    // Not vacuous: two metrics have an empty remediation list, and it is a finding in both.
    expect(
      entries().filter((entry) => entry.remediation.length === 0).length,
    ).toBeGreaterThan(0)
  })

  it('states a change from the runner’s own value, with no target and no grading word', () => {
    for (const entry of entries()) {
      if (entry.tryLine === null) continue
      const { text } = entry.tryLine
      expect(text.length, entry.metric).toBeLessThanOrEqual(100)
      // Mid-sentence: the view prefixes "Try: ".
      expect(text[0], entry.metric).toBe(text[0].toLowerCase())
      expect(text, entry.metric).not.toMatch(
        /\b(should|target|aim|must|ought|ideal|optimal|correct|proper|good|bad|poor|excessive|normal|better|worse|recommended)\b/i,
      )
      // A percentage here is a change from a baseline, so it is always relative to "your own".
      if (/%/.test(text)) {
        expect(text, entry.metric).toMatch(/your own/)
      }
    }
  })

  it('is a compression of the linked study, not a new claim', () => {
    // ⚠️ This used to assert only that the linked study HAS a non-empty summary, which every link
    // does — so any Try line text passed it, including one whose claim came from somewhere else.
    // Two checks that can actually fail:
    //
    // 1. Every number the line quotes is in that study's own summary. `cadence`'s "5–10%" and
    //    "2–3 runs a week" are Huber's protocol; a number from another paper fails here.
    // 2. No superlative and no grading token. A superlative ranks the literature rather than the
    //    runner, but it is still a claim, and it belongs beside the source that supports it — which
    //    is `remediationIntro`, inside the disclosure, next to the two studies that measured it.
    let checked = 0
    for (const entry of entries()) {
      if (entry.tryLine === null) continue
      const { text } = entry.tryLine
      const link = entry.remediation.find((l) => l.url === entry.tryLine!.url)!
      expect(link.summary.length, entry.metric).toBeGreaterThan(0)
      for (const number of text.match(
        /\d+(?:[.,]\d+)?(?:–\d+(?:[.,]\d+)?)?%?/g,
      ) ?? []) {
        checked++
        expect(link.summary, `${entry.metric}: ${number}`).toContain(number)
      }
      expect(text, entry.metric).not.toMatch(
        /\b(most[- ]studied|best|only|should|target|optimal|better|worse)\b/i,
      )
    }
    // Not vacuous: some shipped line quotes a number.
    expect(checked).toBeGreaterThan(0)
  })

  it('names which way it moves the quantity its own card reports', () => {
    for (const entry of entries()) {
      if (entry.tryLine === null) continue
      expect(['lower', 'higher'], entry.metric).toContain(
        entry.tryLine.direction,
      )
    }
    // `overstriding`'s cue RAISES step rate, and its direction is `'lower'`, because the quantity
    // its card reports is overstriding. Pinned by name: getting this backwards would point a runner
    // further out of range on exactly the card the rule exists for.
    expect(METRIC_GUIDANCE.overstriding.tryLine!.direction).toBe('lower')
    expect(METRIC_GUIDANCE.cadence.tryLine!.direction).toBe('higher')
    expect(METRIC_GUIDANCE.verticalOscillationCm.tryLine!.direction).toBe(
      'lower',
    )
    expect(METRIC_GUIDANCE.verticalOscillation.tryLine!.direction).toBe('lower')
  })
})
