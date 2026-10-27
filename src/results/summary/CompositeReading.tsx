import type { MetricId } from '../../heuristics/types'
import { COMPOSITE_READINGS } from '../../guidance/compositeReadings'
import type { CompositeId } from '../../guidance/compositeReadings'
import type { GuidedEntry } from '../guidedGroups'
import { GuidedMetricCard } from '../GuidedMetricCard'
import { METRIC_LABELS } from '../metricConfidence'
import type { MetricCardEvidence } from '../MetricsPanel'

const MORE_SUMMARY =
  'results-summary__composite-more-summary flex min-h-11 cursor-pointer list-none items-center gap-3 py-2 font-sans text-sm font-semibold text-black [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-white'

export interface CompositeReadingProps {
  id: CompositeId
  headline: GuidedEntry
  /** The composite's other measured entries, in composite order. */
  members: readonly GuidedEntry[]
  /** The headline's "From …" line, or undefined when it has none (vertical ratio not measured). */
  derivation?: string
  evidenceByMetric: ReadonlyMap<MetricId, MetricCardEvidence>
  clipCount: number
  sourceLabelFor: (metric: MetricId) => string | undefined
  onOpenEvidenceVideo?: (clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => void
}

/**
 * One composite reading in a summary row (compose-bounce-reading design.md D5): the headline's full
 * card with its "From …" line, then the other members' full cards in ONE nested disclosure.
 *
 * Native `<details>`, closed by default without unmounting, for the row's own reasons: the member
 * cards stay in the document, so their evidence canvases keep their one parent, find-in-page can
 * open them, and `useRevealFragment` opens every ancestor `<details>` for a card's fragment link.
 * The chevron reads the NAMED group (`group/more`): the row's own `group` is an ancestor too, and a
 * plain `group-open:` would turn this chevron whenever the row is open.
 */
export function CompositeReading({
  id,
  headline,
  members,
  derivation,
  evidenceByMetric,
  clipCount,
  sourceLabelFor,
  onOpenEvidenceVideo,
}: CompositeReadingProps) {
  const card = (entry: GuidedEntry, line?: string) => (
    <GuidedMetricCard
      key={entry.metric.metric}
      entry={entry}
      evidence={evidenceByMetric.get(entry.metric.metric)}
      clipCount={clipCount}
      sourceLabel={sourceLabelFor(entry.metric.metric)}
      onOpenEvidenceVideo={onOpenEvidenceVideo}
      derivation={line}
    />
  )
  return (
    <section
      className="results-summary__composite space-y-3"
      data-composite={id}
      aria-label={COMPOSITE_READINGS[id].label}
    >
      {card(headline, derivation)}
      {members.length > 0 && (
        <details className="results-summary__composite-more group/more border-t border-neutral-300 dark:border-neutral-700">
          <summary className={MORE_SUMMARY}>
            <span
              aria-hidden="true"
              className="inline-block w-3 shrink-0 font-sans text-sm leading-5 transition-transform group-open/more:rotate-90 motion-reduce:transition-none"
            >
              ▸
            </span>
            <span>Also: {members.map((entry) => METRIC_LABELS[entry.metric.metric]).join(', ')}</span>
          </summary>
          <div className="space-y-6 pt-2">{members.map((entry) => card(entry))}</div>
        </details>
      )}
    </section>
  )
}
