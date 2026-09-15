import type { BandUnit } from './types'

/**
 * Text formatting for a reference band's numbers and for the measured value placed against them.
 *
 * ## The one conversion this module exists to own
 *
 * Every number a `ReferenceBand` carries is in the metric's own **computed** domain, not its
 * display domain (see the numeric-convention section on `ReferenceBand` in `./types.ts`). For two
 * units those differ by a factor of 100: `'percent'` (a dimensionless 0..1 comparison, so Garmin's
 * 3.05 % is stored as `0.0305`) and `'ratio'` (a fraction of torso length). This is the only place
 * in `src/guidance/` that multiplies by 100, so a renderer that routes every printed number
 * through it cannot print a band a hundred times too wide.
 *
 * Deliberately independent of `MetricsPanel`'s private `formatValue`: that one formats a whole
 * `MetricResult` (including foot-strike classification) at the panel's precision, and a band needs
 * `'percent'` at two decimal places because that is the precision Garmin publishes its table at —
 * one decimal place would print `3.70` and `3.75` as the same `3.7 %`, erasing a published gap.
 */

/** Digits after the decimal point for each unit, at the precision the bands are published at. */
const DECIMALS: Record<BandUnit, number> = {
  stepsPerMinute: 0,
  percent: 2,
  centimeters: 1,
  degrees: 1,
  ratio: 1,
}

/** Computed-domain → display-domain multiplier. Non-unity for exactly the two 0..1 units. */
const DISPLAY_SCALE: Record<BandUnit, number> = {
  stepsPerMinute: 1,
  percent: 100,
  centimeters: 1,
  degrees: 1,
  ratio: 100,
}

/** What follows the number, including any separating space. */
const SUFFIX: Record<BandUnit, string> = {
  stepsPerMinute: ' steps/min',
  percent: '%',
  centimeters: ' cm',
  degrees: '°',
  ratio: '% of torso length',
}

/**
 * The number alone, converted to the display domain, with no unit.
 *
 * `extraDecimals` adds precision beyond the published precision. A renderer needs it for exactly
 * one reason: a measured value that rounds onto a published bound while sitting on the other side
 * of it (cadence `163.5` prints as `164`, which reads as inside `164–173` while the value is in the
 * gap before it).
 */
export function formatBandNumber(
  value: number,
  unit: BandUnit,
  extraDecimals = 0,
): string {
  const text = (value * DISPLAY_SCALE[unit]).toFixed(
    DECIMALS[unit] + extraDecimals,
  )
  // `(-0.04).toFixed(1)` is "-0.0"; a signed zero is noise, not information.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

/** A single number with its unit, e.g. `3.05%`, `172 steps/min`, `6.0 cm`. */
export function formatBandValue(
  value: number,
  unit: BandUnit,
  extraDecimals = 0,
): string {
  return `${formatBandNumber(value, unit, extraDecimals)}${SUFFIX[unit]}`
}

/**
 * One zone's published extent, with the unit stated once: `164–173 steps/min`, `below 3.05%`,
 * `above 183 steps/min`.
 *
 * A closed range is inclusive on both bounds; an open-ended zone is strict on its one finite bound,
 * because that is what the publisher printed (`<153`, `>183`) — see `bandPosition.ts`. The range
 * separator becomes ` to ` when the lower bound is negative, so `-2.0 to 5.0°` cannot read as a
 * hyphenated pair.
 */
export function formatBandRange(
  min: number | null,
  max: number | null,
  unit: BandUnit,
): string {
  const suffix = SUFFIX[unit]
  if (min !== null && max !== null) {
    const separator = min < 0 ? ' to ' : '–'
    return `${formatBandNumber(min, unit)}${separator}${formatBandNumber(max, unit)}${suffix}`
  }
  if (max !== null) return `below ${formatBandNumber(max, unit)}${suffix}`
  if (min !== null) return `above ${formatBandNumber(min, unit)}${suffix}`
  return 'any value'
}
