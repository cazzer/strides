import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_LABELS, isMetricFlagged } from './metricConfidence'

export interface LowConfidenceBannerProps {
  heuristics: FormHeuristicsResult
}

/**
 * Derived from `METRIC_LABELS`'s keys rather than hand-written: `METRIC_LABELS` is typed
 * `Record<MetricId, string>`, so the compiler already enforces it has exactly one entry per
 * `MetricId` — adding a metric to `MetricId` without adding it to `METRIC_LABELS` is a type error
 * today. Deriving this list from those keys makes it impossible for the banner to silently omit a
 * metric the way a second hand-written list (the previous shape of this constant) could.
 * `Object.keys` iterates own enumerable string keys in insertion order, and `METRIC_LABELS` is
 * declared in the same family-adjacent order every other `MetricId` enumeration in this codebase
 * uses, so this is behavior-identical to the prior hand-written array — only the maintenance
 * burden moves.
 */
const METRIC_IDS = Object.keys(METRIC_LABELS) as MetricId[]

/**
 * Pure function of `heuristics` — no hook, no lifecycle. Renders nothing unless at least one
 * metric is flagged by the same `isMetricFlagged` condition `MetricsPanel` uses per-card, so the
 * banner and the flagged cards below it can never disagree about which metrics are unreliable.
 */
export function LowConfidenceBanner({ heuristics }: LowConfidenceBannerProps) {
  const flagged = METRIC_IDS.filter((id) => isMetricFlagged(heuristics[id]))

  if (flagged.length === 0) return null

  return (
    <div
      role="status"
      className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4"
    >
      <p>
        Lower-confidence results: {flagged.map((id) => METRIC_LABELS[id]).join(', ')}. Check each
        metric's confidence note below.
      </p>
    </div>
  )
}
