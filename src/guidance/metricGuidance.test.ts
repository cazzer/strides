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
}

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
  'https://velocityproject.fammed.wisc.edu/wp-content/uploads/sites/2347/2025/05/Running-Injury-Risk-Reduction-Infographic.pdf',
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
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
  it('is unique and dense across 1..12', () => {
    const ranks = entries()
      .map((entry) => entry.displayRank)
      .sort((a, b) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
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

  it('marks exactly one band as derived, and says what the derivation rests on', () => {
    const derived = bandedEntries().filter(
      ([, band]) => band.derivation !== null,
    )
    expect(derived.map(([id]) => id)).toEqual(['verticalRatio'])
    const derivation = METRIC_GUIDANCE.verticalRatio.band?.derivation
    // One leg per side: Garmin's denominator is a step, this app's is a true stride. R1(ii) admits
    // the conversion only because each leg is a stated definition rather than a fitted constant.
    expect(derivation?.restsOn).toHaveLength(2)
    expect(derivation?.statement).toContain('halved')
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

  it('carries no grading word in any zone or central-tendency label', () => {
    // A band has no preferred end (design.md D7.8 and the spec's "never a verdict" requirement).
    // Zone labels are where that would erode first — "Good", "Needs work" — so they are held to
    // percentile and range wording only.
    const grading =
      /\b(good|bad|poor|better|worse|best|worst|optimal|ideal|excessive|target|goal)\b/i
    for (const [id, band] of bandedEntries()) {
      for (const zone of band.zones) {
        expect(
          grading.test(zone.label),
          `${id} zone label: ${zone.label}`,
        ).toBe(false)
      }
      if (band.centralTendency) {
        const label = band.centralTendency.label
        expect(grading.test(label), `${id} central label: ${label}`).toBe(false)
      }
    }
  })
})

describe('referenceBandEnvelope', () => {
  it('returns the finite extent of every shipped band', () => {
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
      min: 85,
      max: 125,
    })
  })

  it('adds nothing to the published numbers — the envelope is a bound of them', () => {
    for (const [id, band] of bandedEntries()) {
      const envelope = referenceBandEnvelope(band)
      expect(envelope, id).not.toBeNull()
      if (!envelope) continue
      for (const zone of band.zones) {
        if (zone.min !== null)
          expect(zone.min).toBeGreaterThanOrEqual(envelope.min)
        if (zone.max !== null)
          expect(zone.max).toBeLessThanOrEqual(envelope.max)
      }
    }
  })

  it('returns null for a band with no finite bound on one side', () => {
    const openEnded: ReferenceBand = {
      ...METRIC_GUIDANCE.cadence.band!,
      zones: [{ label: 'Anything at all', min: null, max: null }],
    }
    expect(referenceBandEnvelope(openEnded)).toBeNull()
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

  it('separates the within-runner claim from the between-runner one on cadence', () => {
    const speed = METRIC_GUIDANCE.cadence.speedSensitivity
    expect(speed?.withinRunner).not.toBeNull()
    expect(speed?.betweenRunners).not.toBeNull()
    expect(speed?.betweenRunners).toContain('NOT correlated')
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
  it('gives every metric one', () => {
    for (const entry of entries()) {
      expect(entry.captureHint.length, entry.metric).toBeGreaterThan(40)
    }
  })

  it('talks about filming, never about how the runner runs', () => {
    for (const entry of entries()) {
      expect(entry.captureHint, entry.metric).toMatch(/film/i)
    }
  })

  it('asks for the camera angle each metric actually needs', () => {
    // Cross-checked against `DEFAULT_VIEW_FIT_TABLE`, which is what really decides whether a
    // metric survives on a clip: a hint that asked for the wrong angle would send a reader away to
    // re-film a clip that still could not be measured.
    for (const entry of entries()) {
      const row = DEFAULT_VIEW_FIT_TABLE[entry.metric]
      if (row.front.fit === 'primary') {
        expect(entry.captureHint, entry.metric).toMatch(
          /in front of or behind/i,
        )
      } else {
        expect(entry.captureHint, entry.metric).toMatch(/side-on/i)
      }
    }
  })
})
