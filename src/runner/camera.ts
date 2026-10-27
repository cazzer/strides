/**
 * Orthographic camera for the model runner.
 *
 * Yaw ψ turns the camera about the vertical axis: at yaw 0 it sits on the runner's right side and
 * the runner travels screen-right; at yaw 90 it sits in front, so the runner's left appears on
 * screen right. Pitch tilts it above the runner, looking down. Projection is orthographic, so zoom
 * is a pure scale and `depth` is only for draw order.
 *
 * Screen space is SVG-oriented (x right, y down) in torso lengths × zoom, with the camera target at
 * the origin. A renderer maps ±`CAMERA_FRAME_HALF_HEIGHT` to the viewport's half-height.
 */
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { GAIT_PHASES, GROUND_Y, MODEL_PROPORTIONS, PELVIS_HEIGHT, poseAt } from './gaitModel'
import { NEUTRAL_RUNNER_PARAMS } from './runnerParams'
import type {
  CameraPreset,
  CameraState,
  Joint3D,
  ProjectedJoint,
  RunnerParams,
  Vec3,
} from './types'

/** Projected half-height every preset is framed for. */
export const CAMERA_FRAME_HALF_HEIGHT = 2
/**
 * Projected half-width of the renderer's viewBox. The drawing is fitted with `meet`, so this much
 * is always visible; a stage wider than the viewBox's 3:4 shows more at the sides.
 */
export const CAMERA_FRAME_HALF_WIDTH = 1.5

const SHOULDER_HEIGHT = PELVIS_HEIGHT + 1
const HEAD_TOP = SHOULDER_HEIGHT + MODEL_PROPORTIONS.ear.up

function preset(yawDeg: number, pitchDeg: number, zoom: number, target: Vec3): CameraState {
  return Object.freeze({ yawDeg, pitchDeg, zoom, target: Object.freeze({ ...target }) })
}

/** A wall-clock pause, each time playback inside a window reaches `phase`. */
export interface PhaseHold {
  phase: number
  ms: number
}

/** A span of the gait cycle the loop plays round and round: `start` .. `start + length`, wrapping. */
export interface PhaseWindow {
  start: number
  length: number
  /** Pauses inside the window, each taken once per pass. Absent: none. A hold must sit after the
   * window's start (offset > 0): one placed exactly at the start never fires. */
  holds?: readonly PhaseHold[]
}

/** How long each landing loop rests on the contact frame, wall-clock ms. */
export const LANDING_CONTACT_HOLD_MS = 300
/**
 * How long each landing loop rests on its last frame before starting again, wall-clock ms. The
 * restart from early stance back to late swing cannot be made small by moving the window (see
 * design.md D16): resting first makes it read as a replay, not a twitch.
 */
export const LANDING_END_HOLD_MS = 150

const LANDING_WINDOW_START = 0.35
const LANDING_WINDOW_LENGTH = 0.25

/**
 * The landing camera's window: from 0.15 before the near (right) leg's contact (cycle phase 0.5)
 * to 0.10 after it. Late swing into early stance, so the reader sees the foot come down. A large
 * overstride's stance foot gives way below the ground (gaitModel D15); with the 0.30 stance that
 * starts sooner after contact, so at the demo clip's 0.512 the end frame (0.10 after contact)
 * already sinks −0.045 torso lengths (−0.049 by 0.15 after). The window is kept for its framing;
 * the end hold shows that sink briefly. Each pass rests on the contact frame, and briefly on its
 * last frame.
 */
export const LANDING_PHASE_WINDOW: PhaseWindow = Object.freeze({
  start: LANDING_WINDOW_START,
  length: LANDING_WINDOW_LENGTH,
  holds: Object.freeze([
    Object.freeze({ phase: GAIT_PHASES.rightContact, ms: LANDING_CONTACT_HOLD_MS }),
    Object.freeze({ phase: LANDING_WINDOW_START + LANDING_WINDOW_LENGTH, ms: LANDING_END_HOLD_MS }),
  ]),
})

/**
 * The landing frame's top, above hip-mid's highest point in the window, torso lengths. Enough that
 * the phone tour's "Slow motion" note at the drawing's top-left clears the hip and thighs.
 */
export const LANDING_FRAME_ABOVE_HIP = 0.25
/** The landing frame's bottom, below the ground: room for the ground-lane labels. */
export const LANDING_FRAME_BELOW_GROUND = 0.4
/** Horizontal room kept beyond the framed joints, torso lengths. */
const LANDING_FRAME_SIDE_PAD = 0.05
const LANDING_SAMPLES = 30
const LANDING_JOINTS: readonly KeypointName[] = [
  'left_hip',
  'right_hip',
  'right_knee',
  'right_ankle',
  'right_heel',
  'right_foot_index',
]

function jointAt(pose: readonly Joint3D[], name: KeypointName): Joint3D {
  return pose[COMMON_KEYPOINT_NAMES.indexOf(name)]
}

/**
 * The landing camera for one parameter set: from the side, the near (right) leg's landing. The
 * model is a treadmill (hip-mid stays at x = 0), so the contact point is world-fixed for a
 * parameter set and the camera needs no per-frame tracking.
 *
 * Height: the span from just above hip-mid's highest point over the window (a big bounce lifts it
 * above its contact height) to `LANDING_FRAME_BELOW_GROUND` under the ground (the ground-lane
 * labels' room) fills the frame. Width: centred on the horizontal reach of
 * hip-mid and the near leg over `LANDING_PHASE_WINDOW`, zoomed out further only if that reach
 * would not fit; the late-swing toe reaches well past the contact ankle, so centring on hip-mid
 * and the ankle alone would cut it off at phone width.
 */
