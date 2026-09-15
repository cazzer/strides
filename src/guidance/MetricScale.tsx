import {
  bandBounds,
  describeBandPosition,
  formatMeasuredBandValue,
} from './bandPosition'
import { formatBandNumber, formatBandRange } from './formatBandValue'
import { referenceBandEnvelope } from './types'
import type { ReferenceBand } from './types'

/**
 * # Presentational layout constants — NOT reference claims
 *
 * These decide how much empty track surrounds the band's numbers. None of them is a statement
 * about runners, none is printed, and none may ever be: the only numbers this component prints are
 * the band's zone bounds and the runner's measured value. Labelling the scale's ends would put an
 * invented number beside cited ones, which is the one thing `src/guidance/` exists not to do
 * (design.md D1).
 *
 * The domain is the band's envelope (`referenceBandEnvelope`) padded on each side, so that an
 * open-ended zone (cadence's `<153`, `>183`) has visible width and a value just outside a closed
 * band is not pinned to the edge. It then widens to include the measured value when that value lies
 * within {@link DOMAIN_MAX_EXTENSION_FRACTION} envelope-widths beyond the padded edge — or within
 * {@link VALUE_MARGIN_FRACTION} inside it — keeping that margin between the value and the edge, so
 * an unclamped marker never sits on the edge and reads as clamped. Beyond that the marker clamps,
 * and the text says so.
 */
/** Padding beyond each end of the envelope, as a fraction of the envelope's width. */
const DOMAIN_PADDING_FRACTION = 0.25
/** How far past the padded edge the domain may grow to include the value, in envelope-widths. */
const DOMAIN_MAX_EXTENSION_FRACTION = 1
/** Space kept between the domain's edge and an unclamped value, in envelope-widths. */
const VALUE_MARGIN_FRACTION = 0.05
/**
 * Bound labels closer than this (percent of track width) never share a row. At a 280 px track a
 * four-character label (`3.05`) at 11 px needs about 10 % to clear its neighbour, whatever the
 * anchoring; `MetricScale.test.tsx` checks the pixel arithmetic on the tightest shipped case.
 */
const BOUND_LABEL_MIN_SEPARATION_PERCENT = 12
/** Height of one row of bound labels, in rem (`leading-4`). */
const BOUND_LABEL_ROW_REM = 1

export interface MetricScaleProps {
  /** The cited band. Every bound is in `value`'s own computed domain (see `ReferenceBand`). */
  band: ReferenceBand
  /** The measured value, in the same domain as the band's bounds — no conversion. */
  value: number
  /** The metric's display name. Prefixes the caption for assistive technology; not rendered visibly. */
  label: string
}

type Side = 'below' | 'above'

interface Domain {
  min: number
  max: number
  /** Non-null when the value lies beyond the domain and its marker is pinned to an edge. */
  clamped: Side | null
}

function scaleDomain(
  envelope: { min: number; max: number },
  value: number,
): Domain {
  const width = envelope.max - envelope.min
  const paddedMin = envelope.min - width * DOMAIN_PADDING_FRACTION
  const paddedMax = envelope.max + width * DOMAIN_PADDING_FRACTION
  const reach = width * DOMAIN_MAX_EXTENSION_FRACTION
  const margin = width * VALUE_MARGIN_FRACTION
  let min = paddedMin
  let max = paddedMax
  let clamped: Side | null = null
  if (value < paddedMin + margin) {
    if (value >= paddedMin - reach) min = value - margin
    else clamped = 'below'
  } else if (value > paddedMax - margin) {
    if (value <= paddedMax + reach) max = value + margin
    else clamped = 'above'
  }
  return { min, max, clamped }
}

/** Percent along the track, clamped to the track. */
function toPercent(domain: Domain, value: number): number {
  const percent = ((value - domain.min) / (domain.max - domain.min)) * 100
  return Math.min(100, Math.max(0, percent))
}

/**
 * Greedy row assignment for ascending label positions: each label takes the first row whose last
 * label is at least {@link BOUND_LABEL_MIN_SEPARATION_PERCENT} behind it, opening a new row when
 * none is. Spacing is checked within every row, so no two labels in one row overprint. Bounded: at
 * most one row per label.
 */
function staggerRows(percents: number[]): number[] {
  const lastInRow: number[] = []
  return percents.map((percent) => {
    let row = lastInRow.findIndex(
      (last) => percent - last >= BOUND_LABEL_MIN_SEPARATION_PERCENT,
    )
    if (row === -1) row = lastInRow.length
    lastInRow[row] = percent
    return row
  })
}

/**
 * Anchors an absolutely-positioned element at `percent` along its container while keeping it
 * inside the container: the element's own anchor point slides from its left edge (at 0%) to its
 * right edge (at 100%), so a label or marker at either end never overflows the track.
 */
function anchorAt(percent: number) {
  return { left: `${percent}%`, transform: `translateX(-${percent}%)` }
}

/** Zones alternate two neutral tints: distinguishable, and with no order that could read as a grade. */
const ZONE_TINTS = [
  'bg-neutral-300 dark:bg-neutral-600',
  'bg-neutral-400 dark:bg-neutral-500',
]

