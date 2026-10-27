import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
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
import { useShortPhoneLayout } from './useShortPhoneLayout'

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
 * view for the whole tour. `min-h-14` is the 3.5rem the rail and the stops offset themselves by at
 * `lg`. Below `lg` the heading is visually hidden (it stays the tour's focus target), so the dots and
 * Skip share one row, and the tour measures the bar (`--runner-tour-bar-height`,
 * `useBarHeightProperty`) rather than assuming its height.
 *
 * On a short phone (`useShortPhoneLayout`) the dots and Skip move into the tour's body, as one row
 * shared with the runner's controls (`TOUR_BAR_ROW_CLASS`), and this bar holds only the heading, so
 * it takes no room (`TOUR_HEADING_ONLY_CLASS`).
 */
export const TOUR_BAR_CLASS =
  'runner-tour__header sticky top-[var(--motion-story-header-height,88px)] z-[5] flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-white py-2 dark:bg-black'
/** The bar on a short phone: just the visually hidden heading, which takes no room. */
const TOUR_HEADING_ONLY_CLASS = 'runner-tour__heading-only'
/** The bar's dots and Skip: a group beside the heading at `lg`, the whole row below it. */
const TOUR_BAR_ACTIONS_CLASS = 'flex items-center gap-4 max-lg:w-full max-lg:justify-between max-lg:gap-2'
/**
 * A short phone's one row for the tour's dots and Skip AND the runner's controls (Skip intro, Pause,
 * laid over the row's start, which the row's padding leaves clear: `--rt-controls-width`, measured
 * by `useControlsWidthProperty`). It is a cell of the body's grid beside the runner, so it sticks
 * exactly when the runner's controls do (a sticky element only moves within its containing block;
 * in the tour's bar, above the body, the two would part company until the tour reached the top),
 * opaque and edge to edge like the old control row, at the top of the stage (`--rt-controls`). The
 * dots wrap onto 24 px lines of their own rather than pushing Skip off the row.
 */
const TOUR_BAR_ROW_CLASS =
  'runner-tour__header sticky top-[var(--motion-story-header-height,88px)] z-[5] col-start-1 row-start-1 -mx-4 flex self-start border-b-2 border-black bg-white py-1 pr-4 pl-[calc(1rem_+_var(--rt-controls-width,0px)_+_0.5rem)] sm:-mx-6 sm:pr-6 sm:pl-[calc(1.5rem_+_var(--rt-controls-width,0px)_+_0.5rem)] dark:border-white dark:bg-black'
const TOUR_BAR_ROW_ACTIONS_CLASS = 'flex min-w-0 flex-1 items-start justify-between gap-2'
/**
 * The runner and the stops: the rail first (left) and wider at `lg`. Below `lg` the runner's parts
 * and the stops share ONE grid cell, so the runner is a background the stops' panels scroll over:
 * the stage and the runner's controls stick under the tour's bar (sticky within the tour, so they
 * never cover the content above or below it).
 *
 * The phone geometry, as custom properties every phone rule below reads:
 * - `--rt-top`: where the runner sticks, under the session header and the tour's bar;
 * - `--rt-controls`: the runner's control row (44 px targets and their padding), which overlays the
 *   top of the stage; on a short phone the row it shares with the tour's dots and Skip, measured
 *   (`useRowHeightProperty`);
 * - `--rt-draw-top`: where the drawing starts in the stage, just under that row;
 * - `--rt-draw-min`: the drawing's floor, `max(40svh, 200px)`, or the whole stage below
 *   `--rt-draw-top` if that is less. The drawing is never shrunk below it to make room for a panel
 *   (`strides-xsl3`): a panel that needs more room overlaps the drawing's bottom instead, on its
 *   translucent surface;
 * - `--rt-clear`: the top of the floor that no panel covers at rest (85% of it). The camera centres
 *   its target (the focus body part) in the drawing and the focus parts reach no lower than that,
 *   so the panel's height is capped to leave it clear (`TOUR_PANEL_CLASS`);
 * - `--rt-reserve`: how much of the bottom of the viewport the active stop's panel covers at rest.
 *   The drawing stops above it whenever that still leaves it its floor, so the camera's target sits
 *   in the uncovered part. Measured (`usePanelReserveProperty`); the value here is the fallback.
 */
export const TOUR_BODY_CLASS =
  'runner-tour__body grid grid-cols-1 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)] lg:items-start lg:gap-8 [--rt-top:calc(var(--motion-story-header-height,88px)_+_var(--runner-tour-bar-height,3.75rem))] [--rt-controls:3.25rem] [--rt-draw-top:calc(var(--rt-controls)_+_0.25rem)] [--rt-draw-min:min(max(40svh,200px),calc(100dvh_-_var(--rt-top)_-_var(--rt-draw-top)))] [--rt-clear:calc(var(--rt-draw-min)_*_0.85)] [--rt-reserve:min(17.5rem,50%)]'
/**
 * The runner's rail: sticky under the header and the tour's bar at `lg`. Below `lg` it has no box
 * of its own (`contents`): the runner and its notes become cells of the body's grid, so they can be
 * placed under the stops one by one.
 */
export const TOUR_RAIL_CLASS =
  'runner-tour__rail border-2 border-black p-3 max-lg:contents lg:sticky lg:top-[calc(var(--motion-story-header-height,88px)_+_4.5rem)] lg:self-start dark:border-white'
/**
 * The runner itself. At `lg`, its own height: the viewport below the session header, less the
 * tour's bar, the rail's frame and the slow-motion and legend lines under the figure, so all of them
 * stay on screen.
 *
 * Below `lg` the figure fills the body's one grid cell (as tall as the stops), and its parts stick
 * inside it, styled from here through the runner's `data-runner-part` hooks (pinned by
 * `runnerPhoneStructure.test.tsx`), so `src/runner` carries no phone code:
 * - the stage: a background as tall as the viewport under the bar, edge to edge, under the panels.
 *   Edge to edge is `-mx-4 sm:-mx-6`, which undoes the session's `<main>` padding (`px-4 sm:px-6`,
 *   `MultiClipVideoSession`): change one and the other must follow, or the page scrolls sideways;
 * - the drawing: inset from the stage's top by the control row (`--rt-draw-top`) and from its
 *   bottom by the active panel's reserve, but never shorter than its floor (`--rt-draw-min`), so
 *   its centre (the camera's target) is in the part of the screen no panel covers. Clipped at its
 *   top edge (the control row's border) but free below and to the sides, so a zoomed-in figure runs
 *   on behind the panel; the ground hairline is hidden, as it would show through the panel as a
 *   stray rule;
 * - the control row (Skip intro, Pause, `RUNNER_CONTROL_ROW_CLASS`): stuck under the bar ABOVE the
 *   panels, opaque, so it stays tappable whatever scrolls under it, and taking no room in the flow.
 *   Its "Dashed: …" note hangs below it, at the top of the notes stack. On a short phone the
 *   controls are laid over the start of the tour's own row instead (`RUNNER_CONTROLS_IN_ROW_CLASS`);
 * - the caption: for assistive technology only (the tour's bar already says whose model this is).
 */
const RUNNER_CLASS = [
  'lg:h-[calc(100dvh_-_var(--motion-story-header-height,88px)_-_11rem)]',
  'max-lg:col-start-1 max-lg:row-start-1',
  'max-lg:[&_[data-runner-part=caption]]:sr-only',
  'max-lg:[&_[data-runner-part=stage]]:pointer-events-none max-lg:[&_[data-runner-part=stage]]:sticky max-lg:[&_[data-runner-part=stage]]:top-[var(--rt-top)] max-lg:[&_[data-runner-part=stage]]:-mx-4 max-lg:[&_[data-runner-part=stage]]:h-[calc(100dvh_-_var(--rt-top))] max-lg:[&_[data-runner-part=stage]]:flex-none sm:max-lg:[&_[data-runner-part=stage]]:-mx-6',
  // An explicit height, not `bottom`: an absolutely positioned SVG with `height: auto` takes its
  // viewBox's aspect ratio rather than stretching between `top` and `bottom`.
  'max-lg:[&_[data-runner-part=drawing]]:top-[var(--rt-draw-top)] max-lg:[&_[data-runner-part=drawing]]:h-[max(calc(100%_-_var(--rt-draw-top)_-_var(--rt-reserve)),var(--rt-draw-min))] max-lg:[&_[data-runner-part=drawing]]:overflow-visible max-lg:[&_[data-runner-part=drawing]]:[clip-path:inset(0_-100vw_-100vh_-100vw)] max-lg:[&_[data-ground]]:hidden',
].join(' ')
/** The runner's own control row below `lg`, over the top of the stage (see `RUNNER_CLASS`). */
const RUNNER_CONTROL_ROW_CLASS = [
  'max-lg:[&_[data-runner-part=controls]]:sticky max-lg:[&_[data-runner-part=controls]]:top-[var(--rt-top)] max-lg:[&_[data-runner-part=controls]]:z-[3] max-lg:[&_[data-runner-part=controls]]:order-first max-lg:[&_[data-runner-part=controls]]:-mx-4 max-lg:[&_[data-runner-part=controls]]:-mb-[var(--rt-controls)] max-lg:[&_[data-runner-part=controls]]:h-[var(--rt-controls)] max-lg:[&_[data-runner-part=controls]]:justify-end max-lg:[&_[data-runner-part=controls]]:border-b-2 max-lg:[&_[data-runner-part=controls]]:border-black max-lg:[&_[data-runner-part=controls]]:bg-white max-lg:[&_[data-runner-part=controls]]:px-4 max-lg:[&_[data-runner-part=controls]]:py-1 sm:max-lg:[&_[data-runner-part=controls]]:-mx-6 sm:max-lg:[&_[data-runner-part=controls]]:px-6 max-lg:dark:[&_[data-runner-part=controls]]:border-white max-lg:dark:[&_[data-runner-part=controls]]:bg-black',
  // The control row's note, out of the row and onto the notes' surface below its left end.
  'max-lg:[&_[data-runner-part=controls]>p]:absolute max-lg:[&_[data-runner-part=controls]>p]:left-4 max-lg:[&_[data-runner-part=controls]>p]:top-full max-lg:[&_[data-runner-part=controls]>p]:mt-1 max-lg:[&_[data-runner-part=controls]>p]:bg-white/85 max-lg:[&_[data-runner-part=controls]>p]:px-2 max-lg:[&_[data-runner-part=controls]>p]:py-1 max-lg:[&_[data-runner-part=controls]>p]:backdrop-blur-[3px] max-lg:[&_[data-runner-part=controls]>p:empty]:hidden sm:max-lg:[&_[data-runner-part=controls]>p]:left-6 max-lg:dark:[&_[data-runner-part=controls]>p]:bg-black/85',
].join(' ')
/**
 * A short phone's controls: no row of their own, but laid over the start of the tour's row
 * (`TOUR_BAR_ROW_CLASS`, a cell of the same grid, so the two stick together): as wide as their
 * buttons, 0.25rem down to sit in the row's `py-1`, above it (`z-[6]` over its `z-[5]`), taking no
 * room in the flow. Pause shows its icon alone (its accessible name is its `aria-label`), and the
 * "Dashed: …" note hangs below the row.
 */
const RUNNER_CONTROLS_IN_ROW_CLASS = [
  'max-lg:[&_[data-runner-part=controls]]:sticky max-lg:[&_[data-runner-part=controls]]:top-[calc(var(--motion-story-header-height,88px)_+_0.25rem)] max-lg:[&_[data-runner-part=controls]]:z-[6] max-lg:[&_[data-runner-part=controls]]:order-first max-lg:[&_[data-runner-part=controls]]:mt-1 max-lg:[&_[data-runner-part=controls]]:-mb-12 max-lg:[&_[data-runner-part=controls]]:h-11 max-lg:[&_[data-runner-part=controls]]:w-fit max-lg:[&_[data-runner-part=controls]]:self-start max-lg:[&_[data-runner-part=controls]]:gap-2 max-lg:[&_[data-runner-part=controls]]:p-0',
  'max-lg:[&_[data-runner-part=controls]_button]:px-2 max-lg:[&_[data-runner-part=controls]_button[aria-label]]:text-[0px] max-lg:[&_[data-runner-part=controls]_button[aria-label]>span]:mr-0 max-lg:[&_[data-runner-part=controls]_button[aria-label]>span]:text-xs',
  'max-lg:[&_[data-runner-part=controls]>p]:absolute max-lg:[&_[data-runner-part=controls]>p]:left-0 max-lg:[&_[data-runner-part=controls]>p]:top-full max-lg:[&_[data-runner-part=controls]>p]:mt-2 max-lg:[&_[data-runner-part=controls]>p]:w-max max-lg:[&_[data-runner-part=controls]>p]:max-w-[14rem] max-lg:[&_[data-runner-part=controls]>p]:bg-white/85 max-lg:[&_[data-runner-part=controls]>p]:px-2 max-lg:[&_[data-runner-part=controls]>p]:py-1 max-lg:[&_[data-runner-part=controls]>p]:backdrop-blur-[3px] max-lg:[&_[data-runner-part=controls]>p:empty]:hidden max-lg:dark:[&_[data-runner-part=controls]>p]:bg-black/85',
].join(' ')
/**
 * The runner's notes (slow motion): under the figure at `lg`; below it, a stack stuck at the top
 * left of the runner's part of the screen, under the control row's "Dashed: …" note and under the
 * panels like the runner.
 */
const RUNNER_NOTES_CLASS =
  'runner-tour__notes lg:contents max-lg:pointer-events-none max-lg:sticky max-lg:top-[calc(var(--rt-top)_+_var(--rt-controls)_+_2.125rem)] max-lg:col-start-1 max-lg:row-start-1 max-lg:flex max-lg:flex-col max-lg:items-start max-lg:gap-1 max-lg:self-start'
/**
 * One note's chip below `lg`, on the stop panels' surface (`TOUR_PANEL_CLASS`): at least 85% opaque,
 * so its text keeps its contrast over any runner stroke (held to WCAG AA by
 * `tourPanelContrast.test.ts`, which reads every surface opacity from this file and `TourStop.tsx`).
 */
const RUNNER_NOTE_CLASS =
  'max-lg:w-fit max-lg:max-w-[14rem] max-lg:bg-white/85 max-lg:px-2 max-lg:py-1 max-lg:backdrop-blur-[3px] max-lg:dark:bg-black/85'

/** The runner's drawing inside the rail, which the intro waits to see. */
const RUNNER_FIGURE_SELECTOR = 'figure svg'

/** Every area's metrics in tour order: the intro applies the figure's parameters in this order. */
const INTRO_ORDER: readonly MetricId[] = FOCUS_AREA_ORDER.flatMap((area) => FOCUS_AREAS[area].metricIds)

const SKIP_CLASS =
  'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-lg:px-2 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black'
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
  const barRef = useRef<HTMLDivElement>(null)
  useBarHeightProperty(barRef, rootRef)
  const plan = useMemo(
    () => (heuristics ? tourPlan(heuristics, scalePassStatus, coverage) : null),
    [heuristics, scalePassStatus, coverage],
  )
  const stopIds: TourStopId[] =
    plan === null ? [] : [...plan.areaStops.map((stop) => stop.view.area), 'oneThing']
  const active = useActiveStop(rootRef, stopIds)
  const shortPhone = useShortPhoneLayout()
  const hasBody = heuristics !== null && plan !== null
  // On a short phone the dots and Skip share the runner's control row, in the body (only once
  // there is one: until then they stay here).
  const actionsInBody = shortPhone && hasBody
  const actions = (
    <TourBarActions stopIds={stopIds} active={active} onLeaveTour={onLeaveTour} compact={actionsInBody} />
  )
  return (
    <div ref={rootRef} className="runner-tour">
      <div ref={barRef} className={actionsInBody ? TOUR_HEADING_ONLY_CLASS : TOUR_BAR_CLASS}>
        {/* The tour's focus target after a switch (`data-view-entry`): a heading rather than Skip, so
            a reader arriving here hears where they are rather than an action they did not ask for. */}
        <h2
          tabIndex={-1}
          data-view-entry
          className="font-display text-xl font-bold tracking-tight focus:outline-none max-lg:sr-only"
        >
          Your runner model
        </h2>
        {!actionsInBody && actions}
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
            barRow={actionsInBody ? actions : null}
          />
        ) : null}
      </GuidedResultsView>
    </div>
  )
}

