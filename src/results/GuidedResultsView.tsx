import { useEffect, useId, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import type { MetricGuidance } from '../guidance/types'
import { guidedHeadline } from './formatGuidedValue'
import { GuidedMetricCard } from './GuidedMetricCard'
import {
  bandWithheld,
  captureHintFor,
  guidedEntryId,
  guidedGroups,
  notMeasuredReason,
} from './guidedGroups'
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
const BODY = 'font-sans text-sm text-neutral-700 dark:text-neutral-300'
const FOCUS_RING_TARGET = `scroll-mt-4 ${FOCUS}`
const H2 = 'font-display text-xl font-bold tracking-tight'
const SUMMARY = `cursor-pointer p-5 font-sans text-base font-semibold ${FOCUS}`

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
        <GuidedMeasurements
          heuristics={heuristics}
          scalePassStatus={analysis.scalePass.status}
          evidence={evidence}
          clipCount={clipCount}
        />
      )}
    </section>
  )
}

/**
 * Opens every closed `<details>` between `target` and the document root. Returns whether any was
 * closed, i.e. whether the target was hidden until now.
 */
function openAncestors(target: Element): boolean {
  let opened = false
  for (
    let details = target.parentElement?.closest('details');
    details;
    details = details.parentElement?.closest('details')
  ) {
    if (!details.open) {
      details.open = true
      opened = true
    }
  }
  return opened
}

/**
 * The fragment this page session has already revealed — on a mount or a hash change (a contents-list
 * click causes one, unless it names the fragment already in the address, which is handled already).
 *
 * The guided measurements mount again every time an analysis reaches ready (adding a clip) and every
 * time the view is toggled back from classic, and the toggle keeps the hash. Revealing the hash on
 * each of those mounts would scroll the page back to a card the reader left long ago. So a mount
 * reveals a fragment only the first time the page session sees it, and never moves focus: focus
 * moves only when the reader asks for a card, by a hash change or a contents-list click.
 *
 * Module scope, because the component's own state dies with the very remount this has to survive.
 */
let handledHash: string | null = null

