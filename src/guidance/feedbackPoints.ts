import type { MetricId } from '../heuristics/types'
import {
  renderableBand,
  tryLineApplies,
  type GuidedEntry,
} from '../results/guidedGroups'
import { bandBounds } from './bandPosition'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from './focusAreas'
import type { FocusAreaId, FocusAreaView, FocusMetric } from './focusAreas'
import { METRIC_GUIDANCE } from './metricGuidance'
import type { MetricGuidance } from './types'

/**
 * What a tour stop says about one focus area: why the area matters, the one studied change that
 * applies to this reading, or — where the evidence says not to change — a non-point.
 *
 * Every line is cited or absent (add-runner-tour design.md D2). The quoted sentence each line rests
 * on is recorded in design.md, and every URL is pinned in `feedbackPoints.test.ts`. A line whose
 * source could not be opened and found to state it is not here at all, rather than softened into
 * something unsourced.
 */

/**
 * What kind of evidence a line rests on, so a view can say how strong the claim is:
 *
 * - `'trial'` — the quantity was deliberately changed and the outcome measured.
 * - `'association'` — runners (or runs) differing in the quantity were compared; no one changed it.
 * - `'mixed'` — a review pooling both kinds.
 */
export type EvidenceKind = 'trial' | 'association' | 'mixed'

export interface CitedLine {
  text: string
  /** Verified https URL, pinned in `FEEDBACK_VERIFIED_URLS`. */
  url: string
  evidence: EvidenceKind
}

/** The headline metric's own Try line, verbatim, where it applies to this reading. */
export interface AreaCue {
  metric: MetricId
  text: string
  url: string
}

export interface AreaFeedback {
  area: FocusAreaId
  why: CitedLine | null
  /** Never both: a stop shows a cue or a non-point, or neither. */
  cue: AreaCue | null
  nonPoint: CitedLine | null
}

const VAN_HOOREN_2024_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/'
const ARELLANO_KRAM_2014_URL =
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC4296200'
const BRAUN_2024_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11809138/'
const FOLLAND_2017_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5473370/'
const LIEBERMAN_2015_URL =
  'https://journals.biologists.com/jeb/article/218/21/3406/14416/'
const WANG_2024_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11283446/'
const ANDERSON_2020_URL =
  'https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf'
const ARELLANO_KRAM_2011_URL = 'https://pubmed.ncbi.nlm.nih.gov/21316058/'

const KNEE_BEND_WHY: CitedLine = {
  text: 'More swing-leg knee and hip bend went with higher energy cost.',
  url: FOLLAND_2017_URL,
  evidence: 'association',
}

const STEP_WIDTH_WHY: CitedLine = {
  text: 'Narrower steps go with higher IT-band strain.',
  url: WANG_2024_URL,
  evidence: 'mixed',
}

const STEP_WIDTH_NON_POINT: CitedLine = {
  text: 'Your own width is usually your most economical.',
  url: ARELLANO_KRAM_2011_URL,
  evidence: 'trial',
}

/**
 * Why an area matters, keyed by the metric that headlines it. Absent where no source states a why
 * in the unit that metric reports: `verticalRatio` and the torso-normalised `verticalOscillation`
 * (Van Hooren's only normalised bounce row is not significant), `footStrikePattern` (its stop
 * carries a non-point instead) and `swingFootLateralExcursion`.
 */
export const WHY_LINES: Partial<Record<MetricId, CitedLine>> = {
  cadence: {
    text: 'Higher cadence goes with slightly lower energy cost.',
    url: VAN_HOOREN_2024_URL,
    evidence: 'association',
  },
  verticalOscillationCm: {
    text: 'Less bounce goes with lower energy cost.',
    url: VAN_HOOREN_2024_URL,
    evidence: 'association',
  },
  armSwingAmplitude: {
    text: 'Running with arms held still raised energy cost 3–13%.',
    url: ARELLANO_KRAM_2014_URL,
    evidence: 'trial',
  },
  trunkLean: {
    text: 'More forward lean moves load from the knee to the hip.',
    url: BRAUN_2024_URL,
    evidence: 'trial',
  },
  kneeFlexion: KNEE_BEND_WHY,
  kneeDrive: KNEE_BEND_WHY,
  overstriding: {
    text: 'Overstriding goes with harder braking.',
    url: LIEBERMAN_2015_URL,
    evidence: 'association',
  },
  stepWidthCm: STEP_WIDTH_WHY,
  stepWidth: STEP_WIDTH_WHY,
}

/** Where the evidence says not to change what this metric measures. */
export const NON_POINTS: Partial<Record<MetricId, CitedLine>> = {
  footStrikePattern: {
    text: "Most distance runners land heel-first; changing it isn't recommended for uninjured runners.",
    url: ANDERSON_2020_URL,
    evidence: 'mixed',
  },
  stepWidthCm: STEP_WIDTH_NON_POINT,
  stepWidth: STEP_WIDTH_NON_POINT,
}