/**
 * Publishes the tour bar's height on the tour's root as `--runner-tour-bar-height`, which the phone
 * layout sticks the runner and offsets the stops by: below `lg` the bar wraps, and how far depends
 * on the width and the text size, so it is measured rather than assumed.
 */
function useBarHeightProperty(
  barRef: RefObject<HTMLElement | null>,
  rootRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const bar = barRef.current
    const root = rootRef.current
    if (!bar || !root) return
    const set = (height: number) => root.style.setProperty('--runner-tour-bar-height', `${Math.ceil(height)}px`)
    set(bar.getBoundingClientRect().height)
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => set(bar.getBoundingClientRect().height)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const observer = new ResizeObserver((entries) => {
      const height = borderBoxHeight(entries[entries.length - 1])
      if (height !== null) set(height)
    })
    observer.observe(bar)
    return () => observer.disconnect()
  }, [barRef, rootRef])
}

/** A ResizeObserver entry's border-box height, the size the sticky offsets have to clear. */
function borderBoxHeight(entry: ResizeObserverEntry | undefined): number | null {
  if (!entry) return null
  const box = entry.borderBoxSize?.[0]
  return box ? box.blockSize : entry.target.getBoundingClientRect().height
}

/**
 * Publishes the active stop's panel height (plus its slot's bottom padding) on the tour body as
 * `--rt-reserve`: below `lg` the runner's drawing is framed above it, so the focus body part is
 * never under the panel the reader is on. Before any stop is active (the intro, at the top of the
 * tour), the first stop's panel. At `lg` the panel has no box (`contents`), so this measures 0 and
 * leaves the fallback, which nothing at `lg` reads.
 */
