import type { MetricResult } from '../heuristics/types'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import { classifyFootStrike } from '../heuristics/footStrikePattern'
import type { FootStrikeClass } from '../heuristics/footStrikePattern'
import {
  describeBandPositionBriefly,
  describeBandPositionStandalone,
  formatMeasuredBandValue,
} from '../guidance/bandPosition'
import type { GuidedEntry } from './guidedGroups'

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

export function formatGuidedValue(
  metric: Pick<MetricResult, 'metric' | 'value' | 'unit'>,
): string {
  if (metric.value === null) return 'Not available'
  if (metric.metric === 'footStrikePattern') {
    const cls = classifyFootStrike(
      metric.value,
      DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio,
    )
    return `${FOOT_STRIKE_CLASS_LABELS[cls]} (proxy)`
  }
  if (metric.unit === 'degrees') return `${metric.value.toFixed(1)}°`
  if (metric.unit === 'stepsPerMinute')
    return `${Math.round(metric.value)} steps/min`
  // 'percent' is a dimensionless 0..1 comparison — not a fraction of torso length, so no suffix.
  if (metric.unit === 'percent') return `${(metric.value * 100).toFixed(1)}%`
  // 'centimeters' is absolute, with no denominator: `value` is not multiplied by 100.
  if (metric.unit === 'centimeters') return `${metric.value.toFixed(1)} cm`
  return `${(metric.value * 100).toFixed(1)}% of torso length`
}

/**
 * The headline value a guided card prints — and, through `guidedHeadlineParts`, the value every
 * summary row and tour stop prints — one function, so they can never disagree.
 *
 * A banded entry prints at its band's precision (`formatMeasuredBandValue`, see above); every other
 * entry prints exactly as the classic panel does. A not-measured entry has no headline: the view
 * never prints the value of an excluded metric, including a measured one excluded for its view.
 */
export function guidedHeadline(
  entry: GuidedEntry,
  excluded: boolean,
): string | null {
  if (excluded) return null
  const { band, metric } = entry
  return band !== null && metric.value !== null
    ? formatMeasuredBandValue(band, metric.value)
    : formatGuidedValue(metric)
}

/** A card headline: the value, and where it sits — `null` position for a card with no band. */
export interface GuidedHeadlineParts {
  value: string
  position: string | null
}

/**
 * The two halves of a banded card's headline — `172 steps/min` and `30th–69th percentile of
 * Garmin's table` — kept apart so the view can set them at different sizes, and joined nowhere
 * else so the two can never disagree about which is which.
 *
 * `position` is `null` for an entry with no band or no value: there is nothing to be positioned
 * against. `value` is always {@link guidedHeadline}'s own answer for a non-excluded entry.
 */
export function guidedHeadlineParts(
  entry: GuidedEntry,
  { standalone = false }: { standalone?: boolean } = {},
): GuidedHeadlineParts {
  const { band, metric } = entry
  const value = guidedHeadline(entry, false) ?? formatGuidedValue(metric)
  // `standalone`: no full scale renders beside this headline (a summary row, a tour stop), so the
  // position must name its range itself rather than say "the range shown".
  const describe = standalone
    ? describeBandPositionStandalone
    : describeBandPositionBriefly
  const position =
    band !== null && metric.value !== null ? describe(band, metric.value) : null
  return { value, position }
}
