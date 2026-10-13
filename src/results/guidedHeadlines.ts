import type { MetricId } from '../heuristics/types'
import { bandBounds } from '../guidance/bandPosition'
import { formatBandValue } from '../guidance/formatBandValue'
import type { MetricGuidance } from '../guidance/types'
import { renderableBand } from './guidedGroups'
import type { GuidedEntry, GuidedGroups } from './guidedGroups'
import { metricTier } from './metricConfidence'
import type { ScalePassStatus } from './types'

/**
 * Which readings earn a headline in the guided view's "Energy cost" section, and what the section
 * says about each story that does not (narrative-metric-headlines design.md).
 *
 * - **Two stories, each with ONE fixed spokesman and no fallback** (D5). Step rate speaks through
 *   `cadence`; bounce through `verticalOscillationCm`. Their members are named here for the record
 *   and never speak instead: neither carries an `economyConsequence` (`verticalOscillation` is
 *   normalised to torso length, a unit no economy row reports), and a fallback would let a clip's
 *   missing measurement change which claim is made.
 * - **A spokesman headlines only from the banded group, at the `'normal'` tier** (D7, review round
 *   1), only where its guidance carries an `economyConsequence`, and only where its value lies
 *   strictly beyond the band's outermost finite bound on that consequence's `costlySide` (D4). A
 *   caveated reading past that point is reported as such and sent to its card, not headlined.
 * - **Order is the spokesman's `displayRank`**, never the size of the reading (D6).
 */

export type HeadlineStory = 'stepRate' | 'bounce'

export interface StorySpokesman {
  story: HeadlineStory
  spokesman: MetricId
  /** Metrics telling the same story. They never speak for it; they stay where they are below. */
  members: readonly MetricId[]
  /** How the section names the story to a reader. */
  name: string
}

export const STORY_SPOKESMEN: readonly StorySpokesman[] = [
  {
    story: 'stepRate',
    spokesman: 'cadence',
    members: ['overstriding'],
    name: 'step rate',
  },
  {
    story: 'bounce',
    spokesman: 'verticalOscillationCm',
    members: ['verticalOscillation', 'verticalRatio'],
    name: 'bounce in centimetres',
  },
]

/**
 * Where one story stands on this clip:
 *
 * - `'headline'` — normal tier, past the costly-side bound: a headline renders.
 * - `'inside'` — measured against its band and not past that bound.
 * - `'caveated-past'` — past the bound, but at the caveated tier: no headline; one line sends the
 *   reader to its card.
 * - `'unmeasured'` — not measured on this clip.
 * - `'pending'` — not measured YET: a scale-pass metric while that pass is still running.
 * - `'unbanded'` — measured, but with no band the page shows (withheld provenance) or no economy
 *   consequence, so there is nothing to place it against.
 */
export type StoryStatus =
  | 'headline'
  | 'inside'
  | 'caveated-past'
  | 'unmeasured'
  | 'pending'
  | 'unbanded'

export interface StoryOutcome {
  story: HeadlineStory
  name: string
  status: StoryStatus
  /** The spokesman's entry from whichever group it landed in. */
  entry: GuidedEntry
  /** The trigger as a position (`costlyThreshold`), or `null` where no shown band states one. */
  threshold: string | null
}

/** A headline: the story, its spokesman's banded entry, and that entry's consequence. */
export interface GuidedHeadlineStory {
  story: HeadlineStory
  entry: GuidedEntry
  consequence: NonNullable<MetricGuidance['economyConsequence']>
}

export interface HeadlineSelection {
  headlines: GuidedHeadlineStory[]
  /** Every story, in `displayRank` order of its spokesman, with its status. */
  stories: StoryOutcome[]
}

/**
 * Whether the entry's value lies strictly beyond its band's outermost finite bound on the side its
 * economy consequence names as costly. `false` with no consequence, no band or no value. Says
 * nothing about tier; `selectHeadlines` applies that.
 *
 * "Strictly beyond the outermost FINITE bound" rather than "outside the band": cadence's lowest
 * zone is Garmin's open-ended `<153`, so a cadence of 150 is inside the band and still past its
 * lowest published bound. A value exactly on the bound does not trigger.
 */
