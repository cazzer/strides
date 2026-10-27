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
import { guidedGroups } from '../results/guidedGroups'
import type { GuidedEntry } from '../results/guidedGroups'
import { pastCostlySide } from '../results/guidedHeadlines'
import { METRIC_LABELS, metricTier } from '../results/metricConfidence'
import type { MetricTier } from '../results/metricConfidence'
import {
  CUE_PREFIX,
  NON_POINTS,
  NOTHING_TO_CHANGE,
  ONE_THING_LABEL,
  ONE_THING_PRIORITY,
  WHY_LINES,
  feedbackFor,
  selectOneThing,
} from './feedbackPoints'
import type { AreaFeedback, CitedLine } from './feedbackPoints'
import { FOCUS_AREAS, FOCUS_AREA_ORDER, focusAreaView } from './focusAreas'
import type { FocusAreaId, FocusAreaView } from './focusAreas'
import { METRIC_GUIDANCE } from './metricGuidance'
import type { MetricGuidance } from './types'

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
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC11283446/',
  // Non-points
  'https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf',
  'https://pubmed.ncbi.nlm.nih.gov/21316058/',
  // Cues: each metric's existing Try line, reused verbatim
  'https://ijspt.scholasticahq.com/article/90909-a-one-session-gait-retraining-protocol-with-metronome-augmentation-increases-cadence-in-novice-and-recreational-runners',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC6088121/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC3022995/',
])

const GRADING_WORDS =
  /\b(good|bad|poor|better|worse|best|worst|optimal|ideal|excessive|healthy|unhealthy|target|goal|should|correct|incorrect|normal|abnormal)\b/i

const KNEE_LIFT = /\blift\b|knees? up/i

/** The visible-word measure (design.md D4): whitespace-split, empty pieces dropped. */
function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const CUE_AREAS = FOCUS_AREA_ORDER.filter((area) => area !== 'knees')

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

