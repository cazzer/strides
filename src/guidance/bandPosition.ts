import {
  formatBandNumber,
  formatBandRange,
  formatBandValue,
} from './formatBandValue'
import type { BandTextStyle } from './formatBandValue'
import { referenceBandEnvelope } from './types'
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
 * - **A closed zone (both bounds finite) is inclusive on both bounds**, as the source states it:
 *   `153–163` contains 153 and 163.
 * - **An open-ended zone is STRICT on its one finite bound.** Garmin prints `<153` and `>183`
 *   (`<3.05 %`, `>5.05 %` once halved); they are stored as `{ min: null, max: 153 }` and
 *   `{ min: 183, max: null }`, but the printed meaning is strict. So a cadence of exactly 153
 *   belongs to `153–163`, never to `<153`, and 183 belongs to `174–183`.
 * - Closed zones are checked first, then open ones, and the first match wins — so no value ever
 *   resolves to two zones.
 * - **A value no zone contains is either in a gap or outside every zone.** The gaps (cadence
 *   `163→164`, `173→174`; vertical ratio `3.70→3.75 %`, `4.30→4.35 %`) are the source table's and are
 *   real: cadence is a fitted non-integer, so 163.5 happens.
 */
export type BandPosition =
  | { kind: 'inZone'; zone: BandZone; zoneIndex: number }
  /** In a gap in the source's table: after `lower` ends and before `upper` starts. */
  | { kind: 'betweenZones'; lower: BandZone; upper: BandZone }
  /** Past every zone on `side`; `nearestBound` is the band's bound closest on that side. */
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
  throw new Error('A reference band must have at least one zone')
}

/** Every distinct finite bound across the band's zones, ascending. Touching zones share one. */
export function bandBounds(band: ReferenceBand): number[] {
  const all = band.zones.flatMap((zone) =>
    [zone.min, zone.max].filter((bound) => bound !== null),
  )
  return [...new Set(all)].sort((a, b) => a - b)
}

/** Cap on the precision added to a value that rounds onto a bound it does not equal. */
const MAX_EXTRA_VALUE_DECIMALS = 3

/** The first bound, other than `value` itself, that prints identically to `value` at `extra`. */
function collidingBound(
  bounds: number[],
  band: ReferenceBand,
  value: number,
  extra: number,
): number | undefined {
  const printed = formatBandNumber(value, band.unit, extra)
  return bounds.find(
    (bound) =>
      bound !== value && formatBandNumber(bound, band.unit, extra) === printed,
  )
}

/**
 * The measured value with its unit, at the band's source precision — plus just enough extra
 * precision that it never prints identically to a bound it does not equal. Without that, a cadence
 * of 163.5 prints as `164`, which reads as inside `164–173` while the value is in the gap before it.
 *
 * The added precision is capped at {@link MAX_EXTRA_VALUE_DECIMALS} digits. A value so close to a
 * bound that it still prints as that bound at the cap is stated relative to the bound instead —
 * `just under 164 steps/min` — which is true, where `164.000 steps/min` would contradict the
 * sentence placing it in the gap below 164.
 */
export function formatMeasuredBandValue(
  band: ReferenceBand,
  value: number,
  style: BandTextStyle = 'visual',
): string {
  const bounds = bandBounds(band)
  for (let extra = 0; extra <= MAX_EXTRA_VALUE_DECIMALS; extra++) {
    if (collidingBound(bounds, band, value, extra) === undefined) {
      return formatBandValue(value, band.unit, extra, style)
    }
  }
  const bound = collidingBound(bounds, band, value, MAX_EXTRA_VALUE_DECIMALS)!
  return `${value < bound ? 'just under' : 'just over'} ${formatBandValue(bound, band.unit, 0, style)}`
}