export function pastCostlySide(entry: GuidedEntry): boolean {
  const consequence = entry.guidance.economyConsequence
  const { band } = entry
  const value = entry.metric.value
  if (consequence === null || band === null || value === null) return false
  const bounds = bandBounds(band)
  if (bounds.length === 0) return false
  return consequence.costlySide === 'below'
    ? value < bounds[0]
    : value > bounds[bounds.length - 1]
}

/**
 * The trigger stated as a position — `below the 5th percentile of Garmin's table`, `above 9.5 cm` —
 * from the guidance's PROVENANCE-CHECKED band (`renderableBand`), so the section never names a
 * position against a band the page withholds. Where the costly side's outermost zone is
 * open-ended, its label names the position; otherwise the bound itself does. `null` without a
 * consequence or a shown band.
 */
export function costlyThreshold(guidance: MetricGuidance): string | null {
  const consequence = guidance.economyConsequence
  const band = renderableBand(guidance)
  if (consequence === null || band === null) return null
  const bounds = bandBounds(band)
  if (bounds.length === 0) return null
  const below = consequence.costlySide === 'below'
  const bound = below ? bounds[0] : bounds[bounds.length - 1]
  const openZone = band.zones.find((zone) =>
    below
      ? zone.min === null && zone.max === bound
      : zone.max === null && zone.min === bound,
  )
  if (openZone === undefined) {
    return `${consequence.costlySide} ${formatBandValue(bound, band.unit)}`
  }
  const owner = band.zoneOwner === null ? '' : ` ${band.zoneOwner}`
  return `${openZone.label.charAt(0).toLowerCase()}${openZone.label.slice(1)}${owner}`
}

/** Grafted from the background scale pass, so "not measured" may mean "not measured yet". */
const SCALE_PASS_METRICS: ReadonlySet<MetricId> = new Set([
  'verticalOscillationCm',
  'stepWidthCm',
])

function storyStatus(
  entry: GuidedEntry,
  group: keyof GuidedGroups,
  scalePassStatus: ScalePassStatus,
): StoryStatus {
  if (group === 'notMeasured') {
    const stillMeasuring =
      (scalePassStatus === 'pending' || scalePassStatus === 'running') &&
      SCALE_PASS_METRICS.has(entry.metric.metric) &&
      entry.metric.value === null
    return stillMeasuring ? 'pending' : 'unmeasured'
  }
  if (group === 'unbanded' || entry.guidance.economyConsequence === null) {
    return 'unbanded'
  }
  if (!pastCostlySide(entry)) return 'inside'
  return metricTier(entry.metric) === 'normal' ? 'headline' : 'caveated-past'
}

export function selectHeadlines(
  groups: GuidedGroups,
  scalePassStatus: ScalePassStatus = 'idle',
): HeadlineSelection {
  const located = new Map<MetricId, { entry: GuidedEntry; group: keyof GuidedGroups }>()
  for (const group of ['banded', 'unbanded', 'notMeasured'] as const) {
    for (const entry of groups[group]) {
      located.set(entry.metric.metric, { entry, group })
    }
  }
  const stories: StoryOutcome[] = []
  for (const { story, spokesman, name } of STORY_SPOKESMEN) {
    const found = located.get(spokesman)
    if (found === undefined) continue
    stories.push({
      story,
      name,
      status: storyStatus(found.entry, found.group, scalePassStatus),
      entry: found.entry,
      threshold: costlyThreshold(found.entry.guidance),
    })
  }
  stories.sort(
    (a, b) => a.entry.guidance.displayRank - b.entry.guidance.displayRank,
  )
  const headlines = stories
    .filter((outcome) => outcome.status === 'headline')
    .map(({ story, entry }) => ({
      story,
      entry,
      consequence: entry.guidance.economyConsequence!,
    }))
  return { headlines, stories }
}
