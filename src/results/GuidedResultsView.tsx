import { useId } from 'react'
import type { FormHeuristicsResult } from '../heuristics/types'
import { GuidedMetricCard } from './GuidedMetricCard'
import { guidedGroups, notMeasuredReason } from './guidedGroups'
import type { GuidedEntry } from './guidedGroups'
import { METRIC_LABELS } from './metricConfidence'
import type { MetricCardEvidence } from './MetricsPanel'
import type { ResultsViewProps } from './ResultsView'
import type { ScalePassStatus } from './types'

/**
 * Identical to `ResultsViewProps` BY CONSTRUCTION rather than restated, so the two views stay
 * interchangeable at the one call site that chooses between them (design.md D7.1).
 */
export type GuidedResultsViewProps = ResultsViewProps

/** Stable empty list, so a view rendered without evidence never builds a fresh map identity. */
const NO_EVIDENCE: readonly MetricCardEvidence[] = []

const MUTED = 'font-sans text-sm text-neutral-600 dark:text-neutral-400'
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
const SUMMARY = `cursor-pointer p-5 font-display text-lg font-bold tracking-tight ${FOCUS}`

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/**
 * The analysis, presented against cited guidance: every measured metric beside what published
 * research says about it, in three groups by what can honestly be said (guided-results-view spec).
 *
 * A sibling of `ResultsView`, not a wrapper around it. ⚠️ Its shell — the Analyze / Choose a
 * different video buttons, the `role="status"` completion line with the scale-pass narrative, and
 * the error alert — is a deliberate COPY of `ResultsView`'s, class strings included, because that
 * file is not to be edited by this change (design.md D7.2) and both views must behave identically
 * around the metrics. The completion line in particular is load-bearing, not copy: the e2e suite
 * and `scripts/ab-person-selection.mjs` both wait on its leading "Analysis complete.".
 *
 * Presentational: it calls no data hook. Evidence arrives as a prop from the session's single
 * acquisition — calling `useSessionEvidence` here, or mounting beside `ResultsView`, would move
 * every evidence canvas out of the other view (design.md D7.3).
 */
export function GuidedResultsView({
  analysis,
  onTryAgain,
  onChooseDifferentVideo,
  evidence = NO_EVIDENCE,
  clipCount = 1,
}: GuidedResultsViewProps) {
  const { phase, heuristics, error, start } = analysis
  const scalePassCouldntAdd = " A second look at the clip couldn't add the extra metrics."
  const addedMetricCount = heuristics
    ? [heuristics.verticalOscillationCm.value !== null, heuristics.stepWidthCm.value !== null]
        .filter(Boolean).length
    : 0
  const analyzeDisabled = phase === 'sampling' || phase === 'processing'
  const analyzeDisabledReason = analyzeDisabled ? 'Analysis already in progress' : undefined

  return (
    <section className="guided-results space-y-6" aria-label="Analysis results">
      <div className="flex flex-wrap gap-2">
        {phase !== 'ready' && (
          <button
            type="button"
            onClick={start}
            disabled={analyzeDisabled}
            title={analyzeDisabledReason}
            className="inline-flex items-center justify-center border-2 border-brand-700 bg-brand-700 px-5 py-2.5 font-sans text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-800 hover:border-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-700"
          >
            {phase === 'error' ? 'Analyze again' : 'Analyze'}
          </button>
        )}
        <button
          type="button"
          onClick={onChooseDifferentVideo}
          className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Choose a different video
        </button>
      </div>

      {phase === 'ready' && (
        <p role="status">
          Analysis complete.
          {(analysis.scalePass.status === 'pending' || analysis.scalePass.status === 'running') &&
            ' Measuring more metrics with a second look at the clip…'}
          {analysis.scalePass.status === 'done' &&
            (addedMetricCount > 0
              ? ` A second look at the clip added ${addedMetricCount} more metric${addedMetricCount === 1 ? '' : 's'}.`
              : scalePassCouldntAdd)}
          {analysis.scalePass.status === 'failed' && scalePassCouldntAdd}
        </p>
      )}

      {phase === 'error' && error && (
        <div className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2" role="alert">
          <p>{error.message}</p>
          <button
            type="button"
            onClick={onTryAgain}
            className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Try again
          </button>
        </div>
      )}

      {phase === 'ready' && heuristics && (
        <GuidedGroupsView
          heuristics={heuristics}
          scalePassStatus={analysis.scalePass.status}
          evidence={evidence}
          clipCount={clipCount}
        />
      )}
    </section>
  )
}

