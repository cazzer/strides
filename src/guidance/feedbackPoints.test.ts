import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillation,
  makeVerticalOscillationCm,
} from '../results/__fixtures__/metricResult'
import { METRIC_LABELS, metricTier } from '../results/metricConfidence'
import { pastCostlySide, renderableBand } from './bandApplicability'
import {
  CUE_PREFIX,
  NON_POINTS,
  NOTHING_TO_CHANGE,
  ONE_THING_LABEL,
  ONE_THING_UNCLEAR,
  ONE_THING_PRIORITY,
  WHY_LINES,
  feedbackFor,
  selectOneThing,
} from './feedbackPoints'
import type { AreaFeedback, CitedLine } from './feedbackPoints'
import { FOCUS_AREAS, FOCUS_AREA_ORDER, focusAreaView } from './focusAreas'
import type { FocusAreaId, FocusAreaView } from './focusAreas'
import { METRIC_GUIDANCE } from './metricGuidance'
import type { MetricGuidance, MetricTier } from './types'

/**
 * Every URL a why line, cue or non-point may cite. **Closed**: a URL not in this set cannot ship in
 * a feedback line without this file failing. Each member was opened on 2026-10-27 and found to
 * state the line that cites it; the quoted sentence is in add-runner-tour design.md. Each member
 * must also appear in docs/prd/runner-led-results-research.md or among METRIC_GUIDANCE's own URLs.
 */
const FEEDBACK_VERIFIED_URLS: ReadonlySet<string> = new Set([
  // Why lines
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/',
  'https://journals.biologists.com/jeb/article/218/21/3406/14416/',
  // Non-points
  'https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf',
  'https://pubmed.ncbi.nlm.nih.gov/21316058/',
  // Cues: each cue-capable metric's existing Try line, reused verbatim
  'https://ijspt.scholasticahq.com/article/90909-a-one-session-gait-retraining-protocol-with-metronome-augmentation-increases-cadence-in-novice-and-recreational-runners',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/',
])

const GRADING_WORDS =
  /\b(good|bad|poor|better|worse|best|worst|optimal|ideal|excessive|healthy|unhealthy|target|goal|should|correct|incorrect|normal|abnormal)\b/i

const KNEE_LIFT = /\blift\b|knees? up/i

/** The visible-word measure (design.md D4): whitespace-split, empty pieces dropped. */
function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function tryLineOf(id: MetricId) {
  return METRIC_GUIDANCE[id].tryLine
}

function tiersOf(fused: FormHeuristicsResult): Record<MetricId, MetricTier> {
  return Object.fromEntries(
    (Object.keys(METRIC_LABELS) as MetricId[]).map((id) => [
      id,
      metricTier(fused[id]),
    ]),
  ) as Record<MetricId, MetricTier>
}

function viewsOf(fused: FormHeuristicsResult): FocusAreaView[] {
  const tiers = tiersOf(fused)
  return FOCUS_AREA_ORDER.map((area) => focusAreaView(area, fused, tiers))
}

function viewOf(area: FocusAreaId, fused: FormHeuristicsResult): FocusAreaView {
  return focusAreaView(area, fused, tiersOf(fused))
}

/** A heuristics result with these metrics not measured (value null → excluded). */
function excluding(
  ids: readonly MetricId[],
  extra: Partial<FormHeuristicsResult> = {},
): FormHeuristicsResult {
  const nulls: Partial<FormHeuristicsResult> = {}
  for (const id of ids) {
    Object.assign(nulls, {
      [id]: makeMetric(id, { value: null, confidence: 0 }),
    })
  }
  return makeHeuristics({ ...nulls, ...extra })
}

const cadence = (value: number, confidence?: number) =>
  makeMetric('cadence', {
    value,
    ...(confidence === undefined ? {} : { confidence }),
  })
const bounce = (value: number | null) => makeVerticalOscillationCm({ value })

