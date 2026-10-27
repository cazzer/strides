import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '../../guidance/focusAreas'
import type { TourStopId } from '../../guidance/focusAreas'
import { ModelRunner } from '../../runner/ModelRunner'
import type { RunnerFocus } from '../../runner/ModelRunner'
import { bindRunnerParams } from '../../runner/runnerParams'
import { usePrefersReducedMotion } from '../../runner/usePrefersReducedMotion'
import { useRunnerIntro } from '../../runner/useRunnerIntro'
import { BandLegend } from '../BandLegend'
import { NO_FOCUS_CAMERA, runnerFocusFor } from '../focusAreaCamera'
import { GuidedResultsView } from '../GuidedResultsView'
import type { GuidedResultsViewProps } from '../GuidedResultsView'
import { useRevealFragment } from '../revealFragment'
import type { SessionCoverage } from '../sessionCoverage'
import { hasCompactBar } from '../summary/summaryLabels'
import type { ScalePassStatus } from '../types'
import { stopCamera, tourPlan } from './tourPlan'
import { AreaStop, OneThingStop } from './TourStop'
import { useActiveStop } from './useActiveStop'

export interface RunnerTourProps extends GuidedResultsViewProps {
  /** The reader skipped (or finished) the tour. The session remembers the summary as the landing
   * view and switches to it. */
  onLeaveTour: () => void
  /**
   * The analysis session's id, a STRING: a new one plays the intro, a played one does not. Never
   * the fused result, which is rebuilt on every session render and again on the scale-pass graft.
   * The session folds a replay count in, so "Replay tour" plays the intro again.
   */
  resultKey: string
  /** Which camera views the session is missing, for the end of the tour's capture hint. */
  coverage: SessionCoverage | null
}

/**
 * The sticky bar under the session header: the tour's heading and Skip, in view for the whole tour.
 * `min-h-14` is the 3.5rem the rail and the stops offset themselves by.
 */
export const TOUR_BAR_CLASS =
  'runner-tour__header sticky top-[var(--motion-story-header-height,88px)] z-[5] flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-white py-2 dark:bg-black'
/** The runner and the stops: side by side at `lg`, the runner in flow above the stops below it. */
export const TOUR_BODY_CLASS =
  'runner-tour__body space-y-6 lg:grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0'
/**
 * The runner's rail: sticky under the header and the tour's bar at `lg`, in flow above the stops
 * below it. Named so the phone layout (`strides-trn2.4`) can make it a background with `max-lg:`.
 */
export const TOUR_RAIL_CLASS =
  'runner-tour__rail border-2 border-black p-3 lg:sticky lg:top-[calc(var(--motion-story-header-height,88px)_+_4.5rem)] lg:self-start dark:border-white'

/** Every area's metrics in tour order: the intro applies the figure's parameters in this order. */
const INTRO_ORDER: readonly MetricId[] = FOCUS_AREA_ORDER.flatMap((area) => FOCUS_AREAS[area].metricIds)
/**
 * The intro's camera, which is also the runner's for as long as the intro runs (no stop is shown
 * then), so the two always agree on which lateral parameters get a step.
 */
const INTRO_CAMERA = NO_FOCUS_CAMERA.camera

const SKIP_CLASS =
  'inline-flex min-h-11 items-center justify-center border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black'

/**
 * The runner tour — the default results view: the model runner beside one stop per measured focus
 * area, then the one-thing stop. The stop at the reading line points the runner's camera.
 *
 * Deliberately renders NO completion line of its own. `GuidedResultsView` already renders the one
 * `role="status"` "Analysis complete." the e2e suite and the A/B harness wait on, and a second match
 * would break Playwright's strict locator in both. Likewise the root is a plain `div`, not a section
 * labelled "Analysis results": the guided view inside it is that section, and there is exactly one.
 *
 * The tour mounts no metric card and so no evidence canvas: those mount once the reader moves on to
 * the summary, which holds every card.
 */
export function RunnerTour({ onLeaveTour, resultKey, coverage, ...guidedProps }: RunnerTourProps) {
  const { heuristics } = guidedProps.analysis
  return (
    <div className="runner-tour">
      <div className={TOUR_BAR_CLASS}>
        {/* The tour's focus target after a switch (`data-view-entry`): a heading rather than Skip, so
            a reader arriving here hears where they are rather than an action they did not ask for. */}
        <h2 tabIndex={-1} data-view-entry className="font-display text-xl font-bold tracking-tight focus:outline-none">
          Your runner
        </h2>
        <button type="button" onClick={onLeaveTour} className={SKIP_CLASS}>
          Skip to summary
        </button>
      </div>
      <GuidedResultsView {...guidedProps}>
        {heuristics ? (
          <TourBody
            heuristics={heuristics}
            scalePassStatus={guidedProps.analysis.scalePass.status}
            coverage={coverage}
            resultKey={resultKey}
            onSeeAll={onLeaveTour}
          />
        ) : null}
      </GuidedResultsView>
    </div>
  )
}

