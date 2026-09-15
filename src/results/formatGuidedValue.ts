import type { MetricResult } from '../heuristics/types'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import { classifyFootStrike } from '../heuristics/footStrikePattern'
import type { FootStrikeClass } from '../heuristics/footStrikePattern'

/**
 * The guided view's text for a metric's value, for every card that has NO scale beside it.
 *
 * ⚠️ **A deliberate copy of `MetricsPanel.tsx`'s private `formatValue`**, reproduced output for
 * output rather than imported, because that function is not exported and that file is not to be
 * edited by the guided-results-view change (design.md D7.2). `formatGuidedValue.test.ts` checks
 * each branch against the same inputs `MetricsPanel.test.tsx` renders, so the two can be seen to
 * agree; if one changes, that test is where the disagreement should surface.
 *
 * **Not used for a banded metric's headline.** A card with a `MetricScale` prints its value with
 * `formatMeasuredBandValue` instead, at the band's own published precision plus whatever extra
 * precision stops the value printing identically to a bound it does not equal. At the panel's
 * precision a cadence of 163.5 would print "164 steps/min" directly above a sentence saying it
 * falls in the gap BEFORE the zone that starts at 164 — the headline would contradict the scale.
 * Only an unbanded card, with no published bound to collide with, uses this formatter.
 */

const FOOT_STRIKE_CLASS_LABELS: Record<FootStrikeClass, string> = {
  heel: 'Heel strike',
  midfoot: 'Midfoot strike',
  forefoot: 'Forefoot strike',
}

export function formatGuidedValue(metric: MetricResult): string {
  if (metric.value === null) return 'Not available'
  if (metric.metric === 'footStrikePattern') {
    const cls = classifyFootStrike(
      metric.value,
      DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio,
    )
    return `${FOOT_STRIKE_CLASS_LABELS[cls]} (proxy)`
  }
  if (metric.unit === 'degrees') return `${metric.value.toFixed(1)}°`
  if (metric.unit === 'stepsPerMinute') return `${Math.round(metric.value)} steps/min`
  // 'percent' is a dimensionless 0..1 comparison — not a fraction of torso length, so no suffix.
  if (metric.unit === 'percent') return `${(metric.value * 100).toFixed(1)}%`
  // 'centimeters' is absolute, with no denominator: `value` is not multiplied by 100.
  if (metric.unit === 'centimeters') return `${metric.value.toFixed(1)} cm`
  return `${(metric.value * 100).toFixed(1)}% of torso length`
}
