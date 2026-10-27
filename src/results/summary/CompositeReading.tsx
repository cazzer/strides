import type { MetricId } from '../../heuristics/types'
import { COMPOSITE_READINGS } from '../../guidance/compositeReadings'
import type { CompositeId } from '../../guidance/compositeReadings'
import type { GuidedEntry } from '../guidedGroups'
import { GuidedMetricCard } from '../GuidedMetricCard'
import { METRIC_LABELS } from '../metricConfidence'
import type { MetricCardEvidence } from '../MetricsPanel'

/** The in-card disclosure's idiom (`guided-results__more`): the native marker, no indent, a 44 px
 * target (`py-3` on a 20 px line). */
const MORE_SUMMARY =
  'results-summary__composite-more-summary min-h-11 cursor-pointer py-3 font-sans text-sm font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-white'

/** Each member's unit, for the disclosure's name: what tells the same bounce apart. */
const MEMBER_UNITS: Readonly<Partial<Record<MetricId, string>>> = {
  verticalOscillationCm: 'cm',
  verticalOscillation: '% of torso length',
}

/** "Same bounce in cm and % of torso length", or the one unit present. */
function sameBounceLabel(members: readonly GuidedEntry[]): string {
  const units = members.map((entry) => MEMBER_UNITS[entry.metric.metric] ?? METRIC_LABELS[entry.metric.metric])
  return `Same bounce in ${units.join(' and ')}`
}

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
 * The disclosure takes the card's own disclosure idiom (native marker, no indent). A `role=group`
 * rather than a `<section>`: a named region per row would crowd the landmark list.
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
    <div
      role="group"
      className="results-summary__composite space-y-3"
      data-composite={id}
      aria-label={COMPOSITE_READINGS[id].label}
    >
      {card(headline, derivation)}
      {members.length > 0 && (
        <details className="results-summary__composite-more border-t border-neutral-300 dark:border-neutral-700">
          <summary className={MORE_SUMMARY}>{sameBounceLabel(members)}</summary>
          <div className="space-y-6 pt-2">{members.map((entry) => card(entry))}</div>
        </details>
      )}
    </div>
  )
}
