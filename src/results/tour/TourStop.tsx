import type { ReactNode } from 'react'
import type { MetricId } from '../../heuristics/types'
import {
  CUE_PREFIX,
  NOTHING_TO_CHANGE,
  ONE_THING_LABEL,
  ONE_THING_UNCLEAR,
} from '../../guidance/feedbackPoints'
import type { OneThing } from '../../guidance/feedbackPoints'
import { readingHeadline } from '../../guidance/compositeReadings'
import { FOCUS_AREAS } from '../../guidance/focusAreas'
import type { FocusAreaId, TourStopId } from '../../guidance/focusAreas'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import { MetricScale } from '../../guidance/MetricScale'
import { BandLegend } from '../BandLegend'
import { FeedbackLine } from '../FeedbackLine'
import { guidedHeadlineParts } from '../formatGuidedValue'
import { joinList } from '../guidedGroups'
import type { GuidedEntry } from '../guidedGroups'
import { ExternalLink } from '../GuidedMetricCard'
import { METRIC_LABELS, confidenceLabel, metricTier } from '../metricConfidence'
import { SHORT_METRIC_LABELS, formatBounceDerivation, hasCompactBar } from '../summary/summaryLabels'
import type { CaptureHint, TourAreaStop } from './tourPlan'
import { tourStopDomId } from './tourPlan'

/**
 * A stop's section: at least the viewport below the session header and the tour's sticky bar, so
 * one stop at a time sits at the reading line. Below `lg` the section is a transparent slot of the
 * same height, its panel (`TOUR_PANEL_CLASS`) at the bottom: the runner shows through the slot's
 * top, which is the part of the screen the runner's drawing is framed in (`--rt-reserve`), and the
 * slot reaches the reading line while its panel is still low on the screen.
 *
 * The slot's top padding is the part of the drawing no panel may cover at rest (`--rt-draw-top` +
 * `--rt-clear`, `TOUR_BODY_CLASS`), so a panel taller than the room left below it is never capped:
 * it makes its slot taller than the screen and runs on below the fold, and the reader scrolls the
 * PAGE to read it (`strides-jet8`: no panel has a scroll of its own). The slot snaps by its start,
 * under the bar (`scroll-mt`), which puts a tall panel's top just below the figure's focus at rest;
 * for a slot no taller than the screen that is the same position as its end at the screen's foot.
 */
export const TOUR_STOP_CLASS =
  'runner-tour__stop flex min-h-[calc(100dvh_-_var(--motion-story-header-height,88px)_-_3.5rem)] scroll-mt-[calc(var(--motion-story-header-height,88px)_+_3.5rem)] flex-col justify-center gap-3 border-t-2 border-black py-10 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 max-lg:min-h-[calc(100dvh_-_var(--rt-top))] max-lg:scroll-mt-[var(--rt-top)] max-lg:snap-start max-lg:justify-end max-lg:first:snap-align-none max-lg:border-t-0 max-lg:pt-[calc(var(--rt-draw-top)_+_var(--rt-clear))] max-lg:pb-3 dark:border-white'
/**
 * A stop's content. At `lg` it has no box of its own (`contents`), so the section lays its content
 * out directly. Below `lg` it is the panel that scrolls over the runner: at least 85% opaque and
 * blurred, inside a frame, so its text keeps WCAG AA contrast over the runner's worst-case stroke
 * (`tourPanelContrast.test.ts`, which reads the opacity from this string).
 *
 * Its height is never capped and it never scrolls inside itself (`strides-jet8`): the slot's top
 * padding keeps it off the top of the runner's drawing at rest (`TOUR_STOP_CLASS`), and a longer
 * panel is read by scrolling the page. `noInnerScroll.test.ts` and `e2e/phonePageScroll.spec.ts`
 * fail if a cap or an inner scroll comes back.
 */
export const TOUR_PANEL_CLASS =
  'runner-tour__panel lg:contents max-lg:flex max-lg:flex-col max-lg:gap-3 max-lg:border-2 max-lg:border-black max-lg:bg-white/85 max-lg:p-4 max-lg:backdrop-blur-[3px] max-lg:dark:border-white max-lg:dark:bg-black/85'
