import type { MetricId, MetricResult } from '../heuristics/types'

export const METRIC_LABELS: Record<MetricId, string> = {
  verticalOscillation: 'Vertical oscillation',
  trunkLean: 'Trunk lean',
  overstriding: 'Overstriding',
  cadence: 'Cadence',
  kneeFlexion: 'Knee flexion',
  armSwingSymmetry: 'Arm swing symmetry',
  footStrikePattern: 'Foot strike pattern',
}

/** Low-confidence threshold below which a metric is flagged — a judgment-call cutoff, not
 * derived from the heuristics engine itself (which only guarantees confidence is 0..1, forced to
 * 0 when value is null). Shared by `MetricsPanel` (per-card flag) and `LowConfidenceBanner`
 * (whether to show at all) so the two can never disagree about which metrics are unreliable. */
export const LOW_CONFIDENCE_THRESHOLD = 0.4

export function isMetricFlagged(metric: MetricResult): boolean {
  return (
    metric.value === null ||
    metric.confidence < LOW_CONFIDENCE_THRESHOLD ||
    metric.viewFit === 'unsuitable'
  )
}
