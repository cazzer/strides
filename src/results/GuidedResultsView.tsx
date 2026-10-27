import type { ReactNode } from 'react'
import { captureHintFor, guidedEntryId, notMeasuredReason } from './guidedGroups'
import type { GuidedEntry } from './guidedGroups'
import { METRIC_LABELS, metricTier } from './metricConfidence'
import type { ResultsViewProps } from './ResultsView'
import type { ScalePassStatus } from './types'
import { StartOverControl } from './StartOverControl'

/**
 * Identical to `ResultsViewProps` BY CONSTRUCTION rather than restated, so the two views stay
 * interchangeable at the one call site that chooses between them (design.md D7.1).
 */
export type GuidedResultsViewProps = ResultsViewProps

export interface GuidedResultsShellProps extends GuidedResultsViewProps {
  /**
   * The body shown once the analysis is ready and has heuristics. The summary and the tour pass
   * theirs here, so the shell (its controls, the error alert, the one completion line and the one
   * "Analysis results" section) is never copied. Required: the shell has no body of its own.
   */
  children: ReactNode
}

const MUTED = 'font-sans text-sm text-neutral-600 dark:text-neutral-400'
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
const BODY = 'font-sans text-sm text-neutral-700 dark:text-neutral-300'
const FOCUS_RING_TARGET = `scroll-mt-4 ${FOCUS}`

/**
 * The shell every guided body renders inside: the tour's and the summary's (guided-results-view
 * spec).
 *
 * A sibling of `ResultsView`, not a wrapper around it. ⚠️ Its shell — the Analyze button and the
 * shared `StartOverControl`, the `role="status"` completion line with the scale-pass narrative, and
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
  onStartOver,
  clipCount = 1,
  children,
}: GuidedResultsShellProps) {
  const { phase, heuristics, error, start } = analysis
  const scalePassCouldntAdd =
    " A second look at the clip couldn't add the extra metrics."
  const addedMetricCount = heuristics
    ? [
        heuristics.verticalOscillationCm,
        heuristics.stepWidthCm,
      ].filter((metric) => metricTier(metric) !== 'excluded').length
    : 0
  const analyzeDisabled = phase === 'sampling' || phase === 'processing'
  const analyzeDisabledReason = analyzeDisabled
    ? 'Analysis already in progress'
    : undefined

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
        <StartOverControl onConfirm={onStartOver} clipCount={clipCount} />
      </div>

      {phase === 'ready' && (
        <p role="status">
          Analysis complete.
          {(analysis.scalePass.status === 'pending' ||
            analysis.scalePass.status === 'running') &&
            ' Measuring more metrics with a second look at the clip…'}
          {analysis.scalePass.status === 'done' &&
            (addedMetricCount > 0
              ? ` A second look at the clip added ${addedMetricCount} more metric${addedMetricCount === 1 ? '' : 's'}.`
              : scalePassCouldntAdd)}
          {analysis.scalePass.status === 'failed' && scalePassCouldntAdd}
        </p>
      )}

      {phase === 'error' && error && (
        <div
          className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2"
          role="alert"
        >
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

      {phase === 'ready' && heuristics && children}
    </section>
  )
}

/**
 * The not-measured entries, each with what to change next time and why it was not measured. Shared
 * by the summary's final row and any other guided body, so the wording
 * lives in one place.
 */
export function NotMeasuredEntries({
  entries,
  scalePassStatus,
}: {
  entries: readonly GuidedEntry[]
  scalePassStatus: ScalePassStatus
}) {
  return (
    <ul className="space-y-5">
      {entries.map((entry) => {
        const id = guidedEntryId(entry.metric.metric)
        return (
          <li
            key={entry.metric.metric}
            id={id}
            tabIndex={-1}
            className={`guided-results__not-measured-entry space-y-1 border-t border-neutral-300 pt-4 dark:border-neutral-700 ${FOCUS_RING_TARGET}`}
            data-metric={entry.metric.metric}
            data-motion-metric={entry.metric.metric}
          >
            <h3
              id={`${id}-heading`}
              className="font-display text-lg font-bold tracking-tight"
            >
              {METRIC_LABELS[entry.metric.metric]}
            </h3>
            <p className={`guided-results__capture-hint ${BODY}`}>
              <span className="font-semibold text-black dark:text-white">
                To measure this next time:{' '}
              </span>
              {captureHintFor(entry)}
            </p>
            <p
              className={`guided-results__not-measured-reason ${MUTED}`}
            >
              {notMeasuredReason(entry.metric, scalePassStatus)}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
