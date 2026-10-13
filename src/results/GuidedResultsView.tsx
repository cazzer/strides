import { Fragment, useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import type { MetricGuidance } from '../guidance/types'
import { guidedHeadline, guidedHeadlineParts } from './formatGuidedValue'
import { ExternalLink, GuidedMetricCard, TryLine } from './GuidedMetricCard'
import {
  bandWithheld,
  captureHintFor,
  cardReferences,
  guidedEntryId,
  guidedGroups,
  joinList,
  notMeasuredReason,
  splitFirstSentence,
  tryLineApplies,
} from './guidedGroups'
import type { GuidedEntry, GuidedGroups } from './guidedGroups'
import { selectHeadlines } from './guidedHeadlines'
import type { GuidedHeadlineStory, StoryOutcome } from './guidedHeadlines'
import { METRIC_LABELS, confidenceLabel, metricTier } from './metricConfidence'
import type { MetricCardEvidence } from './MetricsPanel'
import type { ResultsViewProps } from './ResultsView'
import type { ScalePassStatus } from './types'
import { clipSourceLabel } from './clipProvenance'

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
const SECONDARY = 'font-sans text-xs text-neutral-600 dark:text-neutral-400'
const SUMMARY = `cursor-pointer p-5 font-sans text-base font-semibold ${FOCUS}`

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
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
  clipViews = [],
  sourceIndices = null,
  onOpenEvidenceVideo,
}: GuidedResultsViewProps) {
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

      {phase === 'ready' && heuristics && (
        <GuidedMeasurements
          heuristics={heuristics}
          scalePassStatus={analysis.scalePass.status}
          evidence={evidence}
          clipCount={clipCount}
          clipViews={clipViews}
          sourceIndices={sourceIndices}
          onOpenEvidenceVideo={onOpenEvidenceVideo}
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
function fragmentTarget(
  root: HTMLElement | null,
  hash: string,
): HTMLElement | null {
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

function revealMetric(event: MouseEvent<HTMLAnchorElement>, id: string) {
  // Runs before the browser follows the link, so the target is already visible when it scrolls.
  // A click on a link to the CURRENT hash fires no hashchange, which is why this is not left to
  // the listener in `GuidedMeasurements`. A modified click opens a new tab and leaves this page be.
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  const target = event.currentTarget.ownerDocument.getElementById(id)
  if (target === null) return
  openAncestors(target)
  // The reader asked for this card, so focus follows. `preventScroll`: the link's own navigation
  // scrolls, and its hashchange records the fragment as handled.
  target.focus({ preventScroll: true })
}

function Contents({
  entries,
}: {
  entries: { entry: GuidedEntry; excluded: boolean }[]
}) {
  return (
    <nav
      aria-label="Measurements on this page"
      className="guided-results__contents border-2 border-black p-4 dark:border-white"
    >
      {/* The nav's own name already says this; the visible copy is for sighted readers only. */}
      <p
        aria-hidden="true"
        className="mb-2 font-display text-sm font-bold uppercase tracking-wide"
      >
        Measurements on this page
      </p>
      <ol className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ entry, excluded }) => {
          const id = guidedEntryId(entry.metric.metric)
          return (
            <li key={id} data-metric={entry.metric.metric}>
              <a
                href={`#${id}`}
                onClick={(event) => revealMetric(event, id)}
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

/** A shared introduction; each metric still lives in its honest measured/ranged group below. */
const BOUNCE_MEASURES = [
  {
    id: 'verticalOscillation',
    label: 'Bounce relative to torso length',
    explanation: 'Uses your torso length as the denominator.',
  },
  {
    id: 'verticalOscillationCm',
    label: 'Bounce in centimetres',
    explanation: 'Uses real-world scale from the clip; it may be unavailable.',
  },
  {
    id: 'verticalRatio',
    label: 'Bounce relative to stride length',
    explanation: 'Uses the distance you travel per stride as the denominator.',
  },
] as const

/** Where the bounce headline's link goes: the shared introduction to the three bounce measures. */
const BOUNCE_HEADING_ID = 'guided-bounce-heading'

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** A link that reveals and focuses its in-page target, like the contents list's. */
function InPageLink({
  target,
  className,
  children,
}: {
  target: string
  className: string
  children: ReactNode
}) {
  return (
    <a
      href={`#${target}`}
      onClick={(event) => revealMetric(event, target)}
      className={`${className} underline underline-offset-2 ${FOCUS}`}
    >
      {children}
    </a>
  )
}

/**
 * One "Energy cost" headline, in reading order: the spokesman's value and where it sits — named in
 * full, since no scale is beside it — with the pace tag; which clip it came from, where there are
 * several; the cited economy association with its source; the first sentence of each mandatory
 * note; the card's own studied-change line exactly where the card would show it; and a link on.
 *
 * Normal-tier readings only (`selectHeadlines`), so there is no confidence label to carry. The
 * band's citation stays on the card. No evidence: canvases belong to the card, and a node has one
 * parent.
 */
function EconomyHeadline({
  headline,
  sourceLabel,
}: {
  headline: GuidedHeadlineStory
  sourceLabel?: string
}) {
  const { story, entry, consequence } = headline
  const { metric, guidance } = entry
  const label = METRIC_LABELS[metric.metric]
  const parts = guidedHeadlineParts(entry, { standalone: true })
  const consequenceLink = [...guidance.research, ...guidance.remediation].find(
    (link) => link.url === consequence.url,
  )
  const { tryLink } = cardReferences(entry)
  const target =
    story === 'bounce' ? BOUNCE_HEADING_ID : guidedEntryId(metric.metric)

  return (
    <div
      className="guided-results__headline-story space-y-2 border-t-2 border-black pt-4 first-of-type:border-t-0 first-of-type:pt-0 dark:border-white"
      data-story={story}
      data-metric={metric.metric}
    >
      <h3 className="font-display text-lg font-bold tracking-tight">{label}</h3>
      <p className="guided-results__headline-value flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-2xl font-bold">{parts.value}</span>
        {parts.position !== null && (
          <span className={`guided-results__headline-position text-base ${BODY}`}>
            <span aria-hidden="true" className="hidden sm:inline">
              {'· '}
            </span>
            {parts.position}
          </span>
        )}
        {guidance.speedSensitivity !== null && (
          <span
            className={`guided-results__pace-tag shrink-0 border border-neutral-500 px-1.5 py-0.5 font-sans text-[11px] font-semibold uppercase tracking-wide dark:border-neutral-400 ${SECONDARY}`}
          >
            Varies with pace
          </span>
        )}
      </p>
      {sourceLabel && (
        <p className="guided-results__headline-source font-sans text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          Measured from {sourceLabel}
        </p>
      )}
      <p className={`guided-results__consequence ${BODY}`}>
        {consequence.text}
        {consequenceLink !== undefined && (
          <span className={SECONDARY}>
            {' · '}
            <ExternalLink url={consequenceLink.url}>
              {consequenceLink.shortTitle}
            </ExternalLink>
          </span>
        )}
      </p>
      {guidance.mandatoryNotes.map((note) => {
        const { first } = splitFirstSentence(note)
        return (
          <p key={first} role="note" className={`guided-results__headline-note ${BODY}`}>
            {first}
          </p>
        )
      })}
      {tryLineApplies(entry) && tryLink !== null && (
        <TryLine
          text={guidance.tryLine!.text}
          link={tryLink}
          cadence={metric.metric === 'cadence'}
        />
      )}
      <p className="font-sans text-sm">
        <InPageLink
          target={target}
          className="guided-results__headline-link font-semibold text-black dark:text-white"
        >
          {story === 'bounce' ? 'All three bounce measures' : `Go to the ${label} card`}
        </InPageLink>
      </p>
    </div>
  )
}

/** "Bounce in centimetres reads above 9.5 cm, but with low confidence — see its card." */
function CaveatedPast({ outcome }: { outcome: StoryOutcome }) {
  const id = guidedEntryId(outcome.entry.metric.metric)
  return (
    <>
      {capitalise(outcome.name)} reads {outcome.threshold}, but with{' '}
      {confidenceLabel(outcome.entry.metric).toLowerCase()} —{' '}
      <InPageLink target={id} className="font-semibold text-neutral-800 dark:text-neutral-200">
        see its card
        <span className="sr-only">: {METRIC_LABELS[outcome.entry.metric.metric]}</span>
      </InPageLink>
      .
    </>
  )
}

/**
 * What the section says when no story headlines, built from each story's status so it never
 * claims a reading is "not past that point" when it was not measured, is still being measured,
 * has no band shown, or is past it at low confidence. Every threshold comes from a shown band.
 */
function EnergyCostSummary({ stories }: { stories: StoryOutcome[] }) {
  const inside = stories.filter(
    (s) => s.status === 'inside' && s.threshold !== null,
  )
  const unmeasured = stories.filter((s) => s.status === 'unmeasured')
  const sentences: ReactNode[] = []
  if (inside.length > 0) {
    const clauses = inside.map((s) => `${s.name} is not ${s.threshold}`)
    sentences.push(
      `${capitalise(clauses.join(' and '))} — the ${inside.length === 1 ? 'point' : 'points'} past which energy-cost research leans one way.`,
    )
  } else {
    // Only for stories whose position is not stated anywhere else in this paragraph.
    const triggers = stories
      .filter(
        (s) =>
          (s.status === 'unmeasured' || s.status === 'pending') &&
          s.threshold !== null,
      )
      .map((s) => `${s.name} reads ${s.threshold}`)
    if (triggers.length > 0) {
      sentences.push(
        `Energy-cost research leans one way when ${triggers.join(' or ')}.`,
      )
    }
  }
  for (const s of stories) {
    if (s.status === 'caveated-past') {
      sentences.push(<CaveatedPast key={s.story} outcome={s} />)
    } else if (s.status === 'pending') {
      sentences.push(
        `${capitalise(s.name)}: measuring real-world scale with a second look at the clip…`,
      )
    } else if (s.status === 'unbanded') {
      sentences.push(`${capitalise(s.name)} has no range shown here to compare it with.`)
    }
  }
  if (unmeasured.length > 0) {
    sentences.push(
      `${capitalise(joinList(unmeasured.map((s) => s.name)))} could not be measured on this clip.`,
    )
  }
  sentences.push('The measurements are below.')
  return (
    <p className={`guided-results__headlines-empty ${MUTED}`}>
      {sentences.map((sentence, index) => (
        <Fragment key={index}>
          {index > 0 && ' '}
          {sentence}
        </Fragment>
      ))}
    </p>
  )
}

/**
 * The "Energy cost" section: a headline for each story whose spokesman reads, at the normal tier,
 * past its band on the side energy-cost research associates with a higher cost — or, with none, a
 * statement built from where each story stands. Selection and order are `selectHeadlines`'s.
 *
 * Framed only when it carries a headline: an empty section is secondary text, not a finding.
 */
function EconomyHeadlines({
  groups,
  scalePassStatus,
  sourceLabelFor,
}: {
  groups: GuidedGroups
  scalePassStatus: ScalePassStatus
  sourceLabelFor: (metric: MetricId) => string | undefined
}) {
  const headingId = useId()
  const { headlines, stories } = selectHeadlines(groups, scalePassStatus)
  const caveated = stories.filter((s) => s.status === 'caveated-past')
  return (
    <section
      aria-labelledby={headingId}
      className={`guided-results__headlines space-y-4 ${headlines.length > 0 ? 'border-2 border-black p-4 dark:border-white' : ''}`}
    >
      <h2 id={headingId} className={H2}>
        Energy cost
      </h2>
      {headlines.length > 0 ? (
        <>
          {headlines.map((headline) => (
            <EconomyHeadline
              key={headline.story}
              headline={headline}
              sourceLabel={sourceLabelFor(headline.entry.metric.metric)}
            />
          ))}
          {caveated.map((outcome) => (
            <p key={outcome.story} className={`guided-results__headlines-caveated ${MUTED}`}>
              <CaveatedPast outcome={outcome} />
            </p>
          ))}
        </>
      ) : (
        <EnergyCostSummary stories={stories} />
      )}
    </section>
  )
}

export interface GuidedMeasurementsProps {
  heuristics: FormHeuristicsResult
  scalePassStatus: ScalePassStatus
  evidence: readonly MetricCardEvidence[]
  clipCount: number
  clipViews?: readonly string[]
  sourceIndices?: Record<MetricId, number> | null
  onOpenEvidenceVideo?: (clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => void
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
  clipViews = [],
  sourceIndices = null,
  onOpenEvidenceVideo,
  guidance = METRIC_GUIDANCE,
}: GuidedMeasurementsProps) {
  const bandedHeadingId = useId()
  const unbandedHeadingId = useId()
  const notMeasuredHeadingId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const groups = guidedGroups(heuristics, guidance)
  const { banded, unbanded, notMeasured } = groups
  const bounceEntries = new Map(
    [...banded, ...unbanded, ...notMeasured].map((entry) => [entry.metric.metric, entry]),
  )
  // One rule for cards and headlines alike, so a headline names the same clip its card does.
  const sourceLabelFor = (metric: MetricId): string | undefined =>
    clipCount > 1 && sourceIndices
      ? clipSourceLabel(sourceIndices[metric], clipCount, clipViews)
      : undefined
  // Keyed by metric, never by position: evidence arrives in the extraction plan's own order.
  const evidenceByMetric = new Map(
    evidence.map((entry) => [entry.metric, entry]),
  )

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
          sourceLabel={sourceLabelFor(entry.metric.metric)}
          onOpenEvidenceVideo={onOpenEvidenceVideo}
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
      <EconomyHeadlines
        groups={groups}
        scalePassStatus={scalePassStatus}
        sourceLabelFor={sourceLabelFor}
      />

      <Contents
        entries={[
          ...banded.map((entry) => ({ entry, excluded: false })),
          ...unbanded.map((entry) => ({ entry, excluded: false })),
          ...notMeasured.map((entry) => ({ entry, excluded: true })),
        ]}
      />

      <section
        aria-labelledby={BOUNCE_HEADING_ID}
        className="guided-results__bounce space-y-3 border-l-4 border-brand-600 bg-neutral-50 p-4 dark:border-brand-400 dark:bg-neutral-900"
      >
        {/* `guided-results__scroll-target`: the same scroll margin the cards get under the sticky
            header and motion stage below 1024 px (index.css), so the headline's link lands in view. */}
        <h2
          id={BOUNCE_HEADING_ID}
          tabIndex={-1}
          className={`${H2} guided-results__scroll-target scroll-mt-4`}
        >
          Three ways to describe bounce
        </h2>
        <p className={BODY}>
          These measures describe related upward motion on different scales. Their values answer
          different questions; open each result for its evidence and limits.
        </p>
        <ol className="grid gap-3 sm:grid-cols-3">
          {BOUNCE_MEASURES.map(({ id, label, explanation }) => {
            const entry = bounceEntries.get(id)
            if (!entry) return null
            const excluded = metricTier(entry.metric) === 'excluded'
            const targetId = guidedEntryId(id)
            return (
              <li key={id} className="border-t border-neutral-300 pt-2 dark:border-neutral-700">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <a
                    href={`#${targetId}`}
                    onClick={(event) => revealMetric(event, targetId)}
                    className={`font-sans text-sm font-semibold text-black underline underline-offset-2 dark:text-white ${FOCUS}`}
                  >
                    {label}
                  </a>
                  <span className={`tabular-nums ${MUTED}`}>
                    {guidedHeadline(entry, excluded) ?? 'not measured'}
                  </span>
                </div>
                <p className={BODY}>{explanation}</p>
              </li>
            )
          })}
        </ol>
      </section>

      {banded.length > 0 && (
        <section
          aria-labelledby={bandedHeadingId}
          className="guided-results__group guided-results__group--banded space-y-4"
        >
          {/* No intro paragraph: every card below carries its own citation line, which says whose
              range it is over whom, so a paragraph restating that for all five is words the reader
              has to get past to reach the first number. */}
          <h2 id={bandedHeadingId} className={H2}>
            Compared with published research
          </h2>
          {cards(banded, 'framed')}
        </section>
      )}

      {unbanded.length > 0 && (
        <section
          aria-labelledby={unbandedHeadingId}
          className="guided-results__group guided-results__group--unbanded space-y-3"
        >
          <h2 id={unbandedHeadingId} className={H2}>
            {anyWithheld
              ? 'Measured, no range shown'
              : 'Measured, no published range'}
          </h2>
          <details className="guided-results__group-details border-2 border-black dark:border-white">
            <summary className={SUMMARY}>
              {plural(unbanded.length, 'measurement')}: {names(unbanded)}
            </summary>
            {/* Each card states its own reason for having no range, so the group intro that said
                so for all seven is gone; the heading above already says which group this is. */}
            <div className="space-y-6 px-5 pb-5">
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
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