const STOP_HEADING = 'font-display text-2xl font-bold tracking-tight max-lg:text-xl'
const VALUE_LABEL =
  'font-sans text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400'
const VALUE = 'font-display text-4xl font-bold tabular-nums leading-tight max-lg:text-3xl'
const SECONDARY_VALUE = 'font-display text-2xl font-bold tabular-nums leading-tight'
const DERIVATION = 'runner-tour__derivation font-sans text-sm text-neutral-600 dark:text-neutral-400'
const CONFIDENCE = 'font-sans text-sm text-neutral-700 dark:text-neutral-300'
const CITATION = 'feedback-line__citation font-sans text-xs text-neutral-600 dark:text-neutral-400'
const BUTTON =
  'inline-flex min-h-11 items-center justify-center border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black'

/** The short citation a cue's Try line is linked under: its metric's own recorded study. */
function cueSourceTitle(metric: MetricId, url: string): string {
  return METRIC_GUIDANCE[metric].remediation.find((link) => link.url === url)?.shortTitle ?? 'Source'
}

/** One studied option, verbatim from its metric's Try line, with the study it comes from. */
function CueLine({ metric, text, url }: { metric: MetricId; text: string; url: string }) {
  return (
    <p className="runner-tour__cue font-sans text-base text-neutral-900 dark:text-neutral-100">
      <span className="font-semibold">{CUE_PREFIX}</span> {text}
      <span className={CITATION}>
        {' · '}
        <ExternalLink url={url}>{cueSourceTitle(metric, url)}</ExternalLink>
      </span>
    </p>
  )
}

interface StopSectionProps {
  id: TourStopId
  heading: string
  children: ReactNode
}

/**
 * The shared frame: a labelled section the reading line, focus and `#tour-<id>` all select by its
 * `data-tour-stop`. Focusable by script only (`tabIndex -1`), so a fragment link can land on it.
 */
function StopSection({ id, heading, children }: StopSectionProps) {
  const domId = tourStopDomId(id)
  return (
    <section
      id={domId}
      data-tour-stop={id}
      tabIndex={-1}
      aria-labelledby={`${domId}-heading`}
      className={TOUR_STOP_CLASS}
    >
      <div className={TOUR_PANEL_CLASS}>
        <h3 id={`${domId}-heading`} className={STOP_HEADING}>
          {heading}
        </h3>
        {children}
      </div>
    </section>
  )
}

/**
 * Vertical ratio after the rhythm stop's prose, when the bounce reading is headed by it and the stop
 * is not (`strides-xki9` review round 1): its label, its value with the band position as visible
 * text, and its confidence when that is not normal. No bar (one per stop) and no "From" line (the
 * summary card carries it). Excluded from the word budget with the value line: a name and numbers.
 */
function SecondaryValue({ entry }: { entry: GuidedEntry }) {
  const parts = guidedHeadlineParts(entry, { standalone: true })
  return (
    <div className="runner-tour__value runner-tour__value--secondary space-y-1" data-composite="bounce">
      <p className={VALUE_LABEL}>{METRIC_LABELS[entry.metric.metric]}</p>
      <p className="font-sans text-sm text-neutral-800 dark:text-neutral-200">
        <span className={SECONDARY_VALUE}>{parts.value}</span>
        {parts.position !== null && (
          <>
            <span aria-hidden="true">{' · '}</span>
            <span className="sr-only">, </span>
            {parts.position}
          </>
        )}
      </p>
      {metricTier(entry.metric) === 'caveated' && <p className={CONFIDENCE}>{confidenceLabel(entry.metric)}</p>}
    </div>
  )
}

/**
 * One measured focus area: its headline value (named, with its confidence when that is not normal),
 * a compact band bar when the headline is banded, vertical ratio's "From …" line when vertical ratio
 * IS the headline, the cited why line, then either the area's one studied option or its non-point,
 * then vertical ratio as a secondary value when the bounce reading is headed by it and the stop is
 * not. The headline is the area's own (`view.headline`), the metric its feedback is keyed on.
 * Nothing else: the cards are in the summary.
 */
