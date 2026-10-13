import type { MetricId } from '../heuristics/types'
import { bandBounds } from '../guidance/bandPosition'
import { formatBandValue } from '../guidance/formatBandValue'
import type { MetricGuidance } from '../guidance/types'
import type { GuidedEntry, GuidedGroups } from './guidedGroups'

/**
 * Which readings earn a headline in the guided view's "Running economy" section, and in what order.
 *
 * Pure, so the rule a test pins is the rule the view renders (narrative-metric-headlines design.md).
 *
 * - **Two stories, each with ONE fixed spokesman and no fallback** (D5). Step rate speaks through
 *   `cadence`; bounce through `verticalOscillationCm`. Their members are named here for the record
 *   and the bounce headline's link, and never speak instead: neither carries an
 *   `economyConsequence` (`verticalOscillation` is normalised to torso length, a unit no economy
 *   row reports), and a fallback would let a clip's missing measurement change which claim is made.
 * - **A spokesman triggers only from the banded group** (D7), only where its guidance carries an
 *   `economyConsequence`, and only where its value lies strictly beyond the band's outermost finite
 *   bound on that consequence's `costlySide` (D4).
 * - **Order is the spokesman's `displayRank`**, never the size of the reading or its distance from
 *   the band (D8).
 */

export type HeadlineStory = 'stepRate' | 'bounce'

export interface StorySpokesman {
  story: HeadlineStory
  spokesman: MetricId
  /** Metrics telling the same story. They never speak for it; they stay where they are below. */
  members: readonly MetricId[]
}

export const STORY_SPOKESMEN: readonly StorySpokesman[] = [
  { story: 'stepRate', spokesman: 'cadence', members: ['overstriding'] },
  {
    story: 'bounce',
    spokesman: 'verticalOscillationCm',
    members: ['verticalOscillation', 'verticalRatio'],
  },
]

/** A headline: the story, its spokesman's entry from the banded group, and that entry's consequence. */
export interface GuidedHeadlineStory {
  story: HeadlineStory
  entry: GuidedEntry
  consequence: NonNullable<MetricGuidance['economyConsequence']>
}

export interface HeadlineSelection {
  headlines: GuidedHeadlineStory[]
  /** Spokesmen in the not-measured group, in `displayRank` order — the empty state names them. */
  unmeasured: MetricId[]
}

/**
 * Whether the entry's value lies strictly beyond its band's outermost finite bound on the side its
 * economy consequence names as costly. `false` with no consequence, no band or no value.
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

export function selectHeadlines(groups: GuidedGroups): HeadlineSelection {
  const bandedById = new Map(
    groups.banded.map((entry) => [entry.metric.metric, entry]),
  )
  const notMeasuredById = new Map(
    groups.notMeasured.map((entry) => [entry.metric.metric, entry]),
  )
  const headlines: GuidedHeadlineStory[] = []
  for (const { story, spokesman } of STORY_SPOKESMEN) {
    const entry = bandedById.get(spokesman)
    const consequence = entry?.guidance.economyConsequence ?? null
    if (entry === undefined || consequence === null) continue
    if (pastCostlySide(entry)) headlines.push({ story, entry, consequence })
  }
  headlines.sort(
    (a, b) => a.entry.guidance.displayRank - b.entry.guidance.displayRank,
  )
  const unmeasured = STORY_SPOKESMEN.map(({ spokesman }) => spokesman)
    .filter((id) => notMeasuredById.has(id))
    .sort(
      (a, b) =>
        notMeasuredById.get(a)!.guidance.displayRank -
        notMeasuredById.get(b)!.guidance.displayRank,
    )
  return { headlines, unmeasured }
}

/**
 * The trigger stated as a position, for the empty state — `below the 5th percentile of Garmin's
 * table`, `above 9.5 cm` — derived from the guidance's own band so the sentence cannot drift from
 * the rule. Where the costly side's outermost zone is open-ended its label names the position;
 * otherwise the bound itself does. `null` without a consequence or a band.
 */
export function costlyThreshold(guidance: MetricGuidance): string | null {
  const { economyConsequence: consequence, band } = guidance
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