/**
 * Where one measured value sits against one cited reference band.
 *
 * Draws the band's zones on a neutral track, a tick and a printed number at every zone bound (the
 * number only — the unit is stated once, in the value label and the zone list, because
 * `153 steps/min` at every tick would overprint), and a marker at the measured value. It states the
 * same facts in text, because a position communicated only by pixel offset communicates nothing to
 * a screen reader. Which zone a value is in, and the words for it, come from `bandPosition.ts`, so
 * every view says the same thing. The graphic is `aria-hidden` and keeps the compact visual forms
 * (`164–173`, `steps/min`); the caption — which names the `<figure>` natively, with no
 * `aria-labelledby` repeating it — and the zone list use the spoken forms (`164 to 173 steps per
 * minute`) and carry the value, its unit, every bound and the position.
 *
 * It grades nothing. A band is where a measured population fell, not where a runner should be, so
 * there is no hue scale, no preferred end, and no word judging the value — only "falls in",
 * "between", "below", "above". `centralTendency` is deliberately not drawn: a mark at the mean on a
 * scale reads as a goal however it is styled.
 *
 * ## Forced colours
 *
 * Every mark on the track is a coloured `div`, and Windows High Contrast replaces backgrounds with
 * the page colour — ticks, zones and the marker would all vanish. So the track opts out of forced
 * colour adjustment and restates each mark in system colours: `Canvas` ground, `CanvasText` border,
 * ticks and zone edges, and `Highlight` for the marker, ringed in `Canvas` so it stays distinct from
 * a tick it overlaps. The text around the track is left to the browser's own adjustment.
 */
export function MetricScale({ band, value, label }: MetricScaleProps) {
  // A band with no extent to draw (none ships) has no scale; its text still renders.
  const envelope = referenceBandEnvelope(band)
  const domain = envelope !== null ? scaleDomain(envelope, value) : null
  const valueText = formatMeasuredBandValue(band, value)
  let sentence = describeBandPosition(band, value)
  if (domain?.clamped) {
    // Scale-specific, so not in `describeBandPosition`: only a drawn scale has an end to pass.
    sentence += ` It lies beyond the ${domain.clamped === 'below' ? 'lower' : 'upper'} end of the drawn scale, so its marker is pinned at that end.`
  }
  const multiZone = band.zones.length > 1

  return (
    <figure className="metric-scale m-0 w-full min-w-0 space-y-2 font-sans">
      <figcaption className="metric-scale__position text-sm text-neutral-900 dark:text-neutral-100">
        <span className="sr-only">{label}:</span> {sentence}
      </figcaption>

      {domain !== null && (
        <MetricScaleGraphic
          band={band}
          bounds={bandBounds(band)}
          domain={domain}
          value={value}
          valueText={valueText}
        />
      )}

      <ul
        role="list"
        className="metric-scale__zones space-y-0.5 text-[11px] leading-snug text-neutral-700 dark:text-neutral-300"
        aria-label={
          multiZone ? 'Reference zones, lowest value first' : 'Reference range'
        }
      >
        {band.zones.map((zone) => (
          <li
            key={`${zone.min}:${zone.max}`}
            className="metric-scale__zone-item"
          >
            <span className="font-semibold">
              {formatBandRange(zone.min, zone.max, band.unit, 'spoken')}
            </span>
            {': '}
            {zone.label}
          </li>
        ))}
      </ul>
    </figure>
  )
}

function MetricScaleGraphic({
  band,
  bounds,
  domain,
  value,
  valueText,
}: {
  band: ReferenceBand
  bounds: number[]
  domain: Domain
  value: number
  valueText: string
}) {
  const valuePercent = toPercent(domain, value)
  const boundPercents = bounds.map((bound) => toPercent(domain, bound))
  const rows = staggerRows(boundPercents)
  const rowCount = Math.max(1, ...rows.map((row) => row + 1))

  return (
    <div className="metric-scale__graphic w-full" aria-hidden="true">
      <div className="relative h-5">
        <span
          className="metric-scale__value-label absolute top-0 whitespace-nowrap font-display text-sm font-bold leading-5"
          style={anchorAt(valuePercent)}
        >
          {domain.clamped === 'below' && '◂ '}
          {valueText}
          {domain.clamped === 'above' && ' ▸'}
        </span>
      </div>

      <div className="metric-scale__track relative h-5 border-2 border-black bg-white dark:border-white dark:bg-neutral-950 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:forced-color-adjust-none">
        {band.zones.map((zone, index) => {
          const left = toPercent(domain, zone.min ?? domain.min)
          const right = toPercent(domain, zone.max ?? domain.max)
          return (
            <div
              key={`${zone.min}:${zone.max}`}
              className={`metric-scale__zone absolute inset-y-0 ${ZONE_TINTS[index % ZONE_TINTS.length]} forced-colors:border-x forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]`}
              style={{ left: `${left}%`, width: `${right - left}%` }}
            />
          )
        })}
        {boundPercents.map((percent, index) => (
          <div
            key={bounds[index]}
            className="metric-scale__tick absolute inset-y-0 w-px bg-black dark:bg-white forced-colors:bg-[CanvasText]"
            style={anchorAt(percent)}
          />
        ))}
        <div
          className="metric-scale__marker absolute -inset-y-1.5 w-1.5 bg-brand-700 ring-1 ring-white dark:bg-brand-400 dark:ring-black forced-colors:bg-[Highlight] forced-colors:ring-[Canvas]"
          style={anchorAt(valuePercent)}
          data-clamped={domain.clamped ?? undefined}
        />
      </div>

      <div
        className="relative mt-1 text-[11px] leading-4 text-neutral-700 dark:text-neutral-300"
        style={{ height: `${rowCount * BOUND_LABEL_ROW_REM}rem` }}
      >
        {boundPercents.map((percent, index) => (
          <span
            key={bounds[index]}
            className="metric-scale__bound-label absolute whitespace-nowrap"
            style={{
              ...anchorAt(percent),
              top: `${rows[index] * BOUND_LABEL_ROW_REM}rem`,
            }}
            data-row={rows[index]}
          >
            {formatBandNumber(bounds[index], band.unit)}
          </span>
        ))}
      </div>
    </div>
  )
}