export function AreaStop({ stop }: { stop: TourAreaStop }) {
  const { view, entries, readings, bounce, feedback } = stop
  const [headline] = entries
  const parts = guidedHeadlineParts(headline, { standalone: true })
  const shortName = SHORT_METRIC_LABELS[headline.metric.metric]
  const tier = view.headline?.tier
  const headlineIsRatio = headline.metric.metric === 'verticalRatio'
  const derivation = headlineIsRatio && bounce !== null ? formatBounceDerivation(bounce) : null
  const ratioReading = readings.find(
    (reading) => reading.kind === 'composite' && reading.headline.metric.metric === 'verticalRatio',
  )
  const secondary = !headlineIsRatio && ratioReading !== undefined ? readingHeadline(ratioReading) : null
  return (
    <StopSection id={view.area} heading={FOCUS_AREAS[view.area].label}>
      {/* The value on its own line, named by a small label above it. Excluded from the word budget
          with its label and confidence: numbers and names, not prose. */}
      <div className="runner-tour__value space-y-1">
        {shortName !== undefined && <p className={VALUE_LABEL}>{shortName}</p>}
        <p className={VALUE}>
          {parts.value}
          {parts.position !== null && <span className="sr-only">, {parts.position}</span>}
        </p>
        {tier === 'caveated' && (
          <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
            {confidenceLabel(headline.metric)}
          </p>
        )}
      </div>
      {hasCompactBar(headline) && (
        <div className="runner-tour__scale w-full max-w-sm">
          <MetricScale band={headline.band!} value={headline.metric.value!} compact />
        </div>
      )}
      {/* Below `lg` the bar's key sits under it, in the panel; at `lg` it is beside the runner. */}
      {hasCompactBar(headline) && <BandLegend className="runner-tour__panel-legend lg:hidden" />}
      {derivation !== null && <p className={DERIVATION}>{derivation}</p>}
      {feedback.why !== null && <FeedbackLine line={feedback.why} className="runner-tour__why" />}
      {feedback.cue !== null ? (
        <CueLine {...feedback.cue} />
      ) : (
        feedback.nonPoint !== null && (
          <FeedbackLine line={feedback.nonPoint} className="runner-tour__non-point" />
        )
      )}
      {secondary !== null && <SecondaryValue entry={secondary} />}
    </StopSection>
  )
}

export interface OneThingStopProps {
  oneThing: OneThing
  unmeasured: readonly FocusAreaId[]
  captureHint: CaptureHint | null
  /** "See all measurements": the tour is finished. */
  onSeeAll: () => void
  /** Opens the header's add-a-clip panel; a hint that adds a clip renders as this control. */
  onAddClip?: () => void
}

/**
 * The closing stop: the tour's one studied option, or that nothing here calls for a change, or that
 * it cannot say and why. Then the end of the tour, which names the areas it skipped, one way to
 * measure them, and the way on to every measurement.
 */
export function OneThingStop({ oneThing, unmeasured, captureHint, onSeeAll, onAddClip }: OneThingStopProps) {
  const hintButton = captureHint !== null && captureHint.addsClip && onAddClip !== undefined
  return (
    <StopSection id="oneThing" heading={ONE_THING_LABEL}>
      {oneThing.kind === 'cue' ? (
        <CueLine metric={oneThing.metric} text={oneThing.text} url={oneThing.url} />
      ) : (
        <p className="runner-tour__one-thing font-sans text-base text-neutral-900 dark:text-neutral-100">
          {oneThing.kind === 'nothingToChange' ? NOTHING_TO_CHANGE : ONE_THING_UNCLEAR[oneThing.reason]}
        </p>
      )}
      <div className="runner-tour__end mt-6 space-y-3 border-t-2 border-neutral-300 pt-4 max-lg:mt-2 max-lg:pt-3 dark:border-neutral-700">
        {unmeasured.length > 0 && (
          <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
            {`Not measured: ${joinList(unmeasured.map((area) => FOCUS_AREAS[area].label))}.`}
            {captureHint !== null && !hintButton && (
              <> {captureHint.addsClip ? `${captureHint.text}.` : captureHint.text}</>
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {hintButton && (
            <button type="button" onClick={onAddClip} className={BUTTON}>
              {captureHint.text}
            </button>
          )}
          <button type="button" onClick={onSeeAll} className={BUTTON}>
            See all measurements
          </button>
        </div>
      </div>
    </StopSection>
  )
}