function allLines(): Array<[string, CitedLine]> {
  return [
    ...Object.entries(WHY_LINES).map(
      ([id, line]) => [`why ${id}`, line] as [string, CitedLine],
    ),
    ...Object.entries(NON_POINTS).map(
      ([id, line]) => [`nonPoint ${id}`, line] as [string, CitedLine],
    ),
  ]
}

/** Every URL anywhere in METRIC_GUIDANCE (sources, links, Try lines, consequences). */
function guidanceUrls(): Set<string> {
  const found = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'url' && typeof inner === 'string') found.add(inner)
        else walk(inner)
      }
    }
  }
  walk(METRIC_GUIDANCE)
  return found
}

function researchRecordUrls(): Set<string> {
  // Resolved against this file rather than via `new URL(…, import.meta.url)`, which Vite rewrites
  // into an asset URL (docs/agent-notes/guided-results-view.md).
  const here = dirname(fileURLToPath(import.meta.url))
  const text = readFileSync(
    join(here, '../../docs/prd/runner-led-results-research.md'),
    'utf8',
  )
  return new Set(text.match(/https:\/\/[^\s)]+/g) ?? [])
}

/** Metrics whose cue can ever show: a Try line, a shown band and a costly side. */
const CUE_CAPABLE: MetricId[] = (
  Object.keys(METRIC_GUIDANCE) as MetricId[]
).filter(
  (id) =>
    METRIC_GUIDANCE[id].tryLine !== null &&
    METRIC_GUIDANCE[id].economyConsequence !== null &&
    renderableBand(METRIC_GUIDANCE[id]) !== null,
)

describe('every feedback URL is verified and pinned', () => {
  const cueUrls = CUE_CAPABLE.map((id) => tryLineOf(id)!.url)
  const usedUrls = [...allLines().map(([, line]) => line.url), ...cueUrls]

  it('cites only pinned URLs', () => {
    for (const url of usedUrls) {
      expect(FEEDBACK_VERIFIED_URLS.has(url), url).toBe(true)
    }
  })

  it('pins only https URLs', () => {
    for (const url of FEEDBACK_VERIFIED_URLS) {
      expect(url.startsWith('https://'), url).toBe(true)
    }
  })

  it('pins nothing it does not use', () => {
    for (const url of FEEDBACK_VERIFIED_URLS) {
      expect(usedUrls.includes(url), `unused: ${url}`).toBe(true)
    }
  })

  it('pins only URLs recorded in the research file or the guidance record', () => {
    const known = new Set([...researchRecordUrls(), ...guidanceUrls()])
    for (const url of FEEDBACK_VERIFIED_URLS) {
      expect(known.has(url), url).toBe(true)
    }
  })

  it('knows exactly two cue-capable metrics today', () => {
    expect(CUE_CAPABLE.sort()).toEqual(['cadence', 'verticalOscillationCm'])
  })
})

