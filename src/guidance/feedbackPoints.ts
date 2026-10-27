import type { MetricId } from '../heuristics/types'
import {
  pastCostlySide,
  renderableBand,
  tryLineApplies,
} from './bandApplicability'
import type { GuidedEntry } from './bandApplicability'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from './focusAreas'
import type { FocusAreaId, FocusAreaView, FocusMetric } from './focusAreas'
import { METRIC_GUIDANCE } from './metricGuidance'
import type { MetricGuidance, ScalePassStatus } from './types'

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

/** An eligible metric's own Try line, verbatim. */
export interface AreaCue {
  metric: MetricId
  text: string
  url: string
}

export interface AreaFeedback {
  area: FocusAreaId
  /** Keyed to the cue's metric when there is a cue, else to the headline metric. */
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
const ANDERSON_2020_URL =
  'https://www.theinjuryclinic.com.au/wp-content/uploads/2021/06/Anderson2020_Article_WhatAreTheBenefitsAndRisksAsso.pdf'
const ARELLANO_KRAM_2011_URL = 'https://pubmed.ncbi.nlm.nih.gov/21316058/'

const KNEE_BEND_WHY: CitedLine = {
  text: 'Runners with more swing-leg hip and knee bend used more energy, not less.',
  url: FOLLAND_2017_URL,
  evidence: 'association',
}

const STEP_WIDTH_NON_POINT: CitedLine = {
  text: 'Runners pushed off their own width used 3–15% more energy.',
  url: ARELLANO_KRAM_2011_URL,
  evidence: 'trial',
}

/**
 * Why an area matters, keyed by metric. Absent where no source states a why in the unit that metric
 * reports: `verticalRatio` and the torso-normalised `verticalOscillation` (Van Hooren's only
 * normalised bounce row is not significant), `footStrikePattern` and the step-width pair (their
 * stops carry a non-point instead) and `swingFootLateralExcursion`.
 */
export const WHY_LINES: Partial<Record<MetricId, CitedLine>> = {
  cadence: {
    text: 'Quicker-stepping runners use slightly less energy, on average.',
    url: VAN_HOOREN_2024_URL,
    evidence: 'association',
  },
  verticalOscillationCm: {
    text: 'Less-bouncy runners tend to use less energy.',
    url: VAN_HOOREN_2024_URL,
    evidence: 'association',
  },
  armSwingAmplitude: {
    text: 'Running with arms held still took 3–13% more energy.',
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
}

/** Where the evidence says not to change what this metric measures. */
export const NON_POINTS: Partial<Record<MetricId, CitedLine>> = {
  footStrikePattern: {
    text: "Most distance runners land heel-first; switching isn't recommended for uninjured heel-strikers.",
    url: ANDERSON_2020_URL,
    evidence: 'mixed',
  },
  stepWidthCm: STEP_WIDTH_NON_POINT,
  stepWidth: STEP_WIDTH_NON_POINT,
}

/** Rendered before a cue's text, which starts mid-sentence. */
export const CUE_PREFIX = 'One studied option:'
export const ONE_THING_LABEL = 'One thing to try'
export const NOTHING_TO_CHANGE = 'Nothing here calls for a change.'

/**
 * Areas that never carry a cue, whatever the guidance record gains later. Folland 2017 found more
 * swing-leg knee and hip bend went with a higher energy cost, so "lift your knees" is never said.
 */
const NO_CUE_AREAS: ReadonlySet<FocusAreaId> = new Set(['knees'])

/** Grafted from the background scale pass, so "not measured" may mean "not measured yet". */
const SCALE_PASS_METRICS: ReadonlySet<MetricId> = new Set([
  'verticalOscillationCm',
  'stepWidthCm',
])

/**
 * The order cues are chosen in, within an area and across the tour: the studied changes with the
 * strongest evidence first (step rate, then overstriding, which the same step-rate change moves,
 * then bounce), then every other metric in tour order.
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

type Guidance = Record<MetricId, MetricGuidance>

function guidedEntry(focus: FocusMetric, guidance: Guidance): GuidedEntry {
  const metricGuidance = guidance[focus.metric.metric]
  return {
    metric: focus.metric,
    guidance: metricGuidance,
    band: renderableBand(metricGuidance),
  }
}

/**
 * A metric whose cue could ever be shown: it has a Try line, a renderable cited band and an economy
 * consequence naming its costly side. Today exactly `cadence` and `verticalOscillationCm`.
 */
function cueCapable(id: MetricId, guidance: Guidance): boolean {
  const entry = guidance[id]
  return (
    entry.tryLine !== null &&
    entry.economyConsequence !== null &&
    renderableBand(entry) !== null
  )
}

/**
 * Whether this reading earns its Try line as a cue (design.md D3): normal tier, the Try line applies,
 * the band is renderable, and the value is strictly past the band's outermost finite bound on the
 * costly side — the Energy cost headline's own threshold. Never an unbanded metric, never a value
 * within the band's finite bounds.
 */
function cueEligible(focus: FocusMetric, guidance: Guidance): boolean {
  if (focus.tier !== 'normal') return false
  const entry = guidedEntry(focus, guidance)
  if (entry.guidance.tryLine === null || entry.band === null) return false
  return tryLineApplies(entry) && pastCostlySide(entry)
}

function measuredIn(view: FocusAreaView): FocusMetric[] {
  return view.headline === null ? [] : [view.headline, ...view.supporting]
}

function areaCue(view: FocusAreaView, guidance: Guidance): AreaCue | null {
  if (NO_CUE_AREAS.has(view.area)) return null
  const measured = measuredIn(view)
  for (const id of ONE_THING_PRIORITY) {
    const focus = measured.find((candidate) => candidate.metric.metric === id)
    if (focus === undefined || !cueEligible(focus, guidance)) continue
    const tryLine = guidance[id].tryLine!
    return { metric: id, text: tryLine.text, url: tryLine.url }
  }
  return null
}

export function feedbackFor(
  view: FocusAreaView,
  guidance: Guidance = METRIC_GUIDANCE,
): AreaFeedback {
  const { area, headline } = view
  if (headline === null) {
    return { area, why: null, cue: null, nonPoint: null }
  }
  const cue = areaCue(view, guidance)
  const why = WHY_LINES[cue?.metric ?? headline.metric.metric] ?? null
  const nonPoint =
    cue === null
      ? (measuredIn(view)
          .map((focus) => NON_POINTS[focus.metric.metric])
          .find((line) => line !== undefined) ?? null)
      : null
  return { area, why, cue, nonPoint }
}

/** Why the one-thing stop cannot say either "this one" or "nothing here calls for a change". */
export type OneThingUnclearReason = 'caveated' | 'pending' | 'unmeasured'

export type OneThing =
  | {
      kind: 'cue'
      area: FocusAreaId
      metric: MetricId
      text: string
      url: string
    }
  | { kind: 'nothingToChange' }
  | { kind: 'unclear'; reason: OneThingUnclearReason }

/**
 * At most one cue for the whole tour: the first eligible metric across all areas in
 * `ONE_THING_PRIORITY` order — so always one of the area cues the reader already saw.
 *
 * With none eligible, "nothing to change" is claimed only when every cue-capable metric was
 * measured at the normal tier. Otherwise the answer is unclear, and says why, in this order:
 * `'caveated'` (a cue-capable reading is measured but not at the normal tier), `'pending'` (a
 * scale-pass metric is not measured yet while that pass is pending or running), `'unmeasured'`.
 */
export function selectOneThing(
  areas: readonly FocusAreaView[],
  scalePassStatus: ScalePassStatus = 'idle',
  guidance: Guidance = METRIC_GUIDANCE,
): OneThing {
  const cues = new Map<MetricId, { area: FocusAreaId; cue: AreaCue }>()
  for (const view of areas) {
    const cue = areaCue(view, guidance)
    if (cue !== null) cues.set(cue.metric, { area: view.area, cue })
  }
  for (const id of ONE_THING_PRIORITY) {
    const found = cues.get(id)
    if (found === undefined) continue
    return { kind: 'cue', area: found.area, ...found.cue }
  }

  const scalePassRunning =
    scalePassStatus === 'pending' || scalePassStatus === 'running'
  const reasons = new Set<OneThingUnclearReason>()
  const seen = new Set<MetricId>()
  for (const view of areas) {
    if (NO_CUE_AREAS.has(view.area)) continue
    for (const focus of [...measuredIn(view), ...view.excluded]) {
      const id = focus.metric.metric
      if (!cueCapable(id, guidance)) continue
      seen.add(id)
      if (focus.tier === 'caveated') reasons.add('caveated')
      else if (focus.tier === 'excluded') {
        const stillMeasuring =
          scalePassRunning &&
          SCALE_PASS_METRICS.has(id) &&
          focus.metric.value === null
        reasons.add(stillMeasuring ? 'pending' : 'unmeasured')
      }
    }
  }
  const missing = FOCUS_AREA_ORDER.filter((area) => !NO_CUE_AREAS.has(area))
    .flatMap((area) => FOCUS_AREAS[area].metricIds)
    .some((id) => cueCapable(id, guidance) && !seen.has(id))
  if (missing) reasons.add('unmeasured')

  for (const reason of ['caveated', 'pending', 'unmeasured'] as const) {
    if (reasons.has(reason)) return { kind: 'unclear', reason }
  }
  return { kind: 'nothingToChange' }
}
