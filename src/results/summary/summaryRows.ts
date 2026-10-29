import type { FormHeuristicsResult, MetricId, MetricResult } from '../../heuristics/types'
import { areaReadings, bounceDerivation } from '../../guidance/compositeReadings'
import type { AreaReading, BounceDerivation, RatioClipBounce } from '../../guidance/compositeReadings'
import { FOCUS_AREA_ORDER, focusAreaView } from '../../guidance/focusAreas'
import type { FocusAreaView } from '../../guidance/focusAreas'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import type { MetricGuidance, MetricTier } from '../../guidance/types'
import { guidedGroups } from '../guidedGroups'
import type { GuidedEntry } from '../guidedGroups'
import { metricTier } from '../metricConfidence'

export interface SummaryArea {
  view: FocusAreaView
  /** The area's measured metrics as guided entries, headline first, in preference order. */
  entries: GuidedEntry[]
  /**
   * The same entries grouped for presentation (`areaReadings`): one reading per metric, except the
   * bounce composite, one reading where its first member sat. The first reading's headline is what
   * the row and the tour stop headline; `view.headline` (feedback, the one thing) is unchanged.
   */
  readings: AreaReading<GuidedEntry>[]
  /** What vertical ratio was derived from, when this area holds a measured one; else null. */
  bounce: BounceDerivation | null
}

export interface SummaryRowsOptions {
  guidance?: Record<MetricId, MetricGuidance>
  /** Which clip each fused metric came from (`computeFusionSourceIndices`); null means one clip. */
  sourceIndices?: Readonly<Record<MetricId, number>> | null
  /** The relative bounce on vertical ratio's own clip (a multi-clip session); see `bounceDerivation`. */
  ratioClipBounce?: RatioClipBounce | null
}

export interface SummaryRows {
  /** One per MEASURED focus area, in tour order. An area with every metric excluded has none. */
  areas: SummaryArea[]
  /** Every excluded metric, in the guided view's own order: the summary's final row. */
  notMeasured: GuidedEntry[]
  /**
   * All six areas' views, measured or not, in tour order: what `selectOneThing` reads, so the tour
   * and the summary pick their one thing from the same views.
   */
  views: FocusAreaView[]
}

/**
 * How the results summary lays the thirteen metrics out: one row per measured focus area, then one
 * "Not measured" row. Every metric lands in exactly one of them.
 *
 * Entries come from `guidedGroups`, so a summary card is the very entry the guided view would render
 * (the same band, or none), and both read the tier through `metricTier`, so "measured" means the
 * same thing in the area rows as in the guided groups. Pure, so the partition is testable without
 * rendering.
 */
export function summaryRows(
  heuristics: FormHeuristicsResult,
  { guidance = METRIC_GUIDANCE, sourceIndices = null, ratioClipBounce = null }: SummaryRowsOptions = {},
): SummaryRows {
  const { banded, unbanded, notMeasured } = guidedGroups(heuristics, guidance)
  const measured = new Map(
    [...banded, ...unbanded].map((entry) => [entry.metric.metric, entry]),
  )
  const tiers = Object.fromEntries(
    (Object.keys(guidance) as MetricId[]).map((id) => [
      id,
      metricTier(heuristics[id] as MetricResult),
    ]),
  ) as Record<MetricId, MetricTier>

  const views = FOCUS_AREA_ORDER.map((area) => focusAreaView(area, heuristics, tiers))
  const derivation = bounceDerivation(heuristics, tiers, sourceIndices, undefined, ratioClipBounce)
  const areas = views
    .filter((view) => view.measured)
    .map((view) => {
      const entries = [view.headline!, ...view.supporting].map((focus) => {
        const entry = measured.get(focus.metric.metric)
        // Both sides read `metricTier`, so a non-excluded area metric is always a measured entry.
        if (entry === undefined) {
          throw new Error(`summaryRows: ${focus.metric.metric} is measured but has no guided entry`)
        }
        return entry
      })
      const readings = areaReadings(entries, (entry) => entry.metric.metric)
      const holdsRatio = entries.some((entry) => entry.metric.metric === 'verticalRatio')
      return { view, entries, readings, bounce: holdsRatio ? derivation : null }
    })
  return { areas, notMeasured, views }
}