function usePanelReserveProperty(
  rootRef: RefObject<HTMLElement | null>,
  stopId: TourStopId | null,
): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root || stopId === null) return
    const panel = root.querySelector<HTMLElement>(`[data-tour-stop="${stopId}"] .runner-tour__panel`)
    if (!panel) return
    const slot = panel.parentElement
    const set = (height: number) => {
      if (height <= 0) return
      const padding = slot ? parseFloat(getComputedStyle(slot).paddingBottom) || 0 : 0
      root.style.setProperty('--rt-reserve', `${Math.ceil(height + padding)}px`)
    }
    set(panel.getBoundingClientRect().height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const height = borderBoxHeight(entries[entries.length - 1])
      if (height !== null) set(height)
    })
    observer.observe(panel)
    return () => observer.disconnect()
  }, [rootRef, stopId])
}

/**
 * Publishes the runner's control row's width on `rootRef`'s element as `--rt-controls-width`: on a
 * short phone the controls sit over the start of the tour's row, which starts its own content after
 * them. Measured, as the row holds Skip intro only while the intro runs.
 */
function useControlsWidthProperty(
  railRef: RefObject<HTMLElement | null>,
  rootRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const root = rootRef.current
    const controls = railRef.current?.querySelector<HTMLElement>('[data-runner-part="controls"]')
    if (!root || !controls) return
    const set = (width: number) => root.style.setProperty('--rt-controls-width', `${Math.ceil(width)}px`)
    set(controls.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) set(entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width)
    })
    observer.observe(controls)
    return () => observer.disconnect()
  }, [railRef, rootRef])
}

