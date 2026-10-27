import type { MetricId } from '../heuristics/types'
import type { KeypointName } from '../pose/types'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * One model-runner joint. World frame: x = direction of travel, y = up (ground at y = 0), z = the
 * runner's RIGHT (right-handed). Units are torso lengths (shoulder-mid to hip-mid = 1).
 */
export interface Joint3D extends Vec3 {
  name: KeypointName
}

/**
 * The model runner's degrees of freedom. Each is stored in the unit of the metric that binds it,
 * so that applying that metric's own formula to the model's joints returns the stored value.
 */
export type RunnerParamId =
  /** Steps per minute. Sets the cycle rate only; no geometry. */
  | 'cadence'
  /** Hip-mid vertical peak-to-peak travel, torso lengths. */
  | 'pelvisBounce'
  /** Degrees, positive = shoulders forward of the hips in the direction of travel. */
  | 'torsoPitch'
  /** Peak-to-peak of (wrist.y − shoulder.y), torso lengths. */
  | 'armSwing'
  /** Degrees of hip→knee forward of the down-vertical, at the swing peak. */
  | 'peakThighAngle'
  /** Degrees of knee flexion (180 − hip-knee-ankle interior angle), at the swing peak. */
  | 'peakSwingKneeBend'
  /** Ankle ahead of hip-mid at contact, torso lengths. */
  | 'landingOffset'
  /** Ankle ahead of the same-side knee at contact, torso lengths. */
  | 'contactShankOffset'
  /** Ankle lateral offset from the midline at contact, in hip widths; positive = own side. */
  | 'stepWidth'
  /** Lateral (ankle − same-side knee) P80−P20 range over early-to-mid swing, in hip widths. */
  | 'swingFootArc'

export type RunnerParams = Readonly<Record<RunnerParamId, number>>

/**
 * The metrics that can bind a runner parameter: eleven of the thirteen. `verticalRatio` and
 * `stepWidthCm` never bind (the former has no degree of freedom of its own; the latter would be a
 * second metric driving `stepWidth`).
 */
export type RunnerMetricId =
  | 'cadence'
  | 'verticalOscillation'
  | 'verticalOscillationCm'
  | 'trunkLean'
  | 'armSwingAmplitude'
  | 'kneeDrive'
  | 'kneeFlexion'
  | 'overstriding'
  | 'footStrikePattern'
  | 'stepWidth'
  | 'swingFootLateralExcursion'

/**
 * A parameter after binding. `value` is what the model draws, in the parameter's unit.
 * `metricValue` is the metric's own reported number (the one to label), and `clamped` says the
 * drawing hit a geometry limit, so `value` differs from `metricValue × scale`.
 */
export type BoundRunnerParam =
  | {
      source: 'measured'
      value: number
      metricId: RunnerMetricId
      metricValue: number
      clamped: boolean
    }
  | { source: 'neutral'; value: number }

export type BoundRunnerParams = Readonly<Record<RunnerParamId, BoundRunnerParam>>

export type CameraPreset =
  | 'wholeBodySide'
  | 'upperFrontQuarter'
  | 'torsoSide'
  | 'legsSide'
  | 'footSide'
  | 'feetFront'

/** Orthographic camera. Yaw 0 = viewed from the runner's right side; yaw 90 = from the front. */
export interface CameraState {
  yawDeg: number
  /** Positive = camera above, looking down. */
  pitchDeg: number
  /** Projected units per torso length. */
  zoom: number
  /** World point that projects to the origin. */
  target: Vec3
}

/**
 * A joint in screen space, SVG orientation: x right, y DOWN, in torso lengths × zoom with the
 * camera target at the origin. Larger `depth` = nearer the camera.
 */
export interface ProjectedJoint {
  name: KeypointName
  x: number
  y: number
  depth: number
}

export type SkeletonEdge = readonly [KeypointName, KeypointName]

export type { MetricId }
