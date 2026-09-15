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
 * `'percent'` at two decimal places because that is the precision the halved Garmin table is stated
 * at — one decimal place would print `3.70` and `3.75` as the same `3.7 %`, erasing the source's gap.
 *
 * ## Two text styles: visual and spoken
 *
 * `'visual'` is the compact form — `164–173 steps/min` — for tick and zone labels a sighted reader
 * scans, which are `aria-hidden` or duplicated elsewhere in text. `'spoken'` is the form for
 * SENTENCES and anything that is the text alternative: ` to ` between numbers and units spelled out
 * (`164 to 173 steps per minute`), because a screen reader may read an en dash as nothing at all or
 * as "dash", and `steps/min` as "steps slash min". The percent sign is kept in both styles: every
 * mainstream screen reader reads it as "percent", and `3.10 percent` in a visible caption would read
 * worse than it sounds.
 */

/** Which of the two text forms to produce. See the module doc. */
export type BandTextStyle = 'visual' | 'spoken'

/** Digits after the decimal point for each unit, at the precision the bands' sources state them at. */
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

/** What follows the number, including any separating space, per text style. */
const SUFFIX: Record<BandTextStyle, Record<BandUnit, string>> = {
  visual: {
    stepsPerMinute: ' steps/min',
    percent: '%',
    centimeters: ' cm',
    degrees: '°',
    ratio: '% of torso length',
  },
  spoken: {
    stepsPerMinute: ' steps per minute',
    percent: '%',
    centimeters: ' centimetres',
    degrees: ' degrees',
    ratio: '% of torso length',
  },
}

/**
 * A computed-domain number in the display domain, unrounded: `0.0305` → `3.05` for `'percent'`.
 *
 * For arithmetic a renderer does on DISPLAYED magnitudes — how far apart two bounds read — and never
 * for printing; printing goes through {@link formatBandNumber}, which also rounds.
 */
export function toDisplayNumber(value: number, unit: BandUnit): number {
  return value * DISPLAY_SCALE[unit]
}

/**
 * The number alone, converted to the display domain, with no unit.
 *
 * `extraDecimals` adds precision beyond the source precision. A renderer needs it for exactly
 * one reason: a measured value that rounds onto a band's bound while sitting on the other side
 * of it (cadence `163.5` prints as `164`, which reads as inside `164–173` while the value is in the
 * gap before it).
 */
export function formatBandNumber(
  value: number,
  unit: BandUnit,
  extraDecimals = 0,
): string {
  const text = toDisplayNumber(value, unit).toFixed(
    DECIMALS[unit] + extraDecimals,
  )
  // `(-0.04).toFixed(1)` is "-0.0"; a signed zero is noise, not information.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

/**
 * A single number with its unit, e.g. `3.05%`, `172 steps/min`, `6.0 cm` — or, `'spoken'`,
 * `172 steps per minute`, `6.0 centimetres`.
 */
export function formatBandValue(
  value: number,
  unit: BandUnit,
  extraDecimals = 0,
  style: BandTextStyle = 'visual',
): string {
  return `${formatBandNumber(value, unit, extraDecimals)}${SUFFIX[style][unit]}`
}

/**
 * One zone's extent, with the unit stated once: `164–173 steps/min`, `below 3.05%`,
 * `above 183 steps/min` — or, `'spoken'`, `164 to 173 steps per minute`.
 *
 * A closed range is inclusive on both bounds; an open-ended zone is strict on its one finite bound,
 * because that is what the source printed (`<153`, `>183`) — see `bandPosition.ts`. The visual
 * separator also becomes ` to ` when the lower bound is negative, so `-2.0 to 5.0°` cannot read as
 * a hyphenated pair.
 */
export function formatBandRange(
  min: number | null,
  max: number | null,
  unit: BandUnit,
  style: BandTextStyle = 'visual',
): string {
  const suffix = SUFFIX[style][unit]
  if (min !== null && max !== null) {
    const separator = style === 'spoken' || min < 0 ? ' to ' : '–'
    return `${formatBandNumber(min, unit)}${separator}${formatBandNumber(max, unit)}${suffix}`
  }
  if (max !== null) return `below ${formatBandNumber(max, unit)}${suffix}`
  if (min !== null) return `above ${formatBandNumber(min, unit)}${suffix}`
  return 'any value'
}
