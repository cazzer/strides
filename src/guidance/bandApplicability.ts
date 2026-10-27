import type { MetricResult } from '../heuristics/types'
import { bandBounds, locateInBand } from './bandPosition'
import type { BandSource, MetricGuidance, ReferenceBand } from './types'

/**
 * Whether a metric's band can be shown, and whether its studied change applies to a reading.
 *
 * Moved down from `src/results/guidedGroups.ts` and `guidedHeadlines.ts` (add-runner-tour design.md
 * D5) so `src/guidance` depends on nothing in `src/results`; both files re-export these unchanged.
 */

/** A metric's reading beside its guidance and the band it renders against. */
export interface GuidedEntry {
  metric: MetricResult
  guidance: MetricGuidance
  /**
   * The band this entry renders against, or `null`. Non-null exactly for the `banded` group, and
   * never a band whose provenance is incomplete — see `renderableBand`.
   */
  band: ReferenceBand | null
}

function isFilled(text: string): boolean {
  return text.trim().length > 0
}

/**
 * All five provenance fields present and non-blank.
 *
 * `populationShort` counts because it is the population statement that actually REACHES the screen
 * without expanding, which is what the spec's rule is about; `population` counts too, because a
 * short form with nothing behind it is an attribution the reader cannot check.
 */
export function sourceHasProvenance(
  source: BandSource | null | undefined,
): boolean {
  return (
    source !== null &&
    source !== undefined &&
    isFilled(source.title ?? '') &&
    isFilled(source.url ?? '') &&
    isFilled(source.population ?? '') &&
    isFilled(source.populationShort ?? '') &&
    isFilled(source.sampleSize ?? '')
  )
}

/**
 * The guidance's band if it can be shown with its source, population and sample size, else `null`.
 *
 * The type makes all four fields required, so no shipped band fails this. It is checked at runtime
 * anyway because the spec's rule is about what reaches the screen, not about what compiles: "a
 * band with its provenance stripped off is indistinguishable from a number the app invented", and
 * a blank string satisfies the type while stripping exactly that. A band that fails renders no
 * scale at all, and its metric falls to the unbanded group rather than disappearing.
 */
export function renderableBand(guidance: MetricGuidance): ReferenceBand | null {
  const { band } = guidance
  if (band === null) return null
  return sourceHasProvenance(band.source) ? band : null
}

/**
 * Whether this entry's Try line would point the runner further out of the band they are outside.
 *
 * A Try line names a change in one direction — `tryLine.direction`, which is which way it moves the
 * quantity THIS card reports. Rendered unconditionally, `verticalOscillationCm` reads 4.4 cm on this
 * repo's own side-view clip, below a 6.0–9.5 cm band, under a line saying to stay lower still.
 *
 * Withheld only where the value is genuinely PAST the band on the matching side. Inside the band, in
 * one of the source table's published gaps, or on a metric with no band at all, it renders: those
 * are not positions a direction can be wrong about. Note an open-ended outer zone (cadence's `<153`,
 * `>183`) is INSIDE the band by construction — `locateInBand` never reports `outside` for a value
 * such a zone contains — so cadence's line is never withheld, which is correct: a runner above
 * Garmin's 95th percentile is in the band's top zone, not past its end.
 */
export function tryLineApplies(entry: GuidedEntry): boolean {
  const { tryLine } = entry.guidance
  if (tryLine === null) return false
  const { band } = entry
  const value = entry.metric.value
  if (band === null || value === null) return true
  const position = locateInBand(band, value)
  if (position.kind !== 'outside') return true
  return position.side !== (tryLine.direction === 'lower' ? 'below' : 'above')
}

/**
 * Whether the entry's value lies strictly beyond its band's outermost finite bound on the side its
 * economy consequence names as costly. `false` with no consequence, no band or no value. Says
 * nothing about tier; callers apply that.
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
