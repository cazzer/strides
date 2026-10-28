import type { MetricId } from '../heuristics/types'
import type { FocusAreaId } from '../guidance/focusAreas'
import type { RunnerFocus } from '../runner/ModelRunner'
import { KEY_LEG_PHASE } from '../runner/runnerAnnotations'
import { paramForMetric } from '../runner/runnerParams'
import type { CameraPreset } from '../runner/types'

/**
 * Where the model runner looks for each focus area, and how fast it plays there. Shared by the
 * results summary (a row opening points the camera) and the tour (each stop's framing).
 *
 * The foot areas play slowed: a contact or a swing-foot arc lasts a fraction of a second at full
 * speed, too brief to read at the zoom these presets frame them at. A view that slows the figure
 * says so on screen.
 *
 * Landing uses the runner's contact-tracking camera: `landingSide` frames hip-mid and the near
 * ankle at contact on the reader's own values, and plays only a window around that contact, so the
 * foot is always landing and the overstride and foot-strike marks always meet it.
 */
export const FOCUS_AREA_CAMERA: Readonly<
  Record<FocusAreaId, { camera: CameraPreset; playbackRate: number }>
> = {
  rhythm: { camera: 'wholeBodySide', playbackRate: 1 },
  arms: { camera: 'armsQuarter', playbackRate: 1 },
  posture: { camera: 'torsoSide', playbackRate: 1 },
  knees: { camera: 'legsSide', playbackRate: 1 },
  landing: { camera: 'landingSide', playbackRate: 0.4 },
  footPath: { camera: 'feetFront', playbackRate: 0.4 },
}

/** The camera with no focus area: the whole figure from the side, at full speed. */
export const NO_FOCUS_CAMERA: { camera: CameraPreset; playbackRate: number } = {
  camera: 'wholeBodySide',
  playbackRate: 1,
}

/**
 * The runner focus for a set of metrics (an area's measured ones, headline first): every metric
 * that drives a parameter, keeping limb parameters only where they share the FIRST limb
 * parameter's key phase.
 *
 * A still figure (paused, reduced motion) holds the first annotated limb parameter's key phase and
 * shows a limb mark only at its own key phase, so a second limb parameter keyed elsewhere — knee
 * drive beside knee flexion, swing-foot arc beside step width — would be accented on the figure yet
 * carry no mark. One still beat, one key phase. Parameters read at any phase (torso, bounce, arms)
 * always stay.
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
