import {
  bandBounds,
  describeBandPosition,
  formatMeasuredBandValue,
} from './bandPosition'
import {
  formatBandNumber,
  formatBandRange,
  toDisplayNumber,
} from './formatBandValue'
import { referenceBandEnvelope } from './types'
import type { BandZone, ReferenceBand } from './types'

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
 * The narrowest track bound labels are laid out for, in px. Rows are assigned by checking overlap
 * at this width, which is sufficient for every wider track: under `anchorAt`, the space between
 * two labels only grows as the track widens (see `staggerRows`). A 390 px viewport gives the
 * banded card's track about 314 px.
 */
const BOUND_LABEL_MIN_TRACK_PX = 280
/** A deliberately generous width for one 11 px character, so an estimate errs toward a new row. */
const BOUND_LABEL_CHAR_PX = 7
/** Clear space kept between two labels in one row at the narrowest track, in px. */
const BOUND_LABEL_GAP_PX = 2
/** Height of one row of bound labels, in rem (`leading-4`). */
const BOUND_LABEL_ROW_REM = 1
/**
 * A published gap no wider than this, in DISPLAYED units (1 step/min, 1 percentage point, 1 cm,
 * 1°), prints its two bounds as one label — `163/164` — because two labels a fraction of a unit
 * apart sit on top of each other at any track width, and restacking them into rows reads as two
 * unrelated numbers. Both ticks still draw, and the gap between them is hatched.
 */
const GAP_LABEL_MERGE_MAX_DISPLAY_UNITS = 1

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

/** One printed label under the track: a single bound, or the two bounds of a narrow gap. */
interface BoundLabel {
  text: string
  /** Where the label is anchored, in percent along the track. */
  percent: number
}

/** Adjacent zones that leave a gap — the lower one's `max` below the upper one's `min`. */
function gapsBetween(zones: BandZone[]): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = []
  for (let i = 1; i < zones.length; i++) {
    const from = zones[i - 1].max
    const to = zones[i].min
    if (from !== null && to !== null && from < to) gaps.push({ from, to })
  }
  return gaps
}

/**
 * The labels printed under the track: one per distinct bound, except that the two bounds of a gap
 * no wider than {@link GAP_LABEL_MERGE_MAX_DISPLAY_UNITS} share one label, centred on the gap.
 */
function boundLabels(
  band: ReferenceBand,
  bounds: number[],
  domain: Domain,
): BoundLabel[] {
  const narrowGaps = gapsBetween(band.zones).filter(
    ({ from, to }) =>
      toDisplayNumber(to, band.unit) - toDisplayNumber(from, band.unit) <=
      GAP_LABEL_MERGE_MAX_DISPLAY_UNITS,
  )
  const labels: BoundLabel[] = []
  for (let i = 0; i < bounds.length; i++) {
    const gap = narrowGaps.find(
      ({ from, to }) => from === bounds[i] && to === bounds[i + 1],
    )
    if (gap !== undefined) {
      labels.push({
        text: `${formatBandNumber(gap.from, band.unit)}/${formatBandNumber(gap.to, band.unit)}`,
        percent: (toPercent(domain, gap.from) + toPercent(domain, gap.to)) / 2,
      })
      i++
    } else {
      labels.push({
        text: formatBandNumber(bounds[i], band.unit),
        percent: toPercent(domain, bounds[i]),
      })
    }
  }
  return labels
}

/**
 * Greedy row assignment for labels in ascending position: each label takes the first row whose
 * last label ends at least {@link BOUND_LABEL_GAP_PX} before it starts, opening a new row when none
 * does. Bounded: at most one row per label.
 *
 * Overlap is checked at {@link BOUND_LABEL_MIN_TRACK_PX} with each label's estimated width, under
 * `anchorAt`'s placement (left edge at `percent × (track − width)`). For labels at `p_a < p_b` the
 * space between them is `p_b(T − w_b) − p_a(T − w_a) − w_a`, whose slope in the track width `T` is
 * `p_b − p_a > 0` — so a pair clear at the narrowest track stays clear at every wider one.
 */
function staggerRows(labels: BoundLabel[]): number[] {
  const rowEnds: number[] = []
  return labels.map(({ text, percent }) => {
    const width = text.length * BOUND_LABEL_CHAR_PX
    const left = (percent / 100) * (BOUND_LABEL_MIN_TRACK_PX - width)
    let row = rowEnds.findIndex((end) => left - end >= BOUND_LABEL_GAP_PX)
    if (row === -1) row = rowEnds.length
    rowEnds[row] = left + width
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

/**
 * A published gap is hatched rather than left as bare track, so it reads as "not covered by the
 * table" instead of as a thin extra zone. Drawn in `currentColor`, so forced colours restate it by
 * restating the text colour.
 */
const GAP_HATCH = 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 3px)'

/** Zones alternate two neutral tints: distinguishable, and with no order that could read as a grade. */
const ZONE_TINTS = [
  'bg-neutral-300 dark:bg-neutral-600',
  'bg-neutral-400 dark:bg-neutral-500',
]

/**
 * Where one measured value sits against one cited reference band.
 *
 * Draws the band's zones on a neutral track, a tick at every zone bound with its number printed
 * beneath (the number only — the unit is stated once, in the value label and the zone list, because
 * `153 steps/min` at every tick would overprint; a one-unit published gap prints its two bounds as
 * one `163/164` label over a hatched sliver), and a marker at the measured value. It states the
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
 * ticks, zone edges and gap hatching, and `Highlight` for the marker, ringed in `Canvas` so it
 * stays distinct from a tick it overlaps.
 *
 * The marker is black (white in dark mode), not the brand colour: brand is reserved for interactive
 * elements, and the marker is not one. It is told apart from a tick by its width, its overhang above
 * and below the track, and its ring. The text around the track is left to the browser's own adjustment.
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
        className="metric-scale__zones space-y-0.5 text-xs leading-snug text-neutral-700 dark:text-neutral-300"
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
  const labels = boundLabels(band, bounds, domain)
  const rows = staggerRows(labels)
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
        {gapsBetween(band.zones).map(({ from, to }) => {
          const left = toPercent(domain, from)
          const right = toPercent(domain, to)
          return (
            <div
              key={`gap:${from}:${to}`}
              className="metric-scale__gap absolute inset-y-0 text-neutral-500 dark:text-neutral-400 forced-colors:text-[CanvasText]"
              style={{
                left: `${left}%`,
                width: `${right - left}%`,
                backgroundImage: GAP_HATCH,
              }}
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
          className="metric-scale__marker absolute -inset-y-1.5 w-1.5 bg-black ring-1 ring-white dark:bg-white dark:ring-black forced-colors:bg-[Highlight] forced-colors:ring-[Canvas]"
          style={anchorAt(valuePercent)}
          data-clamped={domain.clamped ?? undefined}
        />
      </div>

      <div
        className="relative mt-1 text-[11px] leading-4 text-neutral-700 dark:text-neutral-300"
        style={{ height: `${rowCount * BOUND_LABEL_ROW_REM}rem` }}
      >
        {labels.map((label, index) => (
          <span
            key={label.text}
            className="metric-scale__bound-label absolute whitespace-nowrap"
            style={{
              ...anchorAt(label.percent),
              top: `${rows[index] * BOUND_LABEL_ROW_REM}rem`,
            }}
            data-row={rows[index]}
          >
            {label.text}
          </span>
        ))}
      </div>
    </div>
  )
}
