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
}

/**
 * Confidence-tier thresholds (#37) — judgment-call cutoffs, not derived from the heuristics
 * engine itself (which only guarantees `confidence` is 0..1, forced to 0 when `value` is null).
 * Single-sourced here so `metricTier`'s layout decision and `MetricsPanel`'s `confidenceLabel`
 * copy can never disagree about where 0.7/0.4 fall — both import these instead of repeating the
 * literals.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7
export const LOW_CONFIDENCE_THRESHOLD = 0.4

export type MetricTier = 'normal' | 'caveated' | 'excluded'

/**
 * Confidence-tiered layout driver (#37, design.md D1). Pure function of one `MetricResult`:
 *   - `'normal'`   — `confidence >= HIGH_CONFIDENCE_THRESHOLD` AND `value` non-null. Renders as
 *     today's card.
 *   - `'caveated'` — `LOW_CONFIDENCE_THRESHOLD <= confidence < HIGH_CONFIDENCE_THRESHOLD` AND
 *     `value` non-null. Renders as a card with a structurally distinct border and its caveat (if
 *     any) rendered as a visible note.
 *   - `'excluded'` — `confidence < LOW_CONFIDENCE_THRESHOLD` OR `value === null`. Rendered only
 *     by name + reason in the panel's excluded section; no value/confidence markup at all.
 *
 * Boundaries land on the side documented by the `>=`/`<` above: exactly `0.7` is `'normal'`,
 * exactly `0.4` is `'caveated'`. `value === null` forces `'excluded'` regardless of confidence
 * (a metric that reports no number is never partially trusted).
 *
 * Deliberately does NOT read `viewFit` — see design.md D1 for why: every `'unsuitable'` entry in
 * `DEFAULT_VIEW_FIT_TABLE` carries a `multiplier <= 0.2`, and confidence is a product of factors
 * each `<= 1` (see `confidence.ts`), so a view-unsuitable metric's confidence can never reach
 * `LOW_CONFIDENCE_THRESHOLD` — it always lands in `'excluded'` via the confidence clause alone.
 * Checking `viewFit` here would be redundant with that arithmetic, not a source of disagreement
 * with it.
 */
export function metricTier(metric: MetricResult): MetricTier {
  if (metric.value === null || metric.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return 'excluded'
  }
  return metric.confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'normal' : 'caveated'
}
