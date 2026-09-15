import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import type { BandSource, MetricGuidance, ReferenceBand } from '../guidance/types'
import { metricTier } from './metricConfidence'
import type { ScalePassStatus } from './types'

/**
 * How the guided results view partitions and orders the twelve metrics.
 *
 * Pure, so the page's structure is decided somewhere a test can read it without rendering. Three
 * groups, by what can honestly be said about each metric on this clip (guided-results-view spec,
 * "The guided view ranks metrics into three groups"):
 *
 * 1. **`banded`** — measured, and its guidance carries a reference band that can be rendered WITH
 *    its provenance. Shown expanded, each against its scale.
 * 2. **`unbanded`** — measured, with no renderable band. Shown collapsed, with its value, its notes,
 *    its links and the reason there is no band. Only the SCALE is withheld (design.md D7.6).
 * 3. **`notMeasured`** — `metricTier(metric) === 'excluded'`: nothing measured, or the camera
 *    geometry cannot support the measurement. Shown collapsed, with why and a capture hint.
 *
 * **Order within every group is `displayRank` and nothing else** — a fixed property of the guidance
 * data, never of the runner's value or of the result's confidence. Ranking by the runner's own
 * numbers would make the page's layout a judgement about the runner (design.md D2, D7.8).
 */

export interface GuidedEntry {
  metric: MetricResult
  guidance: MetricGuidance
  /**
   * The band this entry renders against, or `null`. Non-null exactly for the `banded` group, and
   * never a band whose provenance is incomplete — see `renderableBand`.
   */
  band: ReferenceBand | null
}

export interface GuidedGroups {
  banded: GuidedEntry[]
  unbanded: GuidedEntry[]
  notMeasured: GuidedEntry[]
}

function isFilled(text: string): boolean {
  return text.trim().length > 0
}

/** All four provenance fields present and non-blank — the minimum the spec requires on screen. */
export function sourceHasProvenance(source: BandSource | null | undefined): boolean {
  return (
    source !== null &&
    source !== undefined &&
    isFilled(source.title ?? '') &&
    isFilled(source.url ?? '') &&
    isFilled(source.population ?? '') &&
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
 * Partitions a heuristics result into the three guided groups.
 *
 * `guidance` defaults to the shipped record and is a parameter only so a test can prove the order
 * follows `displayRank` rather than the record's key order, and that an unattributable band is
 * withheld.
 */
export function guidedGroups(
  heuristics: FormHeuristicsResult,
  guidance: Record<MetricId, MetricGuidance> = METRIC_GUIDANCE,
): GuidedGroups {
  const entries: GuidedEntry[] = (Object.keys(guidance) as MetricId[])
    .map((id) => ({
      metric: heuristics[id] as MetricResult,
      guidance: guidance[id],
      band: renderableBand(guidance[id]),
    }))
    .sort((a, b) => a.guidance.displayRank - b.guidance.displayRank)

  const groups: GuidedGroups = { banded: [], unbanded: [], notMeasured: [] }
  for (const entry of entries) {
    if (metricTier(entry.metric) === 'excluded') {
      groups.notMeasured.push({ ...entry, band: null })
    } else if (entry.band !== null) {
      groups.banded.push(entry)
    } else {
      groups.unbanded.push(entry)
    }
  }
  return groups
}

/**
 * Why a not-measured metric was not measured, in the words the classic panel already uses.
 *
 * ⚠️ **A deliberate copy of the `hint` expression in `MetricsPanel.tsx`'s excluded list, and of
 * `ExcludedEntry`'s fallback chain**, strings included, because that file is not to be edited by
 * this change (design.md D7.2) and a reader switching views should read the same reason in both.
 * The two centimetre metrics are grafted from the background scale pass, so while it runs their
 * availability caveat ("no scale could be measured") is not yet the truth, and after it fails the
 * caveat alone would imply the capability is absent when the app just tried it. Null value only:
 * the one non-null excluded shape is an unsuitable view, whose own caveat is the accurate reason.
 */
export function notMeasuredReason(
  metric: MetricResult,
  scalePassStatus: ScalePassStatus,
): string {
  const scalePassInProgress = scalePassStatus === 'pending' || scalePassStatus === 'running'
  const hint =
    (metric.metric === 'verticalOscillationCm' || metric.metric === 'stepWidthCm') &&
    metric.value === null
      ? scalePassInProgress
        ? 'Measuring real-world scale with a second look at the clip…'
        : scalePassStatus === 'failed'
          ? "A second look at the clip couldn't measure real-world scale."
          : undefined
      : undefined
  return hint ?? metric.caveat ?? 'Not measurable for this clip.'
}