/**
 * Publishes a short phone's shared row's height on `rootRef`'s element as `--rt-controls`, the room
 * the drawing starts below (it grows when the dots wrap). Removed with the row, so the class's
 * value for the runner's own control row applies again.
 */
function useRowHeightProperty(
  rowRef: RefObject<HTMLElement | null>,
  rootRef: RefObject<HTMLElement | null>,
  hasRow: boolean,
): void {
  useEffect(() => {
    const row = rowRef.current
    const root = rootRef.current
    if (!hasRow || !row || !root) return
    const set = (height: number) => root.style.setProperty('--rt-controls', `${Math.ceil(height)}px`)
    set(row.getBoundingClientRect().height)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const height = borderBoxHeight(entries[entries.length - 1])
            if (height !== null) set(height)
          })
    observer?.observe(row)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--rt-controls')
    }
  }, [rowRef, rootRef, hasRow])
}

interface TourBarActionsProps {
  stopIds: readonly TourStopId[]
  active: TourStopId | null
  onLeaveTour: () => void
  /** The short phone's shared row: the dots wrap, and Skip reads "Summary" (its accessible name
   * stays "Skip to summary"). */
  compact: boolean
}

/** The tour's dots and Skip, in the tour's bar or (on a short phone) in the row it shares with the
 * runner's controls. */