/** The element a fragment names, if it is inside `root`. */
function fragmentTarget(root: HTMLElement | null, hash: string): HTMLElement | null {
  if (root === null || hash.length <= 1) return null
  let id: string
  try {
    id = decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
  const target = document.getElementById(id)
  return target !== null && root.contains(target) ? target : null
}

function Contents({
  entries,
}: {
  entries: { entry: GuidedEntry; excluded: boolean }[]
}) {
  // Runs before the browser follows the link, so the target is already visible when it scrolls.
  // A click on a link to the CURRENT hash fires no hashchange, which is why this is not left to
  // the listener in `GuidedMeasurements`. A modified click opens a new tab and leaves this page be.
  const reveal = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    const target = event.currentTarget.ownerDocument.getElementById(id)
    if (target === null) return
    openAncestors(target)
    // The reader asked for this card, so focus follows. `preventScroll`: the link's own navigation
    // scrolls, and its hashchange records the fragment as handled.
    target.focus({ preventScroll: true })
  }
  return (
    <nav
      aria-label="Measurements on this page"
      className="guided-results__contents border-2 border-black p-4 dark:border-white"
    >
      {/* The nav's own name already says this; the visible copy is for sighted readers only. */}
      <p aria-hidden="true" className="mb-2 font-display text-sm font-bold uppercase tracking-wide">
        Measurements on this page
      </p>
      <ol className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ entry, excluded }) => {
          const id = guidedEntryId(entry.metric.metric)
          return (
            <li key={id} data-metric={entry.metric.metric}>
              <a
                href={`#${id}`}
                onClick={(event) => reveal(event, id)}
                className={`guided-results__contents-link flex items-baseline justify-between gap-3 py-0.5 font-sans text-sm text-black dark:text-white ${FOCUS}`}
              >
                <span className="font-semibold underline decoration-1 underline-offset-2">
                  {METRIC_LABELS[entry.metric.metric]}
                </span>
                <span
                  className={`guided-results__contents-value shrink-0 text-right tabular-nums ${excluded ? 'text-neutral-600 dark:text-neutral-400' : 'text-neutral-800 dark:text-neutral-200'}`}
                >
                  {guidedHeadline(entry, excluded) ?? 'not measured'}
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function names(entries: GuidedEntry[]): string {
  return entries.map((entry) => METRIC_LABELS[entry.metric.metric]).join(', ')
}

export interface GuidedMeasurementsProps {
  heuristics: FormHeuristicsResult
  scalePassStatus: ScalePassStatus
  evidence: readonly MetricCardEvidence[]
  clipCount: number
  /** The guidance record. A parameter only so a test can withhold a band; defaults to the shipped one. */
  guidance?: Record<MetricId, MetricGuidance>
}

/**
 * The contents list and the three groups.
 *
 * Every group is a `<section>` named by a real `<h2>` that sits outside any `<summary>`, so a
 * heading outline reads group → measurement. The two collapsed groups put a `<details>` under that
 * heading whose summary names every measurement inside, so nothing is findable only by opening it.
 * A link from the contents list — or any navigation to a card's fragment, on load or later —
 * opens the `<details>` holding its target. Focus moves to the card only when the reader asked for
 * it (a contents-list click or a hash change), never on mount — see `handledHash`.
 */
export function GuidedMeasurements({
  heuristics,
  scalePassStatus,
  evidence,
  clipCount,
  guidance = METRIC_GUIDANCE,
}: GuidedMeasurementsProps) {
  const bandedHeadingId = useId()
  const unbandedHeadingId = useId()
  const notMeasuredHeadingId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const { banded, unbanded, notMeasured } = guidedGroups(heuristics, guidance)
  // Keyed by metric, never by position: evidence arrives in the extraction plan's own order.
  const evidenceByMetric = new Map(evidence.map((entry) => [entry.metric, entry]))

  useEffect(() => {
    // On mount: a fragment this page session has not revealed yet — typically a shared link, whose
    // card did not exist when the browser tried to scroll to it — is opened and scrolled to. Focus
    // stays where it is: nobody asked for it on this mount, and the reader may be on the toggle.
    const hash = window.location.hash
    const target = fragmentTarget(rootRef.current, hash)
    if (target !== null && hash !== handledHash) {
      handledHash = hash
      openAncestors(target)
      target.scrollIntoView?.({ block: 'start' })
    }
    // A hash change is the reader asking for a card. The browser already scrolled to a visible
    // target; one it could not see needs doing here.
    const onHashChange = () => {
      const current = window.location.hash
      const next = fragmentTarget(rootRef.current, current)
      if (next === null) return
      handledHash = current
      if (openAncestors(next)) next.scrollIntoView?.({ block: 'start' })
      next.focus({ preventScroll: true })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const cards = (entries: GuidedEntry[], variant: 'framed' | 'divided') => (
    <div className={variant === 'framed' ? 'grid gap-4' : 'space-y-6'}>
      {entries.map((entry) => (
        <GuidedMetricCard
          key={entry.metric.metric}
          entry={entry}
          evidence={evidenceByMetric.get(entry.metric.metric)}
          clipCount={clipCount}
          variant={variant}
        />
      ))}
    </div>
  )

  // A metric can sit here only because its band's provenance was blank. Then "no published range"
  // would be false of it, so the group is titled by what the page does, not by what the literature has.
  const anyWithheld = unbanded.some(bandWithheld)

  return (
    <div ref={rootRef} className="guided-results__results space-y-8">
      <Contents
        entries={[
          ...banded.map((entry) => ({ entry, excluded: false })),
          ...unbanded.map((entry) => ({ entry, excluded: false })),
          ...notMeasured.map((entry) => ({ entry, excluded: true })),
        ]}
      />

      {banded.length > 0 && (
        <section
          aria-labelledby={bandedHeadingId}
          className="guided-results__group guided-results__group--banded space-y-4"
        >
          <div className="space-y-1">
            <h2 id={bandedHeadingId} className={H2}>
              Compared with published research
            </h2>
            <p className={MUTED}>
              Each range below is where a named study or manufacturer measured a group of runners
              to fall. It describes that group, and places your reading beside it without grading
              it.
            </p>
          </div>
          {cards(banded, 'framed')}
        </section>
      )}

      {unbanded.length > 0 && (
        <section
          aria-labelledby={unbandedHeadingId}
          className="guided-results__group guided-results__group--unbanded space-y-3"
        >
          <h2 id={unbandedHeadingId} className={H2}>
            {anyWithheld ? 'Measured, no range shown' : 'Measured, no published range'}
          </h2>
          <details className="guided-results__group-details border-2 border-black dark:border-white">
            <summary className={SUMMARY}>
              {plural(unbanded.length, 'measurement')}: {names(unbanded)}
            </summary>
            <div className="space-y-6 px-5 pb-5">
              <p className={`guided-results__group-intro ${MUTED}`}>
                {anyWithheld
                  ? 'No range is shown for these, so no scale is drawn. Each one says why, and keeps its value, notes and links.'
                  : 'No published range exists for these in the units this app reports them in, so no scale is drawn. Each one says why, and keeps its value, notes and links.'}
              </p>
              {cards(unbanded, 'divided')}
            </div>
          </details>
        </section>
      )}

      {notMeasured.length > 0 && (
        <section
          aria-labelledby={notMeasuredHeadingId}
          className="guided-results__group guided-results__group--not-measured guided-results__not-measured space-y-3"
        >
          <h2 id={notMeasuredHeadingId} className={H2}>
            Not measured on this clip
          </h2>
          <details className="guided-results__group-details border-2 border-black dark:border-white">
            <summary className={SUMMARY}>
              {plural(notMeasured.length, 'measurement')}: {names(notMeasured)}
            </summary>
            <div className="space-y-4 px-5 pb-5">
              <p className={`guided-results__group-intro ${MUTED}`}>
                Each one says what to film differently to measure it next time, then why it wasn't
                measured on this clip.
              </p>
              <ul className="space-y-5">
                {notMeasured.map((entry) => {
                  const id = guidedEntryId(entry.metric.metric)
                  return (
                    <li
                      key={entry.metric.metric}
                      id={id}
                      tabIndex={-1}
                      className={`guided-results__not-measured-entry space-y-1 border-t border-neutral-300 pt-4 dark:border-neutral-700 ${FOCUS_RING_TARGET}`}
                      data-metric={entry.metric.metric}
                    >
                      <h3 id={`${id}-heading`} className="font-display text-lg font-bold tracking-tight">
                        {METRIC_LABELS[entry.metric.metric]}
                      </h3>
                      <p className={`guided-results__capture-hint ${BODY}`}>
                        <span className="font-semibold text-black dark:text-white">
                          To measure this next time:{' '}
                        </span>
                        {captureHintFor(entry)}
                      </p>
                      <p className={`guided-results__not-measured-reason ${MUTED}`}>
                        {notMeasuredReason(entry.metric, scalePassStatus)}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