function GuidedGroupsView({
  heuristics,
  scalePassStatus,
  evidence,
  clipCount,
}: {
  heuristics: FormHeuristicsResult
  scalePassStatus: ScalePassStatus
  evidence: readonly MetricCardEvidence[]
  clipCount: number
}) {
  const bandedHeadingId = useId()
  const { banded, unbanded, notMeasured } = guidedGroups(heuristics)
  // Keyed by metric, never by position: evidence arrives in the extraction plan's own order.
  const evidenceByMetric = new Map(evidence.map((entry) => [entry.metric, entry]))

  const cards = (entries: GuidedEntry[]) => (
    <div className="grid gap-4">
      {entries.map((entry) => (
        <GuidedMetricCard
          key={entry.metric.metric}
          entry={entry}
          evidence={evidenceByMetric.get(entry.metric.metric)}
          clipCount={clipCount}
        />
      ))}
    </div>
  )

  return (
    <div className="guided-results__results space-y-6">
      {banded.length > 0 && (
        <section
          aria-labelledby={bandedHeadingId}
          className="guided-results__group guided-results__group--banded space-y-4"
        >
          <div className="space-y-1">
            <h2 id={bandedHeadingId} className="font-display text-xl font-bold tracking-tight">
              Compared with published research
            </h2>
            <p className={MUTED}>
              Each range below is where a named study or manufacturer measured a group of runners
              to fall. It describes that group, and places your reading beside it without grading
              it.
            </p>
          </div>
          {cards(banded)}
        </section>
      )}

      {unbanded.length > 0 && (
        <details className="guided-results__group guided-results__group--unbanded border-2 border-black dark:border-white">
          <summary className={SUMMARY}>
            {plural(
              unbanded.length,
              banded.length > 0 ? 'more measurement' : 'measurement',
              banded.length > 0 ? 'more measurements' : 'measurements',
            )}{' '}
            without a published reference range
          </summary>
          <div className="space-y-4 px-5 pb-5">
            <p className={MUTED}>
              No published range exists for these in the units this app reports them in, so no
              scale is drawn. Each one says why, and keeps its value, notes and links.
            </p>
            {cards(unbanded)}
          </div>
        </details>
      )}

      {notMeasured.length > 0 && (
        <details className="guided-results__group guided-results__group--not-measured guided-results__not-measured border-2 border-black dark:border-white">
          <summary className={SUMMARY}>
            {plural(notMeasured.length, 'metric')} not measurable for this clip
          </summary>
          <div className="space-y-4 px-5 pb-5">
            <p className={MUTED}>
              Each entry says why, and what to film differently to measure it next time.
            </p>
            <ul className="space-y-4">
              {notMeasured.map((entry) => (
                <li
                  key={entry.metric.metric}
                  className="guided-results__not-measured-entry space-y-1"
                  data-metric={entry.metric.metric}
                >
                  <p className="font-display font-bold">{METRIC_LABELS[entry.metric.metric]}</p>
                  <p className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
                    {notMeasuredReason(entry.metric, scalePassStatus)}
                  </p>
                  <p className={`guided-results__capture-hint ${MUTED}`}>
                    <span className="font-semibold">Suggestion for filming next time: </span>
                    {entry.guidance.captureHint}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  )
}
