import type { ReactNode } from 'react'
import type { MetricId } from '../../heuristics/types'
import {
  CUE_PREFIX,
  NOTHING_TO_CHANGE,
  ONE_THING_LABEL,
  ONE_THING_UNCLEAR,
} from '../../guidance/feedbackPoints'
import type { OneThing } from '../../guidance/feedbackPoints'
import { FOCUS_AREAS } from '../../guidance/focusAreas'
import type { FocusAreaId, TourStopId } from '../../guidance/focusAreas'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import { MetricScale } from '../../guidance/MetricScale'
import { FeedbackLine } from '../FeedbackLine'
import { guidedHeadlineParts } from '../formatGuidedValue'
import { joinList } from '../guidedGroups'
import { ExternalLink } from '../GuidedMetricCard'
import { confidenceLabel } from '../metricConfidence'
import { SHORT_METRIC_LABELS, hasCompactBar } from '../summary/summaryLabels'
import type { CaptureHint, TourAreaStop } from './tourPlan'
import { tourStopDomId } from './tourPlan'

/**
 * A stop's section: at least the viewport below the session header and the tour's sticky bar, so
 * one stop at a time sits at the reading line. Named so the phone layout (`strides-trn2.4`) can add
 * its `max-lg:` panel styling here rather than in each stop.
 */
export const TOUR_STOP_CLASS =
  'runner-tour__stop flex min-h-[calc(100dvh_-_var(--motion-story-header-height,88px)_-_3.5rem)] scroll-mt-[calc(var(--motion-story-header-height,88px)_+_3.5rem)] flex-col justify-center gap-3 border-t-2 border-black py-10 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 dark:border-white'
const STOP_HEADING = 'font-display text-2xl font-bold tracking-tight'
const VALUE_LABEL =
  'font-sans text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400'
const VALUE = 'font-display text-4xl font-bold tabular-nums leading-tight'
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
      <h3 id={`${domId}-heading`} className={STOP_HEADING}>
        {heading}
      </h3>
      {children}
    </section>
  )
}

/**
 * One measured focus area: its headline value (named, with its confidence when that is not
 * normal), a compact band bar when the headline is banded, the cited why line, then either the
 * area's one studied option or its non-point. Nothing else — the cards are in the summary.
 */
export function AreaStop({ stop }: { stop: TourAreaStop }) {
  const { view, entries, feedback } = stop
  const [headline] = entries
  const parts = guidedHeadlineParts(headline, { standalone: true })
  const shortName = SHORT_METRIC_LABELS[headline.metric.metric]
  const tier = view.headline?.tier
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
      {feedback.why !== null && <FeedbackLine line={feedback.why} className="runner-tour__why" />}
      {feedback.cue !== null ? (
        <CueLine {...feedback.cue} />
      ) : (
        feedback.nonPoint !== null && (
          <FeedbackLine line={feedback.nonPoint} className="runner-tour__non-point" />
        )
      )}
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
      <div className="runner-tour__end mt-6 space-y-3 border-t-2 border-neutral-300 pt-4 dark:border-neutral-700">
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
