import {
  bandBounds,
  describeBandPosition,
  formatMeasuredBandValue,
} from './bandPosition'
import { formatBandNumber, formatBandRange } from './formatBandValue'
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

export interface MetricScaleProps {
  /** The cited band. Every bound is in `value`'s own computed domain (see `ReferenceBand`). */
  band: ReferenceBand
  /** The measured value, in the same domain as the band's bounds — no conversion. */
  value: number
  /** The metric's display name. Prefixes the caption for assistive technology; not rendered visibly. */
  label: string
  /**
   * The track and its marker only, for a row that already states the value and its position in
   * words beside it (the results summary). Decorative and `aria-hidden`: no printed number, no scope
   * line, no legend and no text alternative, because the row's own text is that alternative.
   */
  compact?: boolean
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

/** What a hatched span is, in the one wording the legend and the zone list both use. */
const GAP_MEANING = "not in the source's table"

/**
 * The band's zones and its published gaps, in value order, for the text alternative.
 *
 * A gap is drawn as hatching and hatching is invisible to a screen reader, so a reader who cannot
 * see the track met a list that jumped from `up to 163` to `164 to 173` with nothing saying the two
 * numbers between them are uncovered rather than merely unmentioned. Gaps are appended
 * unconditionally: a band with none contributes none, which is the same list as before.
 */
function zoneListEntries(
  band: ReferenceBand,
): { key: string; range: string; label: string }[] {
  const entries = band.zones.map((zone) => ({
    key: `zone:${zone.min}:${zone.max}`,
    range: formatBandRange(zone.min, zone.max, band.unit, 'spoken'),
    label: zone.label,
    at: zone.min ?? Number.NEGATIVE_INFINITY,
  }))
  const gaps = gapsBetween(band.zones).map(({ from, to }) => ({
    key: `gap:${from}:${to}`,
    range: formatBandRange(from, to, band.unit, 'spoken'),
    label: GAP_MEANING,
    at: from,
  }))
  return [...entries, ...gaps]
    .sort((a, b) => a.at - b.at)
    .map(({ key, range, label }) => ({ key, range, label }))
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
const GAP_HATCH =
  'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 3px)'

/**
 * The three shading steps, fewest runners first. Paired light/dark utilities because the ordering
 * genuinely inverts: on a near-black track the most-populated zone has to be the BRIGHTEST to clear
 * its contrast floor against the track. Defined and computed in `src/index.css`, whose comment
 * carries the measured ratios.
 *
 * `forced-colors:bg-none` goes with every use: these are backgrounds, and Windows High Contrast
 * replaces backgrounds with the page colour, so the shading is dropped rather than left half-applied
 * — the seams and the marker are what survive, in system colours.
 */
const ZONE_SHADES = [
  'bg-scale-zone-1 dark:bg-scale-zone-1-dark',
  'bg-scale-zone-2 dark:bg-scale-zone-2-dark',
  'bg-scale-zone-3 dark:bg-scale-zone-3-dark',
]

/**
 * A single published range: ONE flat step, the same one a most-populated zone gets.
 *
 * It was a symmetric ramp — zone-2 easing to zone-3 across the middle and back — and that is the
 * universal "optimal range" idiom: a unimodal hump reads as a distribution with a preferred centre.
 * Every band drawn this way publishes `shareOfRunners: null` on its one zone, and
 * `verticalOscillationCm`'s own derivation says in so many words that *no percentile of the combined
 * cohort is claimed* — so the picture was asserting exactly what the words beside it disclaimed, and
 * on the three cards that render no legend to correct it. Flat says the one true thing: this span is
 * the range, and nothing is known about where inside it runners fall.
 */
const SINGLE_RANGE_SHADE = ZONE_SHADES[ZONE_SHADES.length - 1]

/**
 * One shading step per zone, by how many runners the source's table puts in it: the zone with the
 * largest published share is shaded most heavily, and zones with equal shares identically.
 *
 * The step is the share's RANK among the distinct shares, not the share itself. Garmin's
 * `[0.05, 0.25, 0.40, 0.25, 0.05]` has three distinct values and maps to `[0, 1, 2, 1, 0]` —
 * symmetric, which is the point: the two tails are equally rare and must be drawn identically.
 * Mapping the share onto an opacity instead would make a 5% zone nearly invisible and would imply a
 * continuum the source does not publish.
 *
 * `null` when any zone's share is missing. A share is all-or-none per band by construction, so this
 * is unreachable on shipped data; a renderer reaching it shades every zone at one step and draws no
 * legend, because claiming a distribution the source does not publish is the one thing this scale
 * may not do.
 */
function shadeSteps(zones: BandZone[]): number[] | null {
  const shares = zones.map((zone) => zone.shareOfRunners)
  if (shares.some((share) => share === null)) return null
  const distinct = [...new Set(shares as number[])].sort((a, b) => a - b)
  const top = ZONE_SHADES.length - 1
  return (shares as number[]).map((share) =>
    distinct.length === 1
      ? top
      : Math.round((distinct.indexOf(share) / (distinct.length - 1)) * top),
  )
}

/**
 * Where one measured value sits against one cited reference band.
 *
 * Draws the band's zones on a track, shaded by how many runners the source puts in each; a seam at
 * every zone bound; and a marker at the measured value. It states the same facts in text, because a
 * position communicated only by pixel offset communicates nothing to a screen reader. Which zone a
 * value is in, and the words for it, come from `bandPosition.ts`, so every view says the same thing.
 * The graphic is `aria-hidden` and keeps the compact visual forms (`164–173`, `steps/min`); the
 * caption — which names the `<figure>` natively, with no `aria-labelledby` repeating it — and the
 * zone list use the spoken forms (`164 to 173 steps per minute`) and carry the value, its unit,
 * every bound and the position.
 *
 * ## Exactly three printed numbers
 *
 * The band's lowest bound, its highest bound, and the measured value. **Every interior bound is an
 * unlabelled seam**, and no bound is withheld: the zone list beneath prints all of them, with their
 * units, in the spoken form. Printing a number at every boundary stacked labels a fraction of a unit
 * apart into rows that read as unrelated numbers — cadence's `163` and `164` sat on top of each
 * other at every track width — which costs the reader more than it tells them.
 *
 * ## The shading is a population, not a grade
 *
 * One hue family, three steps, darkest (light) / brightest (dark) = **most runners**, with a legend
 * saying which. That restates in shade exactly what the zone labels state in words, and it is the
 * one ordering available that is not a judgement: a runner in the darkest zone is in the most common
 * zone. Most is not best. There is no preferred end, no second hue, none of the forbidden
 * pass/fail colours, and no brand colour, which is reserved for interactive elements.
 * `centralTendency` is still not drawn: a mark at the mean reads as a goal however it is styled.
 *
 * **A band publishing one range is drawn FLAT**, at that same one step, and says so in words in the
 * legend's slot: the range's own label. A ramp across it — however styled — is a shape, and a
 * symmetric hump is the shape readers already know as "the optimal range". These are exactly the
 * bands whose one zone carries `shareOfRunners: null`, i.e. the bands whose source publishes no
 * distribution at all.
 *
 * ## Forced colours
 *
 * Every mark on the track is a coloured `div`, and Windows High Contrast replaces backgrounds with
 * the page colour — seams, zones and the marker would all vanish. So the track opts out of forced
 * colour adjustment and restates each mark in system colours: `Canvas` ground, `CanvasText` border,
 * seams, zone edges and gap hatching, and `Highlight` for the marker, ringed in `Canvas` so it stays
 * distinct from a seam it overlaps. The shading itself is dropped (`forced-colors:bg-none`) and the
 * clause of the legend that explains it is hidden, because neither survives a palette the user chose.
 * The clause naming what HATCHING means is not hidden — hatching is `currentColor` and survives —
 * and neither is a single range's label, which is a fact about the band rather than about paint.
 *
 * The marker is near-black (near-white in dark mode), not the brand colour. It is told apart from a
 * seam by its width, its overhang above and below the track, and its ring. The text around the track
 * is left to the browser's own adjustment.
 */
export function MetricScale({ band, value, label, compact = false }: MetricScaleProps) {
  // A band with no extent to draw (none ships) has no scale; its text still renders.
  const envelope = referenceBandEnvelope(band)
  const domain = envelope !== null ? scaleDomain(envelope, value) : null
  if (compact) {
    return domain === null ? null : (
      <div className="metric-scale metric-scale--compact w-full min-w-0" aria-hidden="true">
        <ScaleTrack band={band} bounds={bandBounds(band)} domain={domain} value={value} compact />
      </div>
    )
  }
  const valueText = formatMeasuredBandValue(band, value)
  let sentence = describeBandPosition(band, value)
  if (domain?.clamped) {
    // Scale-specific, so not in `describeBandPosition`: only a drawn scale has an end to pass.
    sentence += ` It lies beyond the ${domain.clamped === 'below' ? 'lower' : 'upper'} end of the drawn scale, so its marker is pinned at that end.`
  }
  const multiZone = band.zones.length > 1

  return (
    <figure className="metric-scale m-0 w-full min-w-0 space-y-2 font-sans">
      {/*
        Screen-reader-only, and NOT because it is secondary: it is the whole text alternative for
        the drawn scale, and it still names the figure. It is not *visible* because the card's own
        headline states the same position in the band's own words, directly above — a sighted
        reader would meet the identical fact twice, in two wordings, before reaching the picture.
      */}
      <figcaption className="metric-scale__position sr-only">
        {label}: {sentence}
      </figcaption>

      <p className="metric-scale__scope text-xs font-semibold leading-4 text-neutral-700 dark:text-neutral-300">
        Observed, not a target
      </p>

      {envelope !== null && domain !== null && (
        <MetricScaleGraphic
          band={band}
          bounds={bandBounds(band)}
          domain={domain}
          envelope={envelope}
          value={value}
          valueText={valueText}
        />
      )}

      {/*
        Also screen-reader-only, and for the same reason plus one: the graphic prints the band's two
        outer bounds and draws a seam at every interior one, so this list is what carries the
        interior bounds, their units and their labels in text. A reader who can see the scale has
        them on the track; a reader who cannot has them here.
      */}
      <ul
        role="list"
        className="metric-scale__zones sr-only"
        aria-label={
          multiZone ? 'Observed zones, lowest value first' : 'Observed range'
        }
      >
        {zoneListEntries(band).map(({ key, range, label }) => (
          <li key={key} className="metric-scale__zone-item">
            <span className="font-semibold">{range}</span>
            {': '}
            {label}
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
  envelope,
  value,
  valueText,
}: {
  band: ReferenceBand
  bounds: number[]
  domain: Domain
  envelope: { min: number; max: number }
  value: number
  valueText: string
}) {
  const valuePercent = toPercent(domain, value)
  const steps = shadeSteps(band.zones)
  const singleRange = band.zones.length === 1
  const gaps = gapsBetween(band.zones)
  // What the SHADING means, which is a claim, so it renders only where the shading has one: more
  // than one zone, each with a published share. A single range's shading means nothing — that is
  // the point of drawing it flat — and its legend slot says what the range IS instead.
  const showsShading = !singleRange && steps !== null

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

      <ScaleTrack band={band} bounds={bounds} domain={domain} value={value} />

      <div className="relative mt-1 h-4 text-[11px] leading-4 text-neutral-700 dark:text-neutral-300">
        {[envelope.min, envelope.max].map((bound) => (
          <span
            key={bound}
            className="metric-scale__bound-label absolute whitespace-nowrap"
            style={anchorAt(toPercent(domain, bound))}
          >
            {formatBandNumber(bound, band.unit)}
          </span>
        ))}
      </div>

      {singleRange ? (
        /*
          The freed slot, now that a single range is flat: the range's OWN label. The headline can
          only say "within the range shown" — `describeBandPositionBriefly` refuses a label that is a
          90-character sentence naming two percentiles of two sexes — so without this the reader met
          "the range shown" and was never told whose range, or of what. No `forced-colors:hidden`,
          unlike the shading legend below: this is a fact about the band, true in any palette.
        */
        <p className="metric-scale__legend mt-1 text-xs leading-4 text-neutral-700 dark:text-neutral-300">
          {band.zones[0].label}
        </p>
      ) : (
        (showsShading || gaps.length > 0) && (
          <p className="metric-scale__legend mt-1 text-xs leading-4 text-neutral-700 dark:text-neutral-300">
            {showsShading && (
              <>
                {/* The ordering inverts between themes, so each theme states its own true
                    sentence — and forced colours drop the shading, so both go with it. */}
                <span className="dark:hidden forced-colors:hidden">
                  Darker = more runners
                </span>
                <span className="hidden dark:inline forced-colors:hidden">
                  Brighter = more runners
                </span>
              </>
            )}
            {gaps.length > 0 && (
              <>
                {/* The separator belongs to the clause before it, so forced colours leave the
                    hatching clause standing alone rather than behind a dangling middot. */}
                {showsShading && (
                  <span className="forced-colors:hidden">{' · '}</span>
                )}
                {/* Hatching is drawn in `currentColor` and SURVIVES forced colours, so unlike the
                    shading legend this clause stays true there and is not hidden. */}
                <span className="metric-scale__legend-gap">
                  hatched = {GAP_MEANING}
                </span>
              </>
            )}
          </p>
        )
      )}
    </div>
  )
}

/** The drawn track: zones shaded by share, published gaps hatched, a seam at every bound, the marker. */
function ScaleTrack({
  band,
  bounds,
  domain,
  value,
  compact = false,
}: {
  band: ReferenceBand
  bounds: number[]
  domain: Domain
  value: number
  compact?: boolean
}) {
  const valuePercent = toPercent(domain, value)
  const boundPercents = bounds.map((bound) => toPercent(domain, bound))
  const steps = shadeSteps(band.zones)
  const singleRange = band.zones.length === 1
  return (
    <div className={`metric-scale__track relative ${compact ? 'h-3' : 'h-5'} border-2 border-scale-mark bg-scale-track dark:border-scale-mark-dark dark:bg-scale-track-dark forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:forced-color-adjust-none`}>
      {band.zones.map((zone, index) => {
        const left = toPercent(domain, zone.min ?? domain.min)
        const right = toPercent(domain, zone.max ?? domain.max)
        const shade = singleRange
          ? SINGLE_RANGE_SHADE
          : ZONE_SHADES[steps === null ? 1 : steps[index]]
        return (
          <div
            key={`${zone.min}:${zone.max}`}
            className={`metric-scale__zone absolute inset-y-0 ${shade} forced-colors:border-x forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:bg-none`}
            style={{ left: `${left}%`, width: `${right - left}%` }}
            data-shade={singleRange ? 'range' : (steps?.[index] ?? null)}
          />
        )
      })}
      {gapsBetween(band.zones).map(({ from, to }) => {
        const left = toPercent(domain, from)
        const right = toPercent(domain, to)
        return (
          <div
            key={`gap:${from}:${to}`}
            className="metric-scale__gap absolute inset-y-0 text-scale-hatch dark:text-scale-hatch-dark forced-colors:text-[CanvasText]"
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
          className="metric-scale__seam absolute inset-y-0 w-px bg-scale-mark dark:bg-scale-mark-dark forced-colors:bg-[CanvasText]"
          style={anchorAt(percent)}
        />
      ))}
      <div
        className={`metric-scale__marker absolute ${compact ? '-inset-y-1 w-1' : '-inset-y-1.5 w-1.5'} bg-scale-mark ring-2 ring-scale-track dark:bg-scale-mark-dark dark:ring-scale-track-dark forced-colors:bg-[Highlight] forced-colors:ring-[Canvas]`}
        style={anchorAt(valuePercent)}
        data-clamped={domain.clamped ?? undefined}
      />
    </div>
  )
}
