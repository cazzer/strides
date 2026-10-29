import type { MetricId } from '../heuristics/types'
import type { FocusAreaId } from '../guidance/focusAreas'
import type { RunnerFocus } from '../runner/ModelRunner'
import { KEY_LEG_PHASE } from '../runner/runnerAnnotations'
import { paramForMetric } from '../runner/runnerParams'
import type { BoundRunnerParams, CameraPreset } from '../runner/types'

export interface RunnerView {
  camera: CameraPreset
  playbackRate: number
}

/** The rate every slowed area plays at. */
export const SLOW_MOTION_RATE = 0.4

/**
 * Where the model runner looks for each focus area, and how fast it plays there. Shared by the
 * results summary (a row opening points the camera) and the tour (each stop's framing).
 *
 * The leg areas play slowed: a contact or a swing-foot arc lasts a fraction of a second at full
 * speed, too brief to read at the zoom these presets frame them at, and so does the swing knee's
 * fold to its peak bend (knees, headed by knee flexion). A view that slows the figure says so on
 * screen.
 *
 * Landing uses the runner's contact-tracking camera: `landingSide` frames hip-mid and the near
 * ankle at contact on the reader's own values, and plays only a window around that contact, so the
 * foot is always landing and the overstride and foot-strike marks always meet it.
 */
export const FOCUS_AREA_CAMERA: Readonly<Record<FocusAreaId, RunnerView>> = {
  rhythm: { camera: 'wholeBodySide', playbackRate: 1 },
  arms: { camera: 'armsQuarter', playbackRate: 1 },
  posture: { camera: 'torsoSide', playbackRate: 1 },
  knees: { camera: 'legsSide', playbackRate: SLOW_MOTION_RATE },
  landing: { camera: 'landingSide', playbackRate: SLOW_MOTION_RATE },
  footPath: { camera: 'feetFront', playbackRate: SLOW_MOTION_RATE },
}

/** The camera with no focus area: the whole figure from the side, at full speed. */
export const NO_FOCUS_CAMERA: RunnerView = {
  camera: 'wholeBodySide',
  playbackRate: 1,
}

/**
 * Whether a focus draws vertical ratio as its two inputs: vertical ratio is in it and its stride is
 * measured (`strideLength` binds only where the bounce reading derives the stride).
 */
export function focusDrawsStride(focus: RunnerFocus | undefined, params: BoundRunnerParams): boolean {
  return (
    focus !== undefined &&
    focus.metricIds.includes('verticalRatio') &&
    params.strideLength.source === 'measured'
  )
}

/**
 * The runner's view for an area (null: none, the whole figure) with the focus it shows: the area's
 * own, except that a focus drawing vertical ratio's stride takes the stride camera, which frames the
 * whole figure and one stride along the ground at one scale (a stride is several figures long, so
 * any other framing would cut it off). The rate stays the area's.
 */
export function runnerViewFor(
  area: FocusAreaId | null,
  focus: RunnerFocus | undefined,
  params: BoundRunnerParams,
): RunnerView {
  const view = area === null ? NO_FOCUS_CAMERA : FOCUS_AREA_CAMERA[area]
  return focusDrawsStride(focus, params) ? { ...view, camera: 'strideSide' } : view
}

/**
 * The runner focus for a set of metrics (an area's measured ones, headline first): every metric
 * that drives a parameter, keeping limb parameters only where they share the FIRST limb
 * parameter's key phase.
 *
 * A still figure (paused, reduced motion) holds the first annotated limb parameter's key phase and
 * shows a limb mark only at its own key phase, so a second limb parameter keyed elsewhere — knee
 * drive beside knee flexion, swing-foot arc beside step width — would be accented on the figure yet
 * carry no mark. One still beat, one key phase. Parameters read at any phase (torso, bounce, arms,
 * vertical ratio's stride) always stay.
 */
export function runnerFocusFor(metricIds: readonly MetricId[]): RunnerFocus {
  let keyPhase: number | null = null
  const kept = metricIds.filter((metric) => {
    const param = paramForMetric(metric)
    if (param === null) return false
    const phase = KEY_LEG_PHASE[param]
    if (phase === null) return true
    if (keyPhase === null) keyPhase = phase
    return phase === keyPhase
  })
  return { metricIds: kept }
}