describe('why lines and non-points', () => {
  it.each(allLines())('%s is at most 14 words', (_, line) => {
    expect(words(line.text)).toBeLessThanOrEqual(14)
    expect(line.text.trim()).not.toBe('')
  })

  it('keys why lines and non-points by metrics that exist', () => {
    const ids = new Set(Object.keys(METRIC_LABELS))
    for (const id of [...Object.keys(WHY_LINES), ...Object.keys(NON_POINTS)]) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('gives no why line where no source states one, or where a non-point stands', () => {
    for (const id of [
      'verticalRatio',
      'verticalOscillation',
      'footStrikePattern',
      'stepWidth',
      'stepWidthCm',
      'swingFootLateralExcursion',
    ] as const) {
      expect(WHY_LINES[id], id).toBeUndefined()
    }
  })

  it('places non-points only on metrics with no studied change', () => {
    for (const id of Object.keys(NON_POINTS) as MetricId[]) {
      expect(tryLineOf(id), id).toBeNull()
    }
  })
})

describe('feedback never grades the runner', () => {
  const texts: Array<[string, string]> = [
    ...allLines().map(([path, line]) => [path, line.text] as [string, string]),
    ...FOCUS_AREA_ORDER.map(
      (area) => [`label ${area}`, FOCUS_AREAS[area].label] as [string, string],
    ),
    ['CUE_PREFIX', CUE_PREFIX],
    ['ONE_THING_LABEL', ONE_THING_LABEL],
    ['NOTHING_TO_CHANGE', NOTHING_TO_CHANGE],
    ...Object.entries(ONE_THING_UNCLEAR).map(
      ([reason, text]) => [`ONE_THING_UNCLEAR.${reason}`, text] as [string, string],
    ),
    ...CUE_CAPABLE.map(
      (id) => [`cue ${id}`, tryLineOf(id)!.text] as [string, string],
    ),
  ]

  it.each(texts)('%s carries no grading word', (_, text) => {
    expect(text).not.toMatch(GRADING_WORDS)
  })
})

describe('area cues', () => {
  /** Every case that MUST carry a cue; every other case below must not. */
  const withCue: Array<[string, FocusAreaId, FormHeuristicsResult, MetricId]> =
    [
      [
        'cadence 150',
        'rhythm',
        makeHeuristics({ cadence: cadence(150) }),
        'cadence',
      ],
      [
        'cadence 150 + VO_cm 10.4',
        'rhythm',
        makeHeuristics({
          cadence: cadence(150),
          verticalOscillationCm: bounce(10.4),
        }),
        'cadence',
      ],
      [
        'cadence 175 + VO_cm 10.4',
        'rhythm',
        makeHeuristics({
          cadence: cadence(175),
          verticalOscillationCm: bounce(10.4),
        }),
        'verticalOscillationCm',
      ],
      [
        'cadence excluded + VO_cm 10.4',
        'rhythm',
        excluding(['cadence'], { verticalOscillationCm: bounce(10.4) }),
        'verticalOscillationCm',
      ],
    ]

  const withoutCue: Array<[string, FormHeuristicsResult]> = [
    ['all defaults, in band', makeHeuristics()],
    ['cadence 165', makeHeuristics({ cadence: cadence(165) })],
    ['cadence 175', makeHeuristics({ cadence: cadence(175) })],
    ['cadence 153, on the bound', makeHeuristics({ cadence: cadence(153) })],
    ['cadence 150 caveated', makeHeuristics({ cadence: cadence(150, 0.5) })],
    [
      'VO_cm 4.42, cue withheld',
      makeHeuristics({ verticalOscillationCm: bounce(4.42) }),
    ],
    [
      'VO_cm 9.5, on the bound',
      makeHeuristics({ verticalOscillationCm: bounce(9.5) }),
    ],
    [
      'overstriding 10, unbanded',
      makeHeuristics({
        overstriding: makeMetric('overstriding', { value: 10 }),
      }),
    ],
    [
      'verticalOscillation 1, unbanded',
      excluding(['cadence', 'verticalOscillationCm', 'verticalRatio'], {
        verticalOscillation: makeVerticalOscillation({ value: 1 }),
      }),
    ],
    [
      'knees far out of band',
      makeHeuristics({ kneeFlexion: makeMetric('kneeFlexion', { value: 20 }) }),
    ],
  ]

  it.each(withCue)('%s: %s shows the %s cue', (_, area, fused, metric) => {
    const line = tryLineOf(metric)!
    expect(feedbackFor(viewOf(area, fused)).cue).toEqual({
      metric,
      text: line.text,
      url: line.url,
    })
  })

  it.each(withCue)('%s: no other area shows a cue', (_, area, fused) => {
    for (const other of FOCUS_AREA_ORDER.filter((id) => id !== area)) {
      expect(feedbackFor(viewOf(other, fused)).cue, other).toBeNull()
    }
  })

  it.each(withoutCue)('%s: no area shows a cue', (_, fused) => {
    for (const area of FOCUS_AREA_ORDER) {
      expect(feedbackFor(viewOf(area, fused)).cue, area).toBeNull()
    }
  })

  it('keys the why line to the cue, else to the headline', () => {
    const bounceCue = feedbackFor(
      viewOf(
        'rhythm',
        makeHeuristics({
          cadence: cadence(175),
          verticalOscillationCm: bounce(10.4),
        }),
      ),
    )
    expect(bounceCue.cue?.metric).toBe('verticalOscillationCm')
    expect(bounceCue.why).toBe(WHY_LINES.verticalOscillationCm)

    const cadenceCue = feedbackFor(
      viewOf('rhythm', makeHeuristics({ cadence: cadence(150) })),
    )
    expect(cadenceCue.why).toBe(WHY_LINES.cadence)

    const none = feedbackFor(viewOf('rhythm', makeHeuristics()))
    expect(none.cue).toBeNull()
    expect(none.why).toBe(WHY_LINES.cadence)

    const fallback = feedbackFor(
      viewOf('rhythm', excluding(['cadence', 'verticalOscillationCm'])),
    )
    expect(fallback.why).toBeNull()
  })

  it('withholds the bounce cue at the regression anchor VO_cm 4.42 cm', () => {
    const fused = excluding(['cadence'], {
      verticalOscillationCm: bounce(4.42),
    })
    const feedback = feedbackFor(viewOf('rhythm', fused))
    expect(feedback.why).toBe(WHY_LINES.verticalOscillationCm)
    expect(feedback.cue).toBeNull()
    expect(feedback.nonPoint).toBeNull()
  })
})

describe('non-points', () => {
  it('stands on landing whenever there is no cue, overstriding measured or not', () => {
    const landing = feedbackFor(viewOf('landing', makeHeuristics()))
    expect(landing.cue).toBeNull()
    expect(landing.why).toBe(WHY_LINES.overstriding)
    expect(landing.nonPoint).toBe(NON_POINTS.footStrikePattern)

    const footStrikeOnly = feedbackFor(
      viewOf('landing', excluding(['overstriding'])),
    )
    expect(footStrikeOnly.why).toBeNull()
    expect(footStrikeOnly.nonPoint).toBe(NON_POINTS.footStrikePattern)
  })

  it('stands on foot path with no why line', () => {
    const footPath = feedbackFor(viewOf('footPath', makeHeuristics()))
    expect(footPath).toEqual({
      area: 'footPath',
      why: null,
      cue: null,
      nonPoint: NON_POINTS.stepWidthCm,
    })
    const lateralOnly = feedbackFor(
      viewOf('footPath', excluding(['stepWidthCm', 'stepWidth'])),
    )
    expect(lateralOnly).toEqual({
      area: 'footPath',
      why: null,
      cue: null,
      nonPoint: null,
    })
  })

  it('never stands beside a cue', () => {
    const fused = makeHeuristics({ cadence: cadence(150) })
    for (const view of viewsOf(fused)) {
      const feedback = feedbackFor(view)
      expect(
        feedback.cue !== null && feedback.nonPoint !== null,
        view.area,
      ).toBe(false)
    }
  })

  it('says nothing for an unmeasured area', () => {
    const feedback = feedbackFor(
      viewOf('arms', excluding(['armSwingAmplitude'])),
    )
    expect(feedback).toEqual({
      area: 'arms',
      why: null,
      cue: null,
      nonPoint: null,
    })
  })
})

describe('the knees area never cues lifting the knees', () => {
  const kneeTexts = FOCUS_AREAS.knees.metricIds.flatMap((id) =>
    [WHY_LINES[id]?.text, NON_POINTS[id]?.text, tryLineOf(id)?.text].filter(
      (text): text is string => text !== undefined,
    ),
  )

  it('carries no lift wording in any line', () => {
    expect(kneeTexts.length).toBeGreaterThan(0)
    for (const text of kneeTexts) expect(text).not.toMatch(KNEE_LIFT)
  })

  it('stays cue-free even if the guidance record gained an eligible knee cue', () => {
    const guidance: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      kneeFlexion: {
        ...METRIC_GUIDANCE.kneeFlexion,
        tryLine: {
          text: 'lift your knees',
          url: 'https://example.org/',
          direction: 'higher',
        },
        economyConsequence: {
          text: 'x',
          url: 'https://example.org/',
          costlySide: 'below',
        },
      },
    }
    const fused = makeHeuristics({
      kneeFlexion: makeMetric('kneeFlexion', { value: 20 }),
    })
    const knees = viewOf('knees', fused)
    expect(feedbackFor(knees, guidance).cue).toBeNull()
    expect(selectOneThing(viewsOf(fused), 'idle', guidance)).toEqual({
      kind: 'nothingToChange',
    })
  })
})

describe('every stop stays within 25 visible words', () => {
  function stopWords(area: FocusAreaId, feedback: AreaFeedback): number {
    return (
      words(FOCUS_AREAS[area].label) +
      words(feedback.why?.text ?? '') +
      (feedback.cue !== null
        ? words(`${CUE_PREFIX} ${feedback.cue.text}`)
        : words(feedback.nonPoint?.text ?? ''))
    )
  }

  it.each(FOCUS_AREA_ORDER)(
    '%s, worst case over every cue and every headline with its longest non-point',
    (area) => {
      const ids = FOCUS_AREAS[area].metricIds
      const label = words(FOCUS_AREAS[area].label)
      const longestNonPoint = Math.max(
        0,
        ...ids.map((id) => words(NON_POINTS[id]?.text ?? '')),
      )
      for (const id of ids) {
        // Any metric with a Try line, banded or not, so a future band cannot overrun the budget.
        const line = area === 'knees' ? null : tryLineOf(id)
        if (line !== null) {
          const withCue =
            label +
            words(WHY_LINES[id]?.text ?? '') +
            words(`${CUE_PREFIX} ${line.text}`)
          expect(withCue, `${area} cued by ${id}`).toBeLessThanOrEqual(25)
        }
        const withoutCue =
          label + words(WHY_LINES[id]?.text ?? '') + longestNonPoint
        expect(withoutCue, `${area} headlined by ${id}`).toBeLessThanOrEqual(25)
      }
    },
  )

  it('holds for the feedback produced on in-band, past-band and fallback clips', () => {
    const clips = [
      makeHeuristics(),
      makeHeuristics({ cadence: cadence(150) }),
      makeHeuristics({
        cadence: cadence(175),
        verticalOscillationCm: bounce(10.4),
      }),
    ]
    for (const fused of clips) {
      for (const area of FOCUS_AREA_ORDER) {
        const ids = FOCUS_AREAS[area].metricIds
        ids.forEach((_, index) => {
          const view = focusAreaView(area, fused, {
            ...tiersOf(fused),
            ...Object.fromEntries(
              ids.slice(0, index).map((id) => [id, 'excluded']),
            ),
          })
          expect(stopWords(area, feedbackFor(view))).toBeLessThanOrEqual(25)
        })
      }
    }
  })

  it('holds for the one-thing stop with any cue, and with nothing to change', () => {
    for (const id of ONE_THING_PRIORITY) {
      const line = tryLineOf(id)
      if (line === null) continue
      expect(
        words(`${ONE_THING_LABEL} ${CUE_PREFIX} ${line.text}`),
        id,
      ).toBeLessThanOrEqual(25)
    }
    expect(
      words(`${ONE_THING_LABEL} ${NOTHING_TO_CHANGE}`),
    ).toBeLessThanOrEqual(25)
  })
})

describe('ONE_THING_UNCLEAR', () => {
  it.each(Object.entries(ONE_THING_UNCLEAR))('%s is at most 14 words, and 25 with the label', (_, text) => {
    expect(words(text)).toBeLessThanOrEqual(14)
    expect(words(`${ONE_THING_LABEL} ${text}`)).toBeLessThanOrEqual(25)
  })
})

describe('ONE_THING_PRIORITY', () => {
  it('walks step rate, overstriding, then bounce, then the rest in tour order', () => {
    expect(ONE_THING_PRIORITY).toEqual([
      'cadence',
      'overstriding',
      'verticalOscillationCm',
      'verticalOscillation',
      'verticalRatio',
      'armSwingAmplitude',
      'trunkLean',
      'kneeFlexion',
      'kneeDrive',
      'footStrikePattern',
      'stepWidthCm',
      'stepWidth',
      'swingFootLateralExcursion',
    ])
    expect([...ONE_THING_PRIORITY].sort()).toEqual(
      Object.keys(METRIC_LABELS).sort(),
    )
  })
})

describe('selectOneThing', () => {
  const cadenceCue = tryLineOf('cadence')!

  it('picks the cadence cue for a cadence of 150 at the normal tier', () => {
    expect(
      selectOneThing(viewsOf(makeHeuristics({ cadence: cadence(150) }))),
    ).toEqual({
      kind: 'cue',
      area: 'rhythm',
      metric: 'cadence',
      text: cadenceCue.text,
      url: cadenceCue.url,
    })
  })

  it('prefers cadence over bounce when both are past their bands', () => {
    const fused = makeHeuristics({
      cadence: cadence(150),
      verticalOscillationCm: bounce(10.4),
    })
    const pick = selectOneThing(viewsOf(fused))
    expect(pick.kind === 'cue' && pick.metric).toBe('cadence')
  })

  it('equals the rhythm stop’s cue at cadence 175 with VO_cm 10.4', () => {
    const fused = makeHeuristics({
      cadence: cadence(175),
      verticalOscillationCm: bounce(10.4),
    })
    const rhythmCue = feedbackFor(viewOf('rhythm', fused)).cue!
    expect(rhythmCue.metric).toBe('verticalOscillationCm')
    expect(selectOneThing(viewsOf(fused))).toEqual({
      kind: 'cue',
      area: 'rhythm',
      ...rhythmCue,
    })
  })

  it('is always one of the area cues the reader saw', () => {
    for (const fused of [
      makeHeuristics({ cadence: cadence(150) }),
      makeHeuristics({ verticalOscillationCm: bounce(14) }),
      makeHeuristics({
        cadence: cadence(100),
        verticalOscillationCm: bounce(14),
      }),
    ]) {
      const views = viewsOf(fused)
      const pick = selectOneThing(views)
      expect(pick.kind).toBe('cue')
      if (pick.kind !== 'cue') continue
      const shown = views.map((view) => feedbackFor(view).cue)
      expect(shown).toContainEqual({
        metric: pick.metric,
        text: pick.text,
        url: pick.url,
      })
    }
  })

  it.each([153, 165, 174, 175])(
    'finds nothing to change at a cadence of %s',
    (value) => {
      expect(
        selectOneThing(viewsOf(makeHeuristics({ cadence: cadence(value) }))),
      ).toEqual({
        kind: 'nothingToChange',
      })
    },
  )

  it('finds nothing to change when every value is inside its band', () => {
    expect(selectOneThing(viewsOf(makeHeuristics()))).toEqual({
      kind: 'nothingToChange',
    })
  })

  it('finds nothing to change past a withheld Try line', () => {
    expect(
      selectOneThing(
        viewsOf(makeHeuristics({ verticalOscillationCm: bounce(4.42) })),
      ),
    ).toEqual({ kind: 'nothingToChange' })
  })

  it('never chooses unbanded overstriding or verticalOscillation, however large', () => {
    expect(METRIC_GUIDANCE.overstriding.band).toBeNull()
    expect(METRIC_GUIDANCE.verticalOscillation.band).toBeNull()
    for (const value of [0.01, 0.5, 2, 10]) {
      const fused = makeHeuristics({
        overstriding: makeMetric('overstriding', { value }),
        verticalOscillation: makeVerticalOscillation({ value }),
      })
      expect(selectOneThing(viewsOf(fused))).toEqual({
        kind: 'nothingToChange',
      })
    }
  })

  it('never chooses a metric whose Try line is absent', () => {
    const guidance: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      cadence: { ...METRIC_GUIDANCE.cadence, tryLine: null },
    }
    const pick = selectOneThing(
      viewsOf(makeHeuristics({ cadence: cadence(150) })),
      'idle',
      guidance,
    )
    expect(pick).toEqual({ kind: 'nothingToChange' })
  })

  describe('says why it cannot tell', () => {
    it('caveated: a past-band reading below the normal tier', () => {
      const fused = makeHeuristics({ cadence: cadence(150, 0.5) })
      expect(metricTier(fused.cadence)).toBe('caveated')
      expect(selectOneThing(viewsOf(fused))).toEqual({
        kind: 'unclear',
        reason: 'caveated',
      })
    })

    it('caveated: an in-band reading below the normal tier', () => {
      const fused = makeHeuristics({ cadence: cadence(170, 0.5) })
      expect(selectOneThing(viewsOf(fused))).toEqual({
        kind: 'unclear',
        reason: 'caveated',
      })
    })

    it.each(['pending', 'running'] as const)(
      'pending: VO_cm is null while the scale pass is %s',
      (status) => {
        const fused = makeHeuristics({ verticalOscillationCm: bounce(null) })
        expect(selectOneThing(viewsOf(fused), status)).toEqual({
          kind: 'unclear',
          reason: 'pending',
        })
      },
    )

    it.each(['idle', 'done', 'failed', 'skipped'] as const)(
      'unmeasured: VO_cm is null and the scale pass is %s',
      (status) => {
        const fused = makeHeuristics({ verticalOscillationCm: bounce(null) })
        expect(selectOneThing(viewsOf(fused), status)).toEqual({
          kind: 'unclear',
          reason: 'unmeasured',
        })
      },
    )

    it('unmeasured: cadence excluded by an unsuitable view', () => {
      const fused = makeHeuristics({
        cadence: makeMetric('cadence', { value: 150, viewFit: 'unsuitable' }),
      })
      expect(selectOneThing(viewsOf(fused))).toEqual({
        kind: 'unclear',
        reason: 'unmeasured',
      })
    })

    it('unmeasured: a cue-capable metric missing from the areas passed', () => {
      const views = viewsOf(makeHeuristics()).filter(
        (view) => view.area !== 'rhythm',
      )
      expect(selectOneThing(views)).toEqual({
        kind: 'unclear',
        reason: 'unmeasured',
      })
    })

    it('a cue still wins over any unclear reason', () => {
      const fused = makeHeuristics({
        cadence: cadence(150),
        verticalOscillationCm: bounce(null),
      })
      expect(selectOneThing(viewsOf(fused), 'running').kind).toBe('cue')
    })
  })

  describe('agrees with the Energy cost headline on which side is past the band', () => {
    function entryFor(fused: FormHeuristicsResult, id: MetricId) {
      return {
        metric: fused[id],
        guidance: METRIC_GUIDANCE[id],
        band: renderableBand(METRIC_GUIDANCE[id]),
      }
    }

    it.each([100, 150, 152.9, 153, 160, 174, 183, 184, 200])(
      'cadence %s',
      (value) => {
        const fused = makeHeuristics({ cadence: cadence(value) })
        const pick = selectOneThing(viewsOf(fused))
        expect(pick.kind === 'cue' && pick.metric === 'cadence').toBe(
          pastCostlySide(entryFor(fused, 'cadence')),
        )
      },
    )

    it.each([3, 4.42, 5.99, 6, 7.5, 9.5, 9.51, 10.4, 14])(
      'verticalOscillationCm %s',
      (value) => {
        const fused = makeHeuristics({ verticalOscillationCm: bounce(value) })
        const pick = selectOneThing(viewsOf(fused))
        expect(
          pick.kind === 'cue' && pick.metric === 'verticalOscillationCm',
        ).toBe(pastCostlySide(entryFor(fused, 'verticalOscillationCm')))
      },
    )
  })
})
