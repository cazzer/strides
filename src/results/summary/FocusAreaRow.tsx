import { memo } from 'react'
import type { MetricId } from '../../heuristics/types'
import type { AreaFeedback } from '../../guidance/feedbackPoints'
import type { FocusAreaId } from '../../guidance/focusAreas'
import { MetricScale } from '../../guidance/MetricScale'
import { FeedbackLine } from '../FeedbackLine'
import { guidedHeadlineParts } from '../formatGuidedValue'
import type { GuidedEntry } from '../guidedGroups'
import { GuidedMetricCard } from '../GuidedMetricCard'
import { NotMeasuredEntries } from '../GuidedResultsView'
import { METRIC_LABELS } from '../metricConfidence'
import type { MetricCardEvidence } from '../MetricsPanel'
import type { ScalePassStatus } from '../types'
import { SHORT_METRIC_LABELS, alsoMeasuredNames, hasCompactBar } from './summaryLabels'

const ROW_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600'
/** A row's `<summary>`: a 44 px target, with the browser's marker replaced by `RowChevron`. */
const ROW_SUMMARY = `flex min-h-11 cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden ${ROW_FOCUS}`

/** The disclosure state, drawn: points right when closed, down when open. */
function RowChevron() {
  return (
    <span
      aria-hidden="true"
      className="mt-1 inline-block w-3 shrink-0 font-sans text-sm leading-5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
    >
      ▸
    </span>
  )
}

export interface FocusAreaRowProps {
  area: FocusAreaId
  label: string
  /** The area's measured metrics, headline first. Never empty: an unmeasured area gets no row. */
  entries: readonly GuidedEntry[]
  feedback: AreaFeedback
  evidenceByMetric: ReadonlyMap<MetricId, MetricCardEvidence>
  clipCount: number
  sourceLabelFor: (metric: MetricId) => string | undefined
  onOpenEvidenceVideo?: (clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => void
  /**
   * Fires whenever THIS row opens or closes, by a click, the keyboard, find-in-page or a link. A
   * card's own disclosure inside the row does not fire it. Stable across renders, with the area
   * passed back, so a memoised row does not re-render for a new closure.
   */
  onToggle: (area: FocusAreaId, open: boolean) => void
}

/**
 * One focus area in the results summary: a native `<details>` whose summary names the area, its
 * headline value and where that value sits in the band's own words, and whose content is the area's
 * cards at full depth.
 *
 * Native, and closed by default without unmounting: a collapsed row keeps its cards — and so their
 * evidence canvases, which have one parent each — in the document, find-in-page can open it, and a
 * card's fragment link opens it through `useRevealFragment`.
 *
 * The area label is a span, not a heading: inside a `<summary>` a heading's role is flattened into
 * the button, and the cards inside carry the headings.
 */
export const FocusAreaRow = memo(function FocusAreaRow({
  area,
  label,
  entries,
  feedback,
  evidenceByMetric,
  clipCount,
  sourceLabelFor,
  onOpenEvidenceVideo,
  onToggle,
}: FocusAreaRowProps) {
  const [headline, ...others] = entries
  // Standalone: the row names the range itself ("within the 6.0–9.5 cm range"), since the compact
  // bar beside it prints no numbers to point back to.
  const parts = guidedHeadlineParts(headline, { standalone: true })
  const { band, metric } = headline
  const shortName = SHORT_METRIC_LABELS[metric.metric]
  const also = alsoMeasuredNames(others.map((entry) => entry.metric.metric))

  return (
    <details
      className="results-summary__row group"
      data-area={area}
      onToggle={(event) => {
        // React delivers a card's inner `<details>` toggle here too; only this row's own counts.
        if (event.target === event.currentTarget) onToggle(area, event.currentTarget.open)
      }}
    >
      <summary className={ROW_SUMMARY}>
        <RowChevron />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="results-summary__row-label block font-display text-lg font-bold leading-6 tracking-tight">
            {label}
          </span>
          <span className="results-summary__row-headline block font-sans text-sm text-neutral-800 dark:text-neutral-200">
            {shortName !== undefined && <span>{shortName} </span>}
            <span className="font-semibold tabular-nums">{parts.value}</span>
            {parts.position !== null && (
              <>
                <span aria-hidden="true">{' · '}</span>
                <span className="sr-only">, </span>
                {parts.position}
              </>
            )}
          </span>
          {also.length > 0 && (
            <span className="results-summary__row-others block font-sans text-xs text-neutral-600 dark:text-neutral-400">
              Also: {also.join(', ')}
            </span>
          )}
        </span>
        {hasCompactBar(headline) && (
          <span className="results-summary__row-marker w-20 shrink-0 pt-2 sm:w-32">
            <MetricScale band={band!} value={metric.value!} compact />
          </span>
        )}
      </summary>
      <div className="space-y-6 px-4 pb-5">
        {(feedback.why !== null || feedback.nonPoint !== null) && (
          <div className="results-summary__why space-y-2 border-l-4 border-neutral-300 pl-3 dark:border-neutral-700">
            {feedback.why !== null && <FeedbackLine line={feedback.why} />}
            {feedback.nonPoint !== null && <FeedbackLine line={feedback.nonPoint} />}
          </div>
        )}
        <div className="space-y-6">
          {entries.map((entry) => (
            <GuidedMetricCard
              key={entry.metric.metric}
              entry={entry}
              evidence={evidenceByMetric.get(entry.metric.metric)}
              clipCount={clipCount}
              sourceLabel={sourceLabelFor(entry.metric.metric)}
              onOpenEvidenceVideo={onOpenEvidenceVideo}
            />
          ))}
        </div>
      </div>
    </details>
  )
})

export function NotMeasuredRow({
  entries,
  scalePassStatus,
}: {
  entries: readonly GuidedEntry[]
  scalePassStatus: ScalePassStatus
}) {
  return (
    <details
      className="results-summary__row results-summary__row--not-measured group"
      data-area="notMeasured"
    >
      <summary className={ROW_SUMMARY}>
        <RowChevron />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="results-summary__row-label block font-display text-lg font-bold leading-6 tracking-tight">
            Not measured
          </span>
          <span className="block font-sans text-sm text-neutral-600 dark:text-neutral-400">
            <span className="sr-only">: </span>
            {entries.map((entry) => METRIC_LABELS[entry.metric.metric]).join(', ')}
          </span>
        </span>
      </summary>
      <div className="px-4 pb-5">
        <NotMeasuredEntries entries={entries} scalePassStatus={scalePassStatus} />
      </div>
    </details>
  )
}