describe('every feedback URL is verified and pinned', () => {
  const cueUrls = CUE_AREAS.flatMap((area) =>
    FOCUS_AREAS[area].metricIds.flatMap((id) => {
      const line = tryLineOf(id)
      return line === null ? [] : [line.url]
    }),
  )
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

  it('gives no why line where no source states one in that unit', () => {
    expect(WHY_LINES.verticalRatio).toBeUndefined()
    expect(WHY_LINES.verticalOscillation).toBeUndefined()
    expect(WHY_LINES.footStrikePattern).toBeUndefined()
    expect(WHY_LINES.swingFootLateralExcursion).toBeUndefined()
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
    ...CUE_AREAS.flatMap((area) =>
      FOCUS_AREAS[area].metricIds.flatMap((id) => {
        const line = tryLineOf(id)
        return line === null
          ? []
          : [[`cue ${id}`, line.text] as [string, string]]
      }),
    ),
  ]

  it.each(texts)('%s carries no grading word', (_, text) => {
    expect(text).not.toMatch(GRADING_WORDS)
  })
})

describe('feedbackFor', () => {
  it('reuses the headline metric’s Try line verbatim as the cue', () => {
    for (const area of FOCUS_AREA_ORDER) {
      const ids = FOCUS_AREAS[area].metricIds
      ids.forEach((id, index) => {
        const feedback = feedbackFor(
          viewOf(area, excluding(ids.slice(0, index))),
        )
        const line = tryLineOf(id)
        if (feedback.cue !== null) {
          expect(line, id).not.toBeNull()
          expect(feedback.cue).toEqual({
            metric: id,
            text: line!.text,
            url: line!.url,
          })
        }
      })
    }
  })

  it('keys the why line by the headline metric', () => {
    const rhythm = feedbackFor(viewOf('rhythm', makeHeuristics()))
    expect(rhythm.why).toBe(WHY_LINES.cadence)
    const fallback = feedbackFor(
      viewOf('rhythm', excluding(['cadence', 'verticalOscillationCm'])),
    )
    expect(fallback.why).toBeNull()
  })

  it('withholds the bounce cue at the regression anchor VO_cm 4.42 cm', () => {
    const fused = excluding(['cadence'], {
      verticalOscillationCm: makeVerticalOscillationCm({ value: 4.42 }),
    })
    const feedback = feedbackFor(viewOf('rhythm', fused))
    expect(feedback.why).toBe(WHY_LINES.verticalOscillationCm)
    expect(feedback.cue).toBeNull()
    expect(feedback.nonPoint).toBeNull()
  })

  it('shows the bounce cue inside the band', () => {
    const feedback = feedbackFor(viewOf('rhythm', excluding(['cadence'])))
    expect(feedback.cue?.metric).toBe('verticalOscillationCm')
  })

  it('shows a non-point only where there is no cue', () => {
    const landing = feedbackFor(viewOf('landing', makeHeuristics()))
    expect(landing.cue?.metric).toBe('overstriding')
    expect(landing.nonPoint).toBeNull()

    const footStrikeOnly = feedbackFor(
      viewOf('landing', excluding(['overstriding'])),
    )
    expect(footStrikeOnly.cue).toBeNull()
    expect(footStrikeOnly.why).toBeNull()
    expect(footStrikeOnly.nonPoint).toBe(NON_POINTS.footStrikePattern)

    const footPath = feedbackFor(viewOf('footPath', makeHeuristics()))
    expect(footPath.cue).toBeNull()
    expect(footPath.nonPoint).toBe(NON_POINTS.stepWidthCm)

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

  it('never shows a cue and a non-point together', () => {
    for (const area of FOCUS_AREA_ORDER) {
      const ids = FOCUS_AREAS[area].metricIds
      ids.forEach((_, index) => {
        const feedback = feedbackFor(
          viewOf(area, excluding(ids.slice(0, index))),
        )
        expect(feedback.cue !== null && feedback.nonPoint !== null, area).toBe(
          false,
        )
      })
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

  it('has a null cue for every headline and value', () => {
    for (const value of [10, 60, 90, 130, 170]) {
      for (const excluded of [[], ['kneeFlexion']] as MetricId[][]) {
        const fused = excluding(excluded, {
          kneeDrive: makeMetric('kneeDrive', { value }),
          ...(excluded.length === 0
            ? { kneeFlexion: makeMetric('kneeFlexion', { value }) }
            : {}),
        })
        expect(feedbackFor(viewOf('knees', fused)).cue).toBeNull()
      }
    }
  })

  it('stays null even if the guidance record gained a knee Try line', () => {
    const guidance: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      kneeFlexion: {
        ...METRIC_GUIDANCE.kneeFlexion,
        tryLine: {
          text: 'lift your knees',
          url: 'https://example.org/',
          direction: 'higher',
        },
      },
    }
    const views = viewsOf(makeHeuristics())
    const knees = views.find((view) => view.area === 'knees')!
    expect(feedbackFor(knees, guidance).cue).toBeNull()
    expect(
      selectOneThing(
        viewsOf(
          makeHeuristics({
            kneeFlexion: makeMetric('kneeFlexion', { value: 20 }),
          }),
        ),
        guidance,
      ),
    ).toEqual({ kind: 'nothingToChange' })
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
    '%s, worst case over every headline and its longest action',
    (area) => {
      const ids = FOCUS_AREAS[area].metricIds
      const longestNonPoint = Math.max(
        0,
        ...ids.map((id) => words(NON_POINTS[id]?.text ?? '')),
      )
      for (const id of ids) {
        const line = area === 'knees' ? null : tryLineOf(id)
        const cueWords = line === null ? 0 : words(`${CUE_PREFIX} ${line.text}`)
        const total =
          words(FOCUS_AREAS[area].label) +
          words(WHY_LINES[id]?.text ?? '') +
          Math.max(cueWords, longestNonPoint)
        expect(total, `${area} headlined by ${id}`).toBeLessThanOrEqual(25)
      }
    },
  )

  it('holds for the feedback actually produced on in-band and fallback clips', () => {
    for (const area of FOCUS_AREA_ORDER) {
      const ids = FOCUS_AREAS[area].metricIds
      ids.forEach((_, index) => {
        const feedback = feedbackFor(
          viewOf(area, excluding(ids.slice(0, index))),
        )
        expect(stopWords(area, feedback)).toBeLessThanOrEqual(25)
      })
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
    const fused = makeHeuristics({
      cadence: makeMetric('cadence', { value: 150 }),
    })
    expect(selectOneThing(viewsOf(fused))).toEqual({
      kind: 'cue',
      area: 'rhythm',
      metric: 'cadence',
      text: cadenceCue.text,
      url: cadenceCue.url,
    })
  })

  it('prefers cadence over bounce when both are past their bands', () => {
    const fused = makeHeuristics({
      cadence: makeMetric('cadence', { value: 150 }),
      verticalOscillationCm: makeVerticalOscillationCm({ value: 10.4 }),
    })
    const pick = selectOneThing(viewsOf(fused))
    expect(pick.kind === 'cue' && pick.metric).toBe('cadence')
  })

  it('picks the bounce cue when only bounce is past its band', () => {
    const fused = makeHeuristics({
      verticalOscillationCm: makeVerticalOscillationCm({ value: 10.4 }),
    })
    const pick = selectOneThing(viewsOf(fused))
    expect(pick.kind === 'cue' && pick.metric).toBe('verticalOscillationCm')
    expect(pick.kind === 'cue' && pick.area).toBe('rhythm')
  })

  it.each([153, 174])('finds nothing to change at a cadence of %s', (value) => {
    const fused = makeHeuristics({ cadence: makeMetric('cadence', { value }) })
    expect(selectOneThing(viewsOf(fused))).toEqual({ kind: 'nothingToChange' })
  })

  it('finds nothing to change when every value is inside its band', () => {
    expect(selectOneThing(viewsOf(makeHeuristics()))).toEqual({
      kind: 'nothingToChange',
    })
  })

  it('never chooses a caveated reading', () => {
    const fused = makeHeuristics({
      cadence: makeMetric('cadence', { value: 150, confidence: 0.5 }),
    })
    expect(metricTier(fused.cadence)).toBe('caveated')
    expect(selectOneThing(viewsOf(fused))).toEqual({ kind: 'nothingToChange' })
  })

  it('never chooses a withheld Try line', () => {
    const fused = makeHeuristics({
      verticalOscillationCm: makeVerticalOscillationCm({ value: 4.42 }),
    })
    expect(selectOneThing(viewsOf(fused))).toEqual({ kind: 'nothingToChange' })
  })

  it('never chooses a metric whose Try line is absent', () => {
    const guidance: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      cadence: { ...METRIC_GUIDANCE.cadence, tryLine: null },
    }
    const fused = makeHeuristics({
      cadence: makeMetric('cadence', { value: 150 }),
    })
    expect(selectOneThing(viewsOf(fused), guidance)).toEqual({
      kind: 'nothingToChange',
    })
  })

  it('never chooses unbanded overstriding, however large', () => {
    expect(METRIC_GUIDANCE.overstriding.band).toBeNull()
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

  it('never chooses an excluded metric', () => {
    const fused = makeHeuristics({
      cadence: makeMetric('cadence', { value: 150, viewFit: 'unsuitable' }),
    })
    expect(selectOneThing(viewsOf(fused))).toEqual({ kind: 'nothingToChange' })
  })

  describe('agrees with the Energy cost headline on which side is past the band', () => {
    function entryFor(fused: FormHeuristicsResult, id: MetricId): GuidedEntry {
      const entry = guidedGroups(fused).banded.find(
        (candidate) => candidate.metric.metric === id,
      )
      if (entry === undefined) throw new Error(`${id} not banded`)
      return entry
    }

    it.each([100, 150, 152.9, 153, 160, 174, 183, 184, 200])(
      'cadence %s',
      (value) => {
        const fused = makeHeuristics({
          cadence: makeMetric('cadence', { value }),
        })
        const pick = selectOneThing(viewsOf(fused))
        expect(pick.kind === 'cue' && pick.metric === 'cadence').toBe(
          pastCostlySide(entryFor(fused, 'cadence')),
        )
      },
    )

    it.each([3, 4.42, 5.99, 6, 7.5, 9.5, 9.51, 10.4, 14])(
      'verticalOscillationCm %s',
      (value) => {
        const fused = makeHeuristics({
          verticalOscillationCm: makeVerticalOscillationCm({ value }),
        })
        const pick = selectOneThing(viewsOf(fused))
        expect(
          pick.kind === 'cue' && pick.metric === 'verticalOscillationCm',
        ).toBe(pastCostlySide(entryFor(fused, 'verticalOscillationCm')))
      },
    )
  })
})
