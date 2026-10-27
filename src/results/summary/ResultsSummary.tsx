import { useCallback, useMemo, useRef, useState } from 'react'
import type { FormHeuristicsResult, MetricId, View } from '../../heuristics/types'
import { feedbackFor } from '../../guidance/feedbackPoints'
import { FOCUS_AREAS } from '../../guidance/focusAreas'
import type { FocusAreaId } from '../../guidance/focusAreas'
import { ModelRunner } from '../../runner/ModelRunner'
import { bindRunnerParams } from '../../runner/runnerParams'
import { BandLegend } from '../BandLegend'
import { clipSourceLabel } from '../clipProvenance'
import { FOCUS_AREA_CAMERA, NO_FOCUS_CAMERA, runnerFocusFor } from '../focusAreaCamera'
import { GuidedResultsView } from '../GuidedResultsView'
import type { GuidedResultsViewProps } from '../GuidedResultsView'
import type { MetricCardEvidence } from '../MetricsPanel'
import { useRevealFragment } from '../revealFragment'
import { runnerFootageFor } from '../runnerFootagePlate'
import type { ScalePassStatus } from '../types'
import { FocusAreaRow, NotMeasuredRow } from './FocusAreaRow'
import { hasCompactBar } from './summaryLabels'
import { summaryRows } from './summaryRows'
import { useWideLayout } from './useWideLayout'

export interface ResultsSummaryProps extends GuidedResultsViewProps {
  /** Back into the tour. Leaves the remembered landing alone: replaying is a one-off. */
  onReplayTour: () => void
  /** Into the classic table, which the session writes to the address as `view=classic`. */
  onOpenClassic: () => void
}

const NO_EVIDENCE: readonly MetricCardEvidence[] = []
const NO_CLIP_VIEWS: readonly string[] = []
const NO_VIEW_KINDS: readonly (View | null)[] = []

const FOOTER_LINK =
  'inline-flex min-h-11 items-center px-1 font-sans text-sm font-semibold text-black underline underline-offset-4 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-white dark:hover:text-brand-400'

/**
 * The results summary — where a reader lands after skipping or finishing the tour: the model
 * runner beside one collapsed row per measured focus area, each opening to that area's cards at
 * full depth, then one "Not measured" row.
 *
 * It renders its body through `GuidedResultsView`'s slot, so the shell stays single: no completion
 * line of its own (the guided view renders the one the e2e suite and the A/B harness wait on), and
 * exactly one "Analysis results" section. Evidence arrives as a prop from the session's one
 * acquisition, and each card mounts once, in its row; a collapsed row hides its card without
 * unmounting it, so the canvases keep their one parent.
 *
 * "Classic table" is a link-STYLED button, not an `<a href>`: the analysis lives in memory, so
 * following a real link — or opening it in a new tab — would load a page with no results on it.
 */
export function ResultsSummary({ onReplayTour, onOpenClassic, ...guidedProps }: ResultsSummaryProps) {
  const { heuristics } = guidedProps.analysis
  return (
    <div className="results-summary space-y-6">
      {/* The summary's focus target after a switch (`data-view-entry`). It sits at the top, so
          arriving here does not scroll the page down to the footer's controls. */}
      <h2 tabIndex={-1} data-view-entry className="font-display text-xl font-bold tracking-tight focus:outline-none">
        Summary
      </h2>
      <GuidedResultsView {...guidedProps}>
        {heuristics ? (
          <SummaryBody
            heuristics={heuristics}
            scalePassStatus={guidedProps.analysis.scalePass.status}
            evidence={guidedProps.evidence ?? NO_EVIDENCE}
            clipCount={guidedProps.clipCount ?? 1}
            clipViews={guidedProps.clipViews ?? NO_CLIP_VIEWS}
            clipViewKinds={guidedProps.clipViewKinds ?? NO_VIEW_KINDS}
            sourceIndices={guidedProps.sourceIndices ?? null}
            onOpenEvidenceVideo={guidedProps.onOpenEvidenceVideo}
          />
        ) : null}
      </GuidedResultsView>
      {/* Both controls live down here, not at the top: the tour's Skip sits at the top, and a
          control at the same spot in the summary would catch a double click or tap and send the
          reader straight back. `min-h-11` keeps each a 44 px touch target. */}
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t-2 border-black pt-4 dark:border-white">
        <button type="button" onClick={onReplayTour} className={FOOTER_LINK}>
          Replay tour
        </button>
        <button type="button" onClick={onOpenClassic} className={FOOTER_LINK}>
          Classic table
        </button>
      </footer>
    </div>
  )
}

interface SummaryBodyProps {
  heuristics: FormHeuristicsResult
  scalePassStatus: ScalePassStatus
  evidence: readonly MetricCardEvidence[]
  clipCount: number
  clipViews: readonly string[]
  clipViewKinds: readonly (View | null)[]
  sourceIndices: Record<MetricId, number> | null
  onOpenEvidenceVideo?: GuidedResultsViewProps['onOpenEvidenceVideo']
}

