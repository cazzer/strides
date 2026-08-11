import type { FormHeuristicsResult } from '../heuristics/types'
import { METRIC_LABELS, isMetricFlagged } from './metricConfidence'

export interface LowConfidenceBannerProps {
  heuristics: FormHeuristicsResult
}

const METRIC_IDS = [
  'verticalOscillation',
  'trunkLean',
  'overstriding',
  'cadence',
  'kneeFlexion',
  'armSwingSymmetry',
  'footStrikePattern',
] as const

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