function TourBarActions({ stopIds, active, onLeaveTour, compact }: TourBarActionsProps) {
  return (
    <div className={compact ? TOUR_BAR_ROW_ACTIONS_CLASS : TOUR_BAR_ACTIONS_CLASS}>
      {stopIds.length > 0 && <TourProgress stopIds={stopIds} active={active} compact={compact} />}
      <button type="button" onClick={onLeaveTour} className={SKIP_CLASS}>
        {compact ? (
          <>
            <span className="sr-only">Skip to</span> summary
          </>
        ) : (
          'Skip to summary'
        )}
      </button>
    </div>
  )
}

/**
 * Where the reader is: one dot per stop, each a link to its `#tour-<stop>` fragment, the active one
 * filled and `aria-current`. Each tells assistive technology "Stop N of M" and the stop's name.
 * Compact (a short phone's shared row), the dots take the room beside Skip and wrap onto 24 px lines.
 */
function TourProgress({
  stopIds,
  active,
  compact = false,
}: {
  stopIds: readonly TourStopId[]
  active: TourStopId | null
  compact?: boolean
}) {
  return (
    <nav
      aria-label="Tour stops"
      className={compact ? 'runner-tour__progress min-w-[4.5rem] flex-1 self-center' : 'runner-tour__progress'}
    >
      <ol className={compact ? 'flex flex-wrap items-center' : 'flex items-center'}>
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
  /** On a short phone, the tour's dots and Skip, for the row they share with the runner's
   * controls at the top of the body; otherwise null (they are in the tour's bar). */
  barRow: ReactNode
}

/**
 * The rail and the stops. The rail holds ONE mounted `ModelRunner` for the life of the tour, never
 * keyed by stop: a stop changes only its camera, focus and rate, so the figure tweens rather than
 * remounting, and the reader's Pause survives every stop.
 *
 * The intro plays first, from `introPreset`, which is the runner's camera for as long as the intro
 * runs (no stop is shown then), so the two agree on which lateral parameters get a step. It starts
 * only once the runner's figure (its drawing) is at least 90% on screen as well as seen by the
 * runner, so it never plays out below the fold. Reading on past the first stop ends it.
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
  barRow,
}: TourBodyProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  useRevealFragment(rootRef)
  usePanelReserveProperty(rootRef, active ?? stopIds[0] ?? null)
  useControlsWidthProperty(railRef, rootRef)
  useRowHeightProperty(rowRef, rootRef, barRow !== null)
  const reducedMotion = usePrefersReducedMotion()
  const activeIndex = active === null ? -1 : stopIds.indexOf(active)

  const params = useMemo(() => bindRunnerParams(heuristics), [heuristics])
  const [runnerSeen, setRunnerSeen] = useState(false)
  // The figure, not the whole rail: its caption, Pause row and legend may sit below the fold.
  const figureVisible = useMostlyVisible(railRef, RUNNER_FIGURE_SELECTOR)
  const intro = useRunnerIntro({
    bound: params,
    resultKey,
    order: INTRO_ORDER,
    camera: introPreset,
    active: runnerSeen && figureVisible,
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
      {barRow !== null && (
        <div ref={rowRef} className={TOUR_BAR_ROW_CLASS}>
          {barRow}
        </div>
      )}
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
          className={`${RUNNER_CLASS} ${barRow !== null ? RUNNER_CONTROLS_IN_ROW_CLASS : RUNNER_CONTROL_ROW_CLASS}`}
        />
        <div className={RUNNER_NOTES_CLASS}>
          {playbackRate < 1 && !reducedMotion && (
            <p
              className={`runner-tour__slow-motion font-sans text-xs font-semibold uppercase tracking-wide text-neutral-700 lg:mt-2 dark:text-neutral-300 ${RUNNER_NOTE_CLASS}`}
            >
              Slow motion
            </p>
          )}
          {showLegend && <BandLegend className="runner-tour__legend mt-2 max-lg:hidden" />}
        </div>
      </div>
      <div className="runner-tour__stops min-w-0 max-lg:relative max-lg:z-[1] max-lg:col-start-1 max-lg:row-start-1">
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