/**
 * The runner and the rows. The runner is ONE mounted `ModelRunner` for the life of the summary:
 * opening a row changes only its camera, focus and rate, so it tweens rather than remounting.
 *
 * At `lg` and up the camera follows the most recently opened row. Closing that row returns it to
 * the whole figure; closing any other row leaves it be. Below `lg` the runner sits above the rows,
 * usually scrolled out of view by the time a row opens, so it stays on the whole figure and the tour
 * carries the camera story on phones. Rows do not close each other (no `name`), so a reader can
 * keep two areas open to compare them.
 */
function SummaryBody({
  heuristics,
  scalePassStatus,
  evidence,
  clipCount,
  clipViews,
  clipViewKinds,
  sourceIndices,
  onOpenEvidenceVideo,
}: SummaryBodyProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useRevealFragment(rootRef)
  const [openedArea, setOpenedArea] = useState<FocusAreaId | null>(null)
  const wide = useWideLayout()
  const activeArea = wide ? openedArea : null

  const { rows, notMeasured } = useMemo(() => {
    const { areas, notMeasured } = summaryRows(heuristics)
    return {
      rows: areas.map((row) => ({ ...row, feedback: feedbackFor(row.view) })),
      notMeasured,
    }
  }, [heuristics])
  const params = useMemo(() => bindRunnerParams(heuristics), [heuristics])
  const activeRow = rows.find((row) => row.view.area === activeArea) ?? null
  const focus = useMemo(
    () =>
      activeRow === null
        ? undefined
        : runnerFocusFor(activeRow.entries.map((entry) => entry.metric.metric)),
    [activeRow],
  )
  const { camera, playbackRate } =
    activeRow === null ? NO_FOCUS_CAMERA : FOCUS_AREA_CAMERA[activeRow.view.area]
  // The opened side row's headline frame, faintly behind the still figure. Below lg the camera
  // stays on the whole figure with no focus, so there is none.
  const footage = useMemo(
    () => runnerFootageFor({ focus, camera, evidence, sourceIndices, clipViewKinds }),
    [focus, camera, evidence, sourceIndices, clipViewKinds],
  )
  // Keyed by metric, never by position: evidence arrives in the extraction plan's own order.
  const evidenceByMetric = useMemo(
    () => new Map(evidence.map((entry) => [entry.metric, entry])),
    [evidence],
  )
  const sourceLabelFor = useCallback(
    (metric: MetricId): string | undefined =>
      clipCount > 1 && sourceIndices
        ? clipSourceLabel(sourceIndices[metric], clipCount, clipViews)
        : undefined,
    [clipCount, sourceIndices, clipViews],
  )
  const anyBar = rows.some(({ entries: [headline] }) => hasCompactBar(headline))

  const onRowToggle = useCallback(
    (area: FocusAreaId, open: boolean) =>
      setOpenedArea((current) => (open ? area : current === area ? null : current)),
    [],
  )

  return (
    <div
      ref={rootRef}
      className="results-summary__body space-y-6 lg:grid lg:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0"
    >
      {/* In flow at the top below lg, never a background behind the rows; beside them, and sticky
          under the session header, at lg. */}
      <div
        className="results-summary__runner border-2 border-black p-3 lg:sticky lg:top-[calc(var(--motion-story-header-height,88px)_+_1rem)] lg:self-start dark:border-white"
        data-camera={camera}
        data-focus-area={activeArea ?? ''}
      >
        <ModelRunner
          params={params}
          camera={camera}
          focus={focus}
          playbackRate={playbackRate}
          label={`Model runner, ${activeRow === null ? 'whole body' : activeRow.view.label.toLowerCase()}`}
          footage={footage}
          className="h-56 lg:h-[min(28rem,calc(100dvh-14rem))]"
        />
        {playbackRate < 1 && (
          <p className="results-summary__slow-motion mt-2 font-sans text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
            Slow motion
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        {anyBar && <BandLegend className="results-summary__legend" />}
        <div className="results-summary__rows divide-y-2 divide-black border-2 border-black dark:divide-white dark:border-white">
          {rows.map(({ view, entries, feedback }) => (
            <FocusAreaRow
              key={view.area}
              area={view.area}
              label={FOCUS_AREAS[view.area].label}
              entries={entries}
              feedback={feedback}
              evidenceByMetric={evidenceByMetric}
              clipCount={clipCount}
              sourceLabelFor={sourceLabelFor}
              onOpenEvidenceVideo={onOpenEvidenceVideo}
              onToggle={onRowToggle}
            />
          ))}
          {notMeasured.length > 0 && (
            <NotMeasuredRow entries={notMeasured} scalePassStatus={scalePassStatus} />
          )}
        </div>
      </div>
    </div>
  )
}
