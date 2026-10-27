import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '../../guidance/focusAreas'
import type { TourStopId } from '../../guidance/focusAreas'
import { ONE_THING_LABEL } from '../../guidance/feedbackPoints'
import { ModelRunner } from '../../runner/ModelRunner'
import type { RunnerFocus } from '../../runner/ModelRunner'
import { bindRunnerParams } from '../../runner/runnerParams'
import type { CameraPreset } from '../../runner/types'
import { usePrefersReducedMotion } from '../../runner/usePrefersReducedMotion'
import { useRunnerIntro } from '../../runner/useRunnerIntro'
import { BandLegend } from '../BandLegend'
import { NO_FOCUS_CAMERA, runnerFocusFor } from '../focusAreaCamera'
import { GuidedResultsView } from '../GuidedResultsView'
import type { GuidedResultsViewProps } from '../GuidedResultsView'
import { useRevealFragment } from '../revealFragment'
import type { SessionCoverage } from '../sessionCoverage'
import { hasCompactBar } from '../summary/summaryLabels'
import { introCamera, stopCamera, tourPlan, tourStopDomId } from './tourPlan'
import type { TourPlan } from './tourPlan'
import { AreaStop, OneThingStop } from './TourStop'
import { useActiveStop } from './useActiveStop'
import { useMostlyVisible } from './useMostlyVisible'

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
  /**
   * Which camera views the session has and is missing: the intro's camera, and the end of the
   * tour's capture hint (the session shows no coverage notice above the tour).
   */
  coverage: SessionCoverage | null
  /** Opens the header's add-a-clip panel, offered by the end of the tour's capture hint. */
  onAddClip?: () => void
}

/**
 * The sticky bar under the session header: the tour's heading, where the reader is, and Skip, in
 * view for the whole tour. `min-h-14` is the 3.5rem the rail and the stops offset themselves by.
 */
export const TOUR_BAR_CLASS =
  'runner-tour__header sticky top-[var(--motion-story-header-height,88px)] z-[5] flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-white py-2 dark:bg-black'
/**
 * The runner and the stops: the rail first (left) and wider at `lg`, the runner in flow above the
 * stops below it.
 */
export const TOUR_BODY_CLASS =
  'runner-tour__body space-y-6 lg:grid lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)] lg:items-start lg:gap-8 lg:space-y-0'
/**
 * The runner's rail: sticky under the header and the tour's bar at `lg`, in flow above the stops
 * below it. Named so the phone layout (`strides-trn2.4`) can make it a background with `max-lg:`.
 */
export const TOUR_RAIL_CLASS =
  'runner-tour__rail border-2 border-black p-3 lg:sticky lg:top-[calc(var(--motion-story-header-height,88px)_+_4.5rem)] lg:self-start dark:border-white'
/**
 * The runner's own height at `lg`: the viewport below the session header, less the tour's bar, the
 * rail's frame and the slow-motion and legend lines under the figure, so all of them stay on screen.
 */
const RUNNER_HEIGHT_CLASS =
  'h-56 lg:h-[calc(100dvh_-_var(--motion-story-header-height,88px)_-_11rem)]'

/** Every area's metrics in tour order: the intro applies the figure's parameters in this order. */
const INTRO_ORDER: readonly MetricId[] = FOCUS_AREA_ORDER.flatMap((area) => FOCUS_AREAS[area].metricIds)

const SKIP_CLASS =
  'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black'
/** A 24 px target around each progress dot (WCAG 2.2 target size, minimum). */
const DOT_LINK =
  'inline-flex h-6 w-6 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600'
const DOT =
  'block h-2.5 w-2.5 rounded-full border-2 border-black dark:border-white forced-colors:border-[color:CanvasText]'
const DOT_ACTIVE = 'bg-black dark:bg-white forced-colors:bg-[color:Highlight]'

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
 *
 * The plan and the active stop live here, above the shell, because the sticky bar's progress dots
 * show the active stop as well as the body.
 */
export function RunnerTour({ onLeaveTour, resultKey, coverage, onAddClip, ...guidedProps }: RunnerTourProps) {
  const { heuristics } = guidedProps.analysis
  const scalePassStatus = guidedProps.analysis.scalePass.status
  const rootRef = useRef<HTMLDivElement>(null)
  const plan = useMemo(
    () => (heuristics ? tourPlan(heuristics, scalePassStatus, coverage) : null),
    [heuristics, scalePassStatus, coverage],
  )
  const stopIds: TourStopId[] =
    plan === null ? [] : [...plan.areaStops.map((stop) => stop.view.area), 'oneThing']
  const active = useActiveStop(rootRef, stopIds)
  return (
    <div ref={rootRef} className="runner-tour">
      <div className={TOUR_BAR_CLASS}>
        {/* The tour's focus target after a switch (`data-view-entry`): a heading rather than Skip, so
            a reader arriving here hears where they are rather than an action they did not ask for. */}
        <h2 tabIndex={-1} data-view-entry className="font-display text-xl font-bold tracking-tight focus:outline-none">
          Your runner model
        </h2>
        <div className="flex items-center gap-4">
          {stopIds.length > 0 && <TourProgress stopIds={stopIds} active={active} />}
          <button type="button" onClick={onLeaveTour} className={SKIP_CLASS}>
            Skip to summary
          </button>
        </div>
      </div>
      <GuidedResultsView {...guidedProps}>
        {heuristics && plan !== null ? (
          <TourBody
            heuristics={heuristics}
            plan={plan}
            stopIds={stopIds}
            active={active}
            introPreset={introCamera(coverage)}
            resultKey={resultKey}
            onSeeAll={onLeaveTour}
            onAddClip={onAddClip}
          />
        ) : null}
      </GuidedResultsView>
    </div>
  )
}

