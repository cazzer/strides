import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { feedbackFor, selectOneThing } from '../../guidance/feedbackPoints'
import type { AreaFeedback, OneThing } from '../../guidance/feedbackPoints'
import { FOCUS_AREAS } from '../../guidance/focusAreas'
import type { FocusAreaId, TourStopId } from '../../guidance/focusAreas'
import type { CameraPreset } from '../../runner/types'
import { FOCUS_AREA_CAMERA, NO_FOCUS_CAMERA } from '../focusAreaCamera'
import type { CommittedView, SessionCoverage } from '../sessionCoverage'
import { summaryRows } from '../summary/summaryRows'
import type { SummaryArea } from '../summary/summaryRows'
import type { ScalePassStatus } from '../types'

export interface TourAreaStop extends SummaryArea {
  feedback: AreaFeedback
}

export interface TourPlan {
  /** One per MEASURED focus area, in tour order. At most six, so the tour has at most seven stops. */
  areaStops: TourAreaStop[]
  /** The closing stop's answer, always last. */
  oneThing: OneThing
  /** The areas with nothing measured, in tour order: skipped, and listed at the end. */
  unmeasured: FocusAreaId[]
  /** One way to measure what is missing, or `null` when nothing is. */
  captureHint: CaptureHint | null
}

/**
 * The end of the tour's one capture hint. `addsClip`: the hint is "add a clip from this view", so
 * the view offers it as the add-a-clip control itself; otherwise it is advice, shown as text.
 */
export interface CaptureHint {
  text: string
  addsClip: boolean
}

const VIEW_CLIP_HINT: Readonly<Record<CommittedView, string>> = {
  side: 'Add a side-view clip',
  front: 'Add a front-view clip',
}
export const BOTH_VIEWS_HINT = 'Add a side-view and a front-view clip'
/** For an area missing for some reason other than the camera angle (too little usable running). */
export const STEADY_RUNNING_HINT = 'Film several seconds of steady running, whole body in frame.'

/**
 * The one capture hint the end of the tour gives: a missing camera view when that is what cost an
 * unmeasured area its metrics (the same verdict `SessionCoverageNotice` reads), else steadier
 * footage. `null` when every area was measured.
 */
export function tourCaptureHint(
  unmeasured: readonly FocusAreaId[],
  coverage: SessionCoverage | null,
): CaptureHint | null {
  if (unmeasured.length === 0) return null
  const missing = new Set<MetricId>(unmeasured.flatMap((area) => FOCUS_AREAS[area].metricIds))
  const views = (coverage?.needs ?? [])
    .filter((need) => need.metrics.some((metric) => missing.has(metric)))
    .map((need) => need.view)
  if (views.length >= 2) return { text: BOTH_VIEWS_HINT, addsClip: true }
  if (views.length === 1) return { text: VIEW_CLIP_HINT[views[0]], addsClip: true }
  return { text: STEADY_RUNNING_HINT, addsClip: false }
}

/**
 * The intro's camera. A front-only session's measurements include the lateral ones (step width,
 * the swing foot's arc), which only get a step from a view that sees sideways movement, so it
 * introduces the feet from the front; every other session sees the whole figure from the side.
 */
export function introCamera(coverage: SessionCoverage | null): CameraPreset {
  return coverage !== null && coverage.present.front && !coverage.present.side
    ? 'feetFront'
    : NO_FOCUS_CAMERA.camera
}

/**
 * What the runner tour walks through, PURE so the stops are testable without rendering: one stop
 * per measured focus area in focus-area order (the summary's own rows, with their feedback), then
 * the one-thing stop.
 */
export function tourPlan(
  heuristics: FormHeuristicsResult,
  scalePassStatus: ScalePassStatus,
  coverage: SessionCoverage | null,
): TourPlan {
  const { areas, views } = summaryRows(heuristics)
  const unmeasured = views.filter((view) => !view.measured).map((view) => view.area)
  return {
    areaStops: areas.map((area) => ({ ...area, feedback: feedbackFor(area.view) })),
    oneThing: selectOneThing(views, scalePassStatus),
    unmeasured,
    captureHint: tourCaptureHint(unmeasured, coverage),
  }
}

/** Where the runner looks, and how fast it plays, at each stop. The one-thing stop sees it whole. */
export function stopCamera(id: TourStopId): { camera: CameraPreset; playbackRate: number } {
  return id === 'oneThing' ? NO_FOCUS_CAMERA : FOCUS_AREA_CAMERA[id]
}

/** A stop's element id, and the fragment that selects it (`#tour-knees`). */
export function tourStopDomId(id: TourStopId): string {
  return `tour-${id}`
}