/** Rendered before a cue's text, which starts mid-sentence. */
export const CUE_PREFIX = 'If you choose:'
export const ONE_THING_LABEL = 'Your one thing'
export const NOTHING_TO_CHANGE = 'Nothing here calls for a change.'

/**
 * Areas that never carry a cue, whatever the guidance record gains later. Folland 2017 found more
 * swing-leg knee and hip bend went with a higher energy cost, so "lift your knees" is never said.
 */
const NO_CUE_AREAS: ReadonlySet<FocusAreaId> = new Set(['knees'])

/**
 * The order `selectOneThing` walks: the studied changes with the strongest evidence first (step
 * rate, then overstriding, which the same step-rate change moves, then bounce), then every other
 * metric in tour order.
 */
export const ONE_THING_PRIORITY: readonly MetricId[] = (() => {
  const first: MetricId[] = [
    'cadence',
    'overstriding',
    'verticalOscillationCm',
    'verticalOscillation',
  ]
  const rest = FOCUS_AREA_ORDER.flatMap((area) => FOCUS_AREAS[area].metricIds)
  return [...first, ...rest.filter((id) => !first.includes(id))]
})()

function guidedEntry(
  focus: FocusMetric,
  guidance: Record<MetricId, MetricGuidance>,
): GuidedEntry {
  const metricGuidance = guidance[focus.metric.metric]
  return {
    metric: focus.metric,
    guidance: metricGuidance,
    band: renderableBand(metricGuidance),
  }
}

function cueFor(
  area: FocusAreaId,
  focus: FocusMetric,
  guidance: Record<MetricId, MetricGuidance>,
): AreaCue | null {
  if (NO_CUE_AREAS.has(area)) return null
  const entry = guidedEntry(focus, guidance)
  const { tryLine } = entry.guidance
  if (tryLine === null || !tryLineApplies(entry)) return null
  return { metric: focus.metric.metric, text: tryLine.text, url: tryLine.url }
}

export function feedbackFor(
  view: FocusAreaView,
  guidance: Record<MetricId, MetricGuidance> = METRIC_GUIDANCE,
): AreaFeedback {
  const { area, headline } = view
  if (headline === null) {
    return { area, why: null, cue: null, nonPoint: null }
  }
  const why = WHY_LINES[headline.metric.metric] ?? null
  const cue = cueFor(area, headline, guidance)
  const nonPoint =
    cue === null
      ? ([headline, ...view.supporting]
          .map((focus) => NON_POINTS[focus.metric.metric])
          .find((line) => line !== undefined) ?? null)
      : null
  return { area, why, cue, nonPoint }
}

export type OneThing =
  | {
      kind: 'cue'
      area: FocusAreaId
      metric: MetricId
      text: string
      url: string
    }
  | { kind: 'nothingToChange' }

/**
 * Whether a reading is past its cited band on the side its studied change moves away from — the
 * same threshold as the Energy cost headline (`pastCostlySide`, `src/results/guidedHeadlines.ts`):
 * strictly beyond the outermost FINITE bound, so cadence's open-ended `<153` zone counts as beyond
 * while a value exactly on a bound does not. A metric with no renderable band is never past it.
 */
function pastBandAwayFromCue(entry: GuidedEntry): boolean {
  const { tryLine } = entry.guidance
  const { band } = entry
  const value = entry.metric.value
  if (tryLine === null || band === null || value === null) return false
  const bounds = bandBounds(band)
  if (bounds.length === 0) return false
  return tryLine.direction === 'higher'
    ? value < bounds[0]
    : value > bounds[bounds.length - 1]
}

/**
 * At most one cue for the whole tour: the first metric in `ONE_THING_PRIORITY` that is measured at
 * the normal tier, whose Try line applies, and whose value lies beyond its cited band on the side
 * that line moves away from. Never a value inside its band, never an unbanded metric (so
 * overstriding stays dormant until it has a band), never a caveated reading.
 */
export function selectOneThing(
  areas: readonly FocusAreaView[],
  guidance: Record<MetricId, MetricGuidance> = METRIC_GUIDANCE,
): OneThing {
  const measured = new Map<
    MetricId,
    { area: FocusAreaId; focus: FocusMetric }
  >()
  for (const view of areas) {
    if (NO_CUE_AREAS.has(view.area)) continue
    const focuses =
      view.headline === null ? [] : [view.headline, ...view.supporting]
    for (const focus of focuses) {
      measured.set(focus.metric.metric, { area: view.area, focus })
    }
  }
  for (const id of ONE_THING_PRIORITY) {
    const found = measured.get(id)
    if (found === undefined || found.focus.tier !== 'normal') continue
    const entry = guidedEntry(found.focus, guidance)
    const { tryLine } = entry.guidance
    if (tryLine === null || !tryLineApplies(entry)) continue
    if (!pastBandAwayFromCue(entry)) continue
    return {
      kind: 'cue',
      area: found.area,
      metric: id,
      text: tryLine.text,
      url: tryLine.url,
    }
  }
  return { kind: 'nothingToChange' }
}
