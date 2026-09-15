import {
  formatBandNumber,
  formatBandRange,
  formatBandValue,
} from './formatBandValue'
import type { BandZone, ReferenceBand } from './types'

/**
 * Where a measured value sits against a reference band, and the words for it.
 *
 * Pure and renderer-independent so that every view placing a value against a band uses the same
 * rule and says the same thing. Everything here is a POSITION — "falls in", "between", "below",
 * "above" — and never a verdict: a band is where a measured population fell, not where a runner
 * should be.
 *
 * ## Which zone a value belongs to
 *
 * - **A closed zone (both bounds finite) is inclusive on both bounds**, as published: `153–163`
 *   contains 153 and 163.
 * - **An open-ended zone is STRICT on its one finite bound.** Garmin publishes `<153` and `>183`
 *   (`<3.05 %`, `>5.05 %`); they are stored as `{ min: null, max: 153 }` and
 *   `{ min: 183, max: null }`, but the published meaning is strict. So a cadence of exactly 153
 *   belongs to `153–163`, never to `<153`, and 183 belongs to `174–183`.
 * - Closed zones are checked first, then open ones, and the first match wins — so no value ever
 *   resolves to two zones.
 * - **A value no zone contains is either in a published gap or outside every zone.** The gaps
 *   (cadence `163→164`, `173→174`; vertical ratio `3.70→3.75 %`, `4.30→4.35 %`) are the
 *   publisher's and are real: cadence is a fitted non-integer, so 163.5 happens.
 */
export type BandPosition =
  | { kind: 'inZone'; zone: BandZone; zoneIndex: number }
  /** In a published gap: after `lower` ends and before `upper` starts. */
  | { kind: 'betweenZones'; lower: BandZone; upper: BandZone }
  /** Past every zone on `side`; `nearestBound` is the published bound closest on that side. */
  | { kind: 'outside'; side: 'below' | 'above'; nearestBound: number }

function contains(zone: BandZone, value: number): boolean {
  if (zone.min !== null && zone.max !== null) {
    return value >= zone.min && value <= zone.max
  }
  return (
    (zone.min === null || value > zone.min) &&
    (zone.max === null || value < zone.max)
  )
}

/** The zone's upper bound when it lies wholly below `value` under the same rule, else `null`. */
function endBefore(zone: BandZone, value: number): number | null {
  if (zone.max === null) return null
  const below = zone.min === null ? zone.max <= value : zone.max < value
  return below ? zone.max : null
}

/** The zone's lower bound when it lies wholly above `value` under the same rule, else `null`. */
function startAfter(zone: BandZone, value: number): number | null {
  if (zone.min === null) return null
  const above = zone.max === null ? zone.min >= value : zone.min > value
  return above ? zone.min : null
}

/** Locates `value` (in the band's own computed domain — no conversion) against the band's zones. */
export function locateInBand(band: ReferenceBand, value: number): BandPosition {
  const isClosed = (zone: BandZone) => zone.min !== null && zone.max !== null
  const ordered = band.zones
    .map((zone, zoneIndex) => ({ zone, zoneIndex }))
    .sort((a, b) => Number(isClosed(b.zone)) - Number(isClosed(a.zone)))
  const match = ordered.find(({ zone }) => contains(zone, value))
  if (match !== undefined) return { kind: 'inZone', ...match }

  let lower: { zone: BandZone; bound: number } | null = null
  let upper: { zone: BandZone; bound: number } | null = null
  for (const zone of band.zones) {
    const end = endBefore(zone, value)
    if (end !== null && (lower === null || end > lower.bound)) {
      lower = { zone, bound: end }
    }
    const start = startAfter(zone, value)
    if (start !== null && (upper === null || start < upper.bound)) {
      upper = { zone, bound: start }
    }
  }
  if (lower !== null && upper !== null) {
    return { kind: 'betweenZones', lower: lower.zone, upper: upper.zone }
  }
  if (upper !== null) {
    return { kind: 'outside', side: 'below', nearestBound: upper.bound }
  }
  if (lower !== null) {
    return { kind: 'outside', side: 'above', nearestBound: lower.bound }
  }
  throw new Error('A reference band must publish at least one zone')
}

/** Every distinct finite bound across the band's zones, ascending. Touching zones share one. */
export function bandBounds(band: ReferenceBand): number[] {
  const all = band.zones.flatMap((zone) =>
    [zone.min, zone.max].filter((bound) => bound !== null),
  )
  return [...new Set(all)].sort((a, b) => a - b)
}

/**
 * The lowest and highest finite bound the band publishes, of either kind. `null` when the band
 * publishes no finite bound at all.
 *
 * Deliberately computed here rather than read from `referenceBandEnvelope`: that helper takes its
 * lower edge only from zone minimums and its upper edge only from zone maximums, which is correct
 * for the five shipped bands but not in general. The two agree on every shipped band, and the
 * test file pins that.
 */
export function bandExtent(
  band: ReferenceBand,
): { min: number; max: number } | null {
  const bounds = bandBounds(band)
  if (bounds.length === 0) return null
  return { min: bounds[0], max: bounds[bounds.length - 1] }
}

/** Cap on the precision added to a value that rounds onto a bound it does not equal. */
const MAX_EXTRA_VALUE_DECIMALS = 3

/**
 * The measured value with its unit, at the band's published precision — plus just enough extra
 * precision that it never prints identically to a published bound it does not equal. Without that,
 * a cadence of 163.5 prints as `164`, which reads as inside `164–173` while the value is in the gap
 * before it.
 */
export function formatMeasuredBandValue(
  band: ReferenceBand,
  value: number,
): string {
  const bounds = bandBounds(band)
  for (let extra = 0; extra < MAX_EXTRA_VALUE_DECIMALS; extra++) {
    const collides = bounds.some(
      (bound) =>
        bound !== value &&
        formatBandNumber(bound, band.unit, extra) ===
          formatBandNumber(value, band.unit, extra),
    )
    if (!collides) return formatBandValue(value, band.unit, extra)
  }
  return formatBandValue(value, band.unit, MAX_EXTRA_VALUE_DECIMALS)
}

/**
 * One sentence stating where the value sits, e.g. `172 steps/min falls in the zone published as
 * “30th–69th percentile” (164–173 steps/min).` Names zones only by their published label and
 * bounds, and the band only as "published".
 */
export function describeBandPosition(
  band: ReferenceBand,
  value: number,
): string {
  const valueText = formatMeasuredBandValue(band, value)
  const position = locateInBand(band, value)
  const zoneRef = (zone: BandZone) =>
    `“${zone.label}” (${formatBandRange(zone.min, zone.max, band.unit)})`
  switch (position.kind) {
    case 'inZone':
      return `${valueText} falls in the ${band.zones.length === 1 ? 'range' : 'zone'} published as ${zoneRef(position.zone)}.`
    case 'betweenZones':
      return `${valueText} falls between the zones published as ${zoneRef(position.lower)} and ${zoneRef(position.upper)}, in a gap the published table leaves between them.`
    case 'outside': {
      const extent = bandExtent(band)
      return extent !== null && extent.max > extent.min
        ? `${valueText} is ${position.side} the published range (${formatBandRange(extent.min, extent.max, band.unit)}).`
        : `${valueText} is ${position.side} the published range, which ${position.side === 'below' ? 'starts' : 'ends'} at ${formatBandValue(position.nearestBound, band.unit)}.`
    }
  }
}