/**
 * Where the reader is: one dot per stop, each a link to its `#tour-<stop>` fragment, the active one
 * filled and `aria-current`. Each tells assistive technology "Stop N of M" and the stop's name.
 */
function TourProgress({ stopIds, active }: { stopIds: readonly TourStopId[]; active: TourStopId | null }) {
  return (
    <nav aria-label="Tour stops" className="runner-tour__progress">
      <ol className="flex items-center">
        {stopIds.map((id, index) => (
          <li key={id}>
            <a href={`#${tourStopDomId(id)}`} aria-current={id === active ? 'step' : undefined} className={DOT_LINK}>
              <span aria-hidden="true" className={`${DOT} ${id === active ? DOT_ACTIVE : ''}`} />
              <span className="sr-only">
                Stop {index + 1} of {stopIds.length}: {id === 'oneThing' ? ONE_THING_LABEL : FOCUS_AREAS[id].label}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * `runnerFocusFor` over a metric id, memoised on the id: the result is rebuilt on every session
 * render, and a focus on the same metric must stay the same object.
 */
function useRunnerFocus(metric: MetricId | null): RunnerFocus | undefined {
  return useMemo(() => (metric === null ? undefined : runnerFocusFor([metric])), [metric])
}

interface TourBodyProps {
  heuristics: FormHeuristicsResult
  plan: TourPlan
  stopIds: readonly TourStopId[]
  active: TourStopId | null
  /** The intro's camera (`introCamera`), and the runner's for as long as the intro runs. */
  introPreset: CameraPreset
  resultKey: string
  onSeeAll: () => void
  onAddClip?: () => void
}

/**
 * The rail and the stops. The rail holds ONE mounted `ModelRunner` for the life of the tour, never
 * keyed by stop: a stop changes only its camera, focus and rate, so the figure tweens rather than
 * remounting, and the reader's Pause survives every stop.
 *
 * The intro plays first, from `introPreset`, which is the runner's camera for as long as the intro
 * runs (no stop is shown then), so the two agree on which lateral parameters get a step. It starts
 * only once the rail is at least 90% on screen as well as seen by the runner, so it never plays out
 * below the fold. Reading on past the first stop ends it.
 *
 * The runner's focus is the shown stop's HEADLINE metric only, so the figure never labels a number
 * the stop's text does not state.
 */
function TourBody({
  heuristics,
  plan,
  stopIds,
  active,
  introPreset,
  resultKey,
  onSeeAll,
  onAddClip,
}: TourBodyProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  useRevealFragment(rootRef)
  const reducedMotion = usePrefersReducedMotion()
  const activeIndex = active === null ? -1 : stopIds.indexOf(active)

  const params = useMemo(() => bindRunnerParams(heuristics), [heuristics])
  const [runnerSeen, setRunnerSeen] = useState(false)
  const railVisible = useMostlyVisible(railRef)
  const intro = useRunnerIntro({
    bound: params,
    resultKey,
    order: INTRO_ORDER,
    camera: introPreset,
    active: runnerSeen && railVisible,
  })
  const { running: introRunning, skip: skipIntro } = intro
  useEffect(() => {
    if (introRunning && activeIndex >= 1) skipIntro()
  }, [introRunning, activeIndex, skipIntro])

  const shown = introRunning ? null : active
  const shownArea = plan.areaStops.find((stop) => stop.view.area === shown) ?? null
  const focusMetric: MetricId | null =
    shownArea !== null
      ? shownArea.entries[0].metric.metric
      : shown === 'oneThing' && plan.oneThing.kind === 'cue'
        ? plan.oneThing.metric
        : null
  const focus = useRunnerFocus(focusMetric)
  const { camera, playbackRate } = introRunning
    ? { camera: introPreset, playbackRate: NO_FOCUS_CAMERA.playbackRate }
    : shown === null
      ? NO_FOCUS_CAMERA
      : stopCamera(shown)
  const runnerLabel = shownArea === null ? 'whole body' : shownArea.view.label.toLowerCase()
  const showLegend = shownArea !== null && hasCompactBar(shownArea.entries[0])

  return (
    <div ref={rootRef} className={TOUR_BODY_CLASS}>
      <div ref={railRef} className={TOUR_RAIL_CLASS} data-camera={camera} data-active-stop={shown ?? ''}>
        <ModelRunner
          params={params}
          camera={camera}
          focus={focus}
          playbackRate={playbackRate}
          label={`Model runner, ${runnerLabel}`}
          overrides={intro.overrides}
          intro={{ running: introRunning, onSkip: skipIntro }}
          onActiveChange={setRunnerSeen}
          className={RUNNER_HEIGHT_CLASS}
        />
        {playbackRate < 1 && !reducedMotion && (
          <p className="runner-tour__slow-motion mt-2 font-sans text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
            Slow motion
          </p>
        )}
        {showLegend && <BandLegend className="runner-tour__legend mt-2" />}
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
          onAddClip={onAddClip}
        />
      </div>
    </div>
  )
}