/** A zone label as it reads mid-sentence: `30th–69th percentile`, `below the 5th percentile`. */
function lowercaseLead(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/**
 * The plural of a zone label's head noun, for a headline naming two zones at once: `percentile` →
 * `percentiles`.
 *
 * The only tail any shipped band's labels share is "percentile", so this is a bare `+ 's'` rather
 * than an English pluraliser — and it is only ever reached when two labels already share that tail
 * word for word, which is a strong signal they are the same noun. A tail that pluralises otherwise
 * would need a rule, and would be better served by {@link describeBandPositionBriefly}'s quoted
 * fallback than by guessing.
 */
function pluralise(word: string): string {
  return word.endsWith('s') ? word : `${word}s`
}

/**
 * The card headline's position fragment — `30th–69th percentile of Garmin's runners`,
 * `between the 5th–29th and 30th–69th percentiles of Garmin's runners`, `below the range shown`.
 *
 * A compression of {@link describeBandPosition}, which stays the text alternative for the drawn
 * scale and is unchanged: this one drops the value (the headline prints it beside this fragment),
 * the zone's own bounds (the scale prints its outer ones) and the sentence's punctuation.
 *
 * Three shapes, and the rules for each:
 *
 * - **In a zone of a multi-zone band** — the zone's own label, lowercased so it reads mid-sentence,
 *   plus `band.zoneOwner` where the labels do not already name whose zones they are.
 * - **A single-range band** — `within` / `below` / `above the range shown`, never the range's own
 *   label: `verticalOscillationCm`'s is a 90-character sentence naming two percentiles of two sexes.
 *   A single range is also where `outside` says the least, since there is one range to be outside of.
 * - **In a published gap** — both zones named. Where their labels share a tail word for word
 *   (`percentile of Garmin's table`) the heads are merged and the tail stated once, pluralised,
 *   which is what keeps the fragment to one line. Where they do not, both labels are quoted whole:
 *   no rule should depend on two labels happening to rhyme.
 *
 * Never a verdict, exactly like `describeBandPosition`: every shape is a position.
 */
export function describeBandPositionBriefly(
  band: ReferenceBand,
  value: number,
): string {
  const owner = band.zoneOwner === null ? '' : ` ${band.zoneOwner}`
  const singleRange = band.zones.length === 1
  const position = locateInBand(band, value)
  switch (position.kind) {
    case 'inZone':
      return singleRange
        ? 'within the range shown'
        : `${lowercaseLead(position.zone.label)}${owner}`
    case 'outside':
      return `${position.side} the range shown`
    case 'betweenZones': {
      const split = (zone: BandZone) => {
        const at = zone.label.indexOf(' ')
        return at === -1
          ? { head: zone.label, tail: '' }
          : { head: zone.label.slice(0, at), tail: zone.label.slice(at + 1) }
      }
      const lower = split(position.lower)
      const upper = split(position.upper)
      if (lower.tail === '' || lower.tail !== upper.tail) {
        return `between “${position.lower.label}” and “${position.upper.label}”`
      }
      const at = lower.tail.indexOf(' ')
      const noun = at === -1 ? lower.tail : lower.tail.slice(0, at)
      const rest = at === -1 ? '' : lower.tail.slice(at)
      return `between the ${lowercaseLead(lower.head)} and ${lowercaseLead(upper.head)} ${pluralise(noun)}${rest}${owner}`
    }
  }
}

/** `(values from 164 to 173 steps per minute)`, `(values below 153 steps per minute)`. */
function spokenZoneValues(zone: BandZone, band: ReferenceBand): string {
  if (zone.min === null && zone.max === null) return '(any value)'
  const range = formatBandRange(zone.min, zone.max, band.unit, 'spoken')
  return zone.min !== null && zone.max !== null
    ? `(values from ${range})`
    : `(values ${range})`
}

/**
 * One sentence stating where the value sits, e.g. `172 steps per minute falls in the zone labelled
 * “30th–69th percentile” (values from 164 to 173 steps per minute).`
 *
 * In the spoken style throughout, because this sentence is the text alternative for the drawn
 * scale. Names a zone only by its label and its values, and the band as a whole only as "the
 * range shown" — never as "published" or "reference": a derived band's bounds or labels are this
 * app's arithmetic on published numbers, and saying "published" of them would claim an authorship
 * the source never had.
 *
 * A value in a gap names the two numbers the gap runs between, taken from the zones themselves and
 * each stated with its unit ("from 3.70% to 3.75%"): a bare "3.70 to 3.75" after "3.72%" leaves the
 * reader to guess the two are the same kind of number. For a band that is not derived those are the
 * source's own printed bounds, so the sentence says the source's table jumps; for a derived band
 * they are this app's arithmetic, so it says the range shown jumps instead.
 */
export function describeBandPosition(
  band: ReferenceBand,
  value: number,
): string {
  const measured = formatMeasuredBandValue(band, value, 'spoken')
  // `just under 164 …` opens a sentence here, so it takes a capital; a number is unaffected.
  const valueText = measured.charAt(0).toUpperCase() + measured.slice(1)
  const position = locateInBand(band, value)
  const zoneRef = (zone: BandZone) =>
    `“${zone.label}” ${spokenZoneValues(zone, band)}`
  switch (position.kind) {
    case 'inZone':
      return `${valueText} falls in the ${band.zones.length === 1 ? 'range' : 'zone'} labelled ${zoneRef(position.zone)}.`
    case 'betweenZones': {
      // Non-null by construction: a zone only ends below a value through a finite `max`, and only
      // starts above one through a finite `min` (`endBefore`, `startAfter`).
      const from = formatBandValue(position.lower.max!, band.unit, 0, 'spoken')
      const to = formatBandValue(position.upper.min!, band.unit, 0, 'spoken')
      const table =
        band.derivation === null ? "the source's table" : 'the range shown'
      return `${valueText} sits in the gap between the zones labelled “${position.lower.label}” and “${position.upper.label}”; ${table} jumps from ${from} to ${to}.`
    }
    case 'outside': {
      const envelope = referenceBandEnvelope(band)
      return envelope !== null
        ? `${valueText} is ${position.side} the range shown (${formatBandRange(envelope.min, envelope.max, band.unit, 'spoken')}).`
        : `${valueText} is ${position.side} the range shown, which ${position.side === 'below' ? 'starts' : 'ends'} at ${formatBandValue(position.nearestBound, band.unit, 0, 'spoken')}.`
    }
  }
}
