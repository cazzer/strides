import type { MetricId, MetricResult } from '../heuristics/types'

export const METRIC_LABELS: Record<MetricId, string> = {
  verticalOscillation: 'Vertical oscillation',
  verticalRatio: 'Vertical ratio',
  verticalOscillationCm: 'Vertical oscillation (cm)',
  trunkLean: 'Trunk lean',
  overstriding: 'Overstriding',
  cadence: 'Cadence',
  kneeFlexion: 'Knee flexion',
  armSwingSymmetry: 'Arm swing symmetry',
  footStrikePattern: 'Foot strike pattern',
  stepWidth: 'Step width',
  stepWidthCm: 'Step width (cm)',
}

/**
 * Confidence thresholds (#37, roles narrowed by exclude-only-unmeasurable-metrics) —
 * judgment-call cutoffs, not derived from the heuristics engine itself (which only guarantees
 * `confidence` is 0..1, forced to 0 when `value` is null). Their roles differ:
 *   - `HIGH_CONFIDENCE_THRESHOLD` feeds BOTH layout (`metricTier`'s normal/caveated boundary)
 *     and copy (`MetricsPanel`'s `confidenceLabel` High/Medium boundary).
 *   - `LOW_CONFIDENCE_THRESHOLD` feeds ONLY copy — the Medium/Low boundary in
 *     `confidenceLabel`. It participates in no layout decision: a measured value is never
 *     withheld for low confidence.
 * Single-sourced here so layout and copy can never disagree about where 0.7 falls — both import
 * these instead of repeating the literals.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7
export const LOW_CONFIDENCE_THRESHOLD = 0.4

export type MetricTier = 'normal' | 'caveated' | 'excluded'

/**
 * Tiered layout driver (#37; exclusion rule reversed by exclude-only-unmeasurable-metrics —
 * see that change's design.md D1 and the RCA behind it). Pure function of one `MetricResult`:
 *   - `'excluded'` — `value === null` OR `viewFit === 'unsuitable'`. Structurally unmeasurable:
 *     either nothing was measured, or the camera geometry cannot support the measurement.
 *     Rendered only by name + reason in the panel's excluded section; no value/confidence
 *     markup at all. NEVER assigned for low confidence alone — "measured but uncertain" renders
 *     as a caveated card, not an absence.
 *   - `'normal'`   — everything else at `confidence >= HIGH_CONFIDENCE_THRESHOLD`. Renders as
 *     today's card.
 *   - `'caveated'` — everything else below that, with NO lower confidence bound. Renders as a
 *     card with a structurally distinct border, its value, a "Medium confidence"/"Low
 *     confidence" indicator, and its caveat (if any) rendered as a visible note.
 *
 * Exactly `0.7` is `'normal'` (the `>=`). `value === null` forces `'excluded'` regardless of
 * confidence (a metric that reports no number is never partially trusted).
 *
 * `viewFit === 'unsuitable'` is checked explicitly — the inverse of #37's original decision,
 * which relied on every `'unsuitable'` multiplier in `DEFAULT_VIEW_FIT_TABLE` keeping
 * confidence below the (since-removed) confidence-exclusion clause. Exclusion here means
 * "structurally unmeasurable" (wrong camera geometry or nothing measured), never "measured but
 * uncertain", so it must read the metric's own `viewFit` classification rather than be inferred
 * from confidence arithmetic — and it no longer depends on `DEFAULT_VIEW_FIT_TABLE` multiplier
 * values staying below any threshold. The confidence-math side (why the shared hip-bounce fit's
 * R² is bimodal run-to-run, collapsing confidence on measured metrics) is issue #38, not this
 * function's problem.
 */
export function metricTier(metric: MetricResult): MetricTier {
  if (metric.value === null || metric.viewFit === 'unsuitable') {
    return 'excluded'
  }
  return metric.confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'normal' : 'caveated'
}