export function landingCamera(values: RunnerParams): CameraState {
  let hipTop = -Infinity
  let left = Infinity
  let right = -Infinity
  for (let i = 0; i <= LANDING_SAMPLES; i += 1) {
    const pose = poseAt(
      LANDING_PHASE_WINDOW.start + (LANDING_PHASE_WINDOW.length * i) / LANDING_SAMPLES,
      values,
    )
    hipTop = Math.max(hipTop, (jointAt(pose, 'left_hip').y + jointAt(pose, 'right_hip').y) / 2)
    for (const name of LANDING_JOINTS) {
      left = Math.min(left, jointAt(pose, name).x)
      right = Math.max(right, jointAt(pose, name).x)
    }
  }
  const top = hipTop + LANDING_FRAME_ABOVE_HIP
  const bottom = GROUND_Y - LANDING_FRAME_BELOW_GROUND
  const halfReach = (right - left) / 2 + LANDING_FRAME_SIDE_PAD
  const zoom = Math.min(
    (2 * CAMERA_FRAME_HALF_HEIGHT) / (top - bottom),
    CAMERA_FRAME_HALF_WIDTH / halfReach,
  )
  return preset(0, 0, zoom, { x: (left + right) / 2, y: (top + bottom) / 2, z: 0 })
}

export const CAMERA_PRESETS: Readonly<Record<CameraPreset, CameraState>> = Object.freeze({
  wholeBodySide: preset(0, 0, 1, { x: 0, y: HEAD_TOP / 2, z: 0 }),
  upperFrontQuarter: preset(45, 5, 1.7, { x: 0, y: PELVIS_HEIGHT + 0.6, z: 0 }),
  torsoSide: preset(0, 0, 1.8, { x: 0, y: PELVIS_HEIGHT + 0.5, z: 0 }),
  legsSide: preset(0, 0, 1.4, { x: 0, y: PELVIS_HEIGHT / 2, z: 0 }),
  /**
   * Unused by the app since `landingSide` (ps19.5): a world-fixed point at 3× shows the foot only
   * around contact. Kept for the sandbox's camera buttons.
   */
  footSide: preset(0, 0, 3, { x: 0.25, y: 0.25, z: 0 }),
  feetFront: preset(90, 0, 2.4, { x: 0, y: 0.35, z: 0 }),
  /**
   * The neutral figure's landing frame. ModelRunner reframes it on the values it draws
   * (`landingCamera(values)`); a bare `resolveCamera('landingSide')` gets this one.
   */
  landingSide: landingCamera(NEUTRAL_RUNNER_PARAMS),
})

export function resolveCamera(camera: CameraPreset | CameraState): CameraState {
  return typeof camera === 'string' ? CAMERA_PRESETS[camera] : camera
}

const DEG = Math.PI / 180

interface CameraBasis {
  right: Vec3
  up: Vec3
  toward: Vec3
}

function basis({ yawDeg, pitchDeg }: CameraState): CameraBasis {
  const yaw = yawDeg * DEG
  const pitch = pitchDeg * DEG
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
  const level = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }
  return {
    right,
    toward: {
      x: level.x * Math.cos(pitch),
      y: Math.sin(pitch),
      z: level.z * Math.cos(pitch),
    },
    up: {
      x: -level.x * Math.sin(pitch),
      y: Math.cos(pitch),
      z: -level.z * Math.sin(pitch),
    },
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function project(point: Vec3, camera: CameraState, axes: CameraBasis): Omit<ProjectedJoint, 'name'> {
  const d = {
    x: point.x - camera.target.x,
    y: point.y - camera.target.y,
    z: point.z - camera.target.z,
  }
  return {
    x: camera.zoom * dot(d, axes.right),
    y: -camera.zoom * dot(d, axes.up),
    depth: dot(d, axes.toward),
  }
}

/** One world point in screen space (no `name`). */
export function projectPoint(
  point: Vec3,
  camera: CameraPreset | CameraState,
): Omit<ProjectedJoint, 'name'> {
  const state = resolveCamera(camera)
  return project(point, state, basis(state))
}

export function projectPose(
  joints: readonly Joint3D[],
  camera: CameraPreset | CameraState,
): ProjectedJoint[] {
  const state = resolveCamera(camera)
  const axes = basis(state)
  return joints.map((j) => ({ name: j.name, ...project(j, state, axes) }))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Camera between `a` (t = 0) and `b` (t = 1), t clamped to [0, 1]. Yaw takes the shorter way
 * round and is returned in [0, 360), pitch and target interpolate linearly, and zoom
 * geometrically so a zoom-in feels even.
 */
export function interpolateCamera(
  a: CameraPreset | CameraState,
  b: CameraPreset | CameraState,
  t: number,
): CameraState {
  const from = resolveCamera(a)
  const to = resolveCamera(b)
  const u = Math.min(1, Math.max(0, t))
  const yawDelta = ((((to.yawDeg - from.yawDeg) % 360) + 540) % 360) - 180
  return {
    yawDeg: ((((from.yawDeg + yawDelta * u) % 360) + 360) % 360),
    pitchDeg: lerp(from.pitchDeg, to.pitchDeg, u),
    zoom: from.zoom * (to.zoom / from.zoom) ** u,
    target: {
      x: lerp(from.target.x, to.target.x, u),
      y: lerp(from.target.y, to.target.y, u),
      z: lerp(from.target.z, to.target.z, u),
    },
  }
}