/**
 * `runnerFocusFor` over a comma-joined list of metric ids, memoised on the list itself: the result
 * is rebuilt on every session render, and a focus of the same ids must stay the same object.
 */
function useRunnerFocus(metricKey: string): RunnerFocus | undefined {
  return useMemo(
    () => (metricKey === '' ? undefined : runnerFocusFor(metricKey.split(',') as MetricId[])),
    [metricKey],
  )
}

interface TourBodyProps {
  heuristics: FormHeuristicsResult
  scalePassStatus: ScalePassStatus
  coverage: SessionCoverage | null
  resultKey: string
  onSeeAll: () => void
}

/**
 * The rail and the stops. The rail holds ONE mounted `ModelRunner` for the life of the tour, never
 * keyed by stop: a stop changes only its camera, focus and rate, so the figure tweens rather than
 * remounting, and the reader's Pause survives every stop.
 *
 * The intro plays first, on the whole figure. Reading on past the first stop ends it; until then no
 * stop points the camera.
 */
function TourBody({ heuristics, scalePassStatus, coverage, resultKey, onSeeAll }: TourBodyProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useRevealFragment(rootRef)
  const reducedMotion = usePrefersReducedMotion()

  const plan = useMemo(
    () => tourPlan(heuristics, scalePassStatus, coverage),
    [heuristics, scalePassStatus, coverage],
  )
  const stopIds: TourStopId[] = [...plan.areaStops.map((stop) => stop.view.area), 'oneThing']
  const active = useActiveStop(rootRef, stopIds)
  const activeIndex = active === null ? -1 : stopIds.indexOf(active)

  const params = useMemo(() => bindRunnerParams(heuristics), [heuristics])
  const [runnerSeen, setRunnerSeen] = useState(false)
  const intro = useRunnerIntro({
    bound: params,
    resultKey,
    order: INTRO_ORDER,
    camera: INTRO_CAMERA,
    active: runnerSeen,
  })
  const { running: introRunning, skip: skipIntro } = intro
  useEffect(() => {
    if (introRunning && activeIndex >= 1) skipIntro()
  }, [introRunning, activeIndex, skipIntro])

  const shown = introRunning ? null : active
  const shownArea = plan.areaStops.find((stop) => stop.view.area === shown) ?? null
  const focusMetrics: readonly MetricId[] =
    shownArea !== null
      ? shownArea.entries.map((entry) => entry.metric.metric)
      : shown === 'oneThing' && plan.oneThing.kind === 'cue'
        ? [plan.oneThing.metric]
        : []
  const focus = useRunnerFocus(focusMetrics.join(','))
  const { camera, playbackRate } = shown === null ? NO_FOCUS_CAMERA : stopCamera(shown)
  const runnerLabel = shownArea === null ? 'whole body' : shownArea.view.label.toLowerCase()
  const anyBar = plan.areaStops.some(({ entries: [headline] }) => hasCompactBar(headline))

  return (
    <div ref={rootRef} className={TOUR_BODY_CLASS}>
      <div className={TOUR_RAIL_CLASS} data-camera={camera} data-active-stop={shown ?? ''}>
        <ModelRunner
          params={params}
          camera={camera}
          focus={focus}
          playbackRate={playbackRate}
          label={`Model runner, ${runnerLabel}`}
          overrides={intro.overrides}
          intro={{ running: introRunning, onSkip: skipIntro }}
          onActiveChange={setRunnerSeen}
          className="h-56 lg:h-[min(30rem,calc(100dvh-16rem))]"
        />
        {playbackRate < 1 && !reducedMotion && (
          <p className="runner-tour__slow-motion mt-2 font-sans text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
            Slow motion
          </p>
        )}
        {anyBar && <BandLegend className="runner-tour__legend mt-2" />}
      </div>
      <div className="runner-tour__stops min-w-0">
        {plan.areaStops.map((stop) => (
          <AreaStop key={stop.view.area} stop={stop} />
        ))}
        <OneThingStop
          oneThing={plan.oneThing}
          unmeasured={plan.unmeasured}
          captureHint={plan.captureHint}
          onSeeAll={onSeeAll}
        />
      </div>
    </div>
  )
}
