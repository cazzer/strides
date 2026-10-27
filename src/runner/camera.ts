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
import { MODEL_PROPORTIONS, PELVIS_HEIGHT } from './gaitModel'
import type { CameraPreset, CameraState, Joint3D, ProjectedJoint, Vec3 } from './types'

/** Projected half-height every preset is framed for. */
export const CAMERA_FRAME_HALF_HEIGHT = 2

const SHOULDER_HEIGHT = PELVIS_HEIGHT + 1
const HEAD_TOP = SHOULDER_HEIGHT + MODEL_PROPORTIONS.ear.up

export const CAMERA_PRESETS: Readonly<Record<CameraPreset, CameraState>> = {
  wholeBodySide: { yawDeg: 0, pitchDeg: 0, zoom: 1, target: { x: 0, y: HEAD_TOP / 2, z: 0 } },
  upperFrontQuarter: {
    yawDeg: 45,
    pitchDeg: 5,
    zoom: 1.7,
    target: { x: 0, y: PELVIS_HEIGHT + 0.6, z: 0 },
  },
  torsoSide: { yawDeg: 0, pitchDeg: 0, zoom: 1.8, target: { x: 0, y: PELVIS_HEIGHT + 0.5, z: 0 } },
  legsSide: { yawDeg: 0, pitchDeg: 0, zoom: 1.4, target: { x: 0, y: PELVIS_HEIGHT / 2, z: 0 } },
  footSide: { yawDeg: 0, pitchDeg: 0, zoom: 3, target: { x: 0.25, y: 0.25, z: 0 } },
  feetFront: { yawDeg: 90, pitchDeg: 0, zoom: 2.4, target: { x: 0, y: 0.35, z: 0 } },
}

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
 * round, pitch and target interpolate linearly, and zoom geometrically so a zoom-in feels even.
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
    yawDeg: from.yawDeg + yawDelta * u,
    pitchDeg: lerp(from.pitchDeg, to.pitchDeg, u),
    zoom: from.zoom * (to.zoom / from.zoom) ** u,
    target: {
      x: lerp(from.target.x, to.target.x, u),
      y: lerp(from.target.y, to.target.y, u),
      z: lerp(from.target.z, to.target.z, u),
    },
  }
}
