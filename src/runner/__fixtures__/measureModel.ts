/*
 * Test-only: "measuring the model returns the bound value". Each helper below is the named metric's
 * own formula (src/heuristics/<metric>.ts), applied to the model's joints in the projection that
 * metric is measured from: the side view reads (x, y), the front view reads (z, y). Torso length
 * and hip width are measured off the model, not assumed. The peak metrics run the heuristics' own
 * extrema finder and median (read-only imports), not a cycle maximum.
 */
import { findLocalExtrema } from '../../heuristics/extrema'
import { median } from '../../heuristics/mathUtils'
import { DEFAULT_HEURISTICS_CONFIG } from '../../heuristics/types'
import type { KeypointName } from '../../pose/types'
import { GAIT_PHASES, cyclesPerSecond, poseAt } from '../gaitModel'
import { strideSpan } from '../runnerAnnotations'
import type { Joint3D, RunnerParamId, RunnerParams, Vec3 } from '../types'

const DEG = 180 / Math.PI
export const DENSE_PHASES = Array.from({ length: 1000 }, (_, i) => i / 1000)

/** Frames per cycle and cycles for the peak metrics' series; 200 lands on both peak keys. */
const SERIES_FRAMES_PER_CYCLE = 200
const SERIES_CYCLES = 5

export function joint(pose: Joint3D[], name: KeypointName): Joint3D {
  const found = pose.find((j) => j.name === name)
  if (found === undefined) throw new Error(`missing ${name}`)
  return found
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

export function hipMid(pose: Joint3D[]): Vec3 {
  return mid(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
}

function shoulderMid(pose: Joint3D[]): Vec3 {
  return mid(joint(pose, 'left_shoulder'), joint(pose, 'right_shoulder'))
}

/** `estimateBodyScale`: shoulder-mid to hip-mid, side projection. */
export function torsoLength(pose: Joint3D[]): number {
  const s = shoulderMid(pose)
  const h = hipMid(pose)
  return Math.hypot(s.x - h.x, s.y - h.y)
}

export function hipWidth(pose: Joint3D[]): number {
  return Math.abs(joint(pose, 'right_hip').z - joint(pose, 'left_hip').z)
}

function peakToPeak(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

/** verticalOscillation: hip-mid vertical peak-to-peak over torso length. */
export function measureVerticalOscillation(params: RunnerParams): number {
  const poses = DENSE_PHASES.map((p) => poseAt(p, params))
  return peakToPeak(poses.map((pose) => hipMid(pose).y)) / torsoLength(poses[0])
}

/** trunkLean: atan2(dx, up) of hip-mid→shoulder-mid, travel is +x. */
export function measureTrunkLean(params: RunnerParams): number {
  const pose = poseAt(0.3, params)
  const s = shoulderMid(pose)
  const h = hipMid(pose)
  return Math.atan2(s.x - h.x, s.y - h.y) * DEG
}

/** armSwingAmplitude: mean over both arms of p2p (wrist.y − shoulder.y), over torso length. */
export function measureArmSwing(params: RunnerParams): number {
  const poses = DENSE_PHASES.map((p) => poseAt(p, params))
  const side = (s: 'left' | 'right') =>
    peakToPeak(poses.map((pose) => joint(pose, `${s}_wrist`).y - joint(pose, `${s}_shoulder`).y))
  return (side('left') + side('right')) / 2 / torsoLength(poses[0])
}

/** kneeDrive's per-frame signed thigh angle: atan2(dx, dy) of hip→knee, image y down. */
export function thighAngle(pose: Joint3D[], s: 'left' | 'right'): number {
  const hip = joint(pose, `${s}_hip`)
  const knee = joint(pose, `${s}_knee`)
  return Math.atan2(knee.x - hip.x, -(knee.y - hip.y)) * DEG
}

/** kneeFlexion's per-frame value: 180 − hip-knee-ankle interior angle, side projection. */
export function kneeFlexionAt(pose: Joint3D[], s: 'left' | 'right'): number {
  const hip = joint(pose, `${s}_hip`)
  const knee = joint(pose, `${s}_knee`)
  const ankle = joint(pose, `${s}_ankle`)
  const a = { x: hip.x - knee.x, y: hip.y - knee.y }
  const b = { x: ankle.x - knee.x, y: ankle.y - knee.y }
  const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))
  return 180 - Math.acos(Math.min(1, Math.max(-1, cos))) * DEG
}

/** Both legs' series over several cycles → prominent maxima → median, as the peak metrics do. */
function medianOfPeaks(
  params: RunnerParams,
  perFrame: (pose: Joint3D[], side: 'left' | 'right') => number,
  minProminence: number,
  keepPeak: (value: number) => boolean,
): number {
  const poses = Array.from({ length: SERIES_FRAMES_PER_CYCLE * SERIES_CYCLES + 1 }, (_, i) =>
    poseAt(i / SERIES_FRAMES_PER_CYCLE, params),
  )
  const peaks = (['left', 'right'] as const).flatMap((side) =>
    findLocalExtrema(
      poses.map((pose, i) => ({ t: i / SERIES_FRAMES_PER_CYCLE, v: perFrame(pose, side) })),
      minProminence,
    )
      .filter((extremum) => extremum.kind === 'max' && keepPeak(extremum.value))
      .map((extremum) => extremum.value),
  )
  if (peaks.length === 0) return Number.NaN
  return median(peaks)
}

/** kneeDrive: median of the positive prominent maxima of the signed thigh angle. */
export function measureKneeDrive(params: RunnerParams): number {
  return medianOfPeaks(
    params,
    thighAngle,
    DEFAULT_HEURISTICS_CONFIG.kneeDriveMinProminenceDegrees,
    (value) => value > 0,
  )
}

/** kneeFlexion: median of the prominent maxima of the flexion series. */
export function measureKneeFlexion(params: RunnerParams): number {
  return medianOfPeaks(
    params,
    kneeFlexionAt,
    DEFAULT_HEURISTICS_CONFIG.kneeFlexionMinProminenceDegrees,
    () => true,
  )
}

/** overstriding: (ankle.x − hipMid.x) / torso at the left foot's contact. */
export function measureOverstriding(params: RunnerParams): number {
  const pose = poseAt(GAIT_PHASES.leftContact, params)
  return (joint(pose, 'left_ankle').x - hipMid(pose).x) / torsoLength(pose)
}

/** footStrikePattern: (ankle.x − same-side knee.x) / torso at contact. */
export function measureFootStrike(params: RunnerParams): number {
  const pose = poseAt(GAIT_PHASES.leftContact, params)
  return (joint(pose, 'left_ankle').x - joint(pose, 'left_knee').x) / torsoLength(pose)
}

/** stepWidth: outward (ankle − hipMid) lateral offset at contact, over hip width (front view). */
export function measureStepWidth(params: RunnerParams): number {
  const left = poseAt(GAIT_PHASES.leftContact, params)
  const right = poseAt(GAIT_PHASES.rightContact, params)
  const leftWidth = -(joint(left, 'left_ankle').z - hipMid(left).z) / hipWidth(left)
  const rightWidth = (joint(right, 'right_ankle').z - hipMid(right).z) / hipWidth(right)
  return (leftWidth + rightWidth) / 2
}

/** Linear-interpolation percentile, the "linear" method `swingFootLateralExcursion` uses. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = p * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

/**
 * swingFootLateralExcursion: P80 − P20 of (ankle − knee) lateral over hip width, across the window
 * from the other foot's contact to the end of early-to-mid swing (the terminal third excluded).
 */
export function measureSwingFootArc(params: RunnerParams): number {
  const samples = 2000
  const { swingArcStart, swingArcEnd } = GAIT_PHASES
  const offsets = Array.from({ length: samples }, (_, i) => {
    const pose = poseAt(swingArcStart + ((swingArcEnd - swingArcStart) * i) / samples, params)
    return (joint(pose, 'left_ankle').z - joint(pose, 'left_knee').z) / hipWidth(pose)
  })
  return percentile(offsets, 0.8) - percentile(offsets, 0.2)
}

/** Each parameter's binding metric, measured off the model, with the tolerance it is exact to. */
export const MEASURE_PARAM: Record<
  RunnerParamId,
  { measure: (params: RunnerParams) => number; tolerance: number }
> = {
  cadence: { measure: (params) => cyclesPerSecond(params) * 120, tolerance: 1e-9 },
  pelvisBounce: { measure: measureVerticalOscillation, tolerance: 1e-9 },
  torsoPitch: { measure: measureTrunkLean, tolerance: 1e-9 },
  armSwing: { measure: measureArmSwing, tolerance: 1e-9 },
  // The extrema finder picks its pivot on a 3-sample smoothed series and reports the raw sample.
  peakThighAngle: { measure: measureKneeDrive, tolerance: 0.05 },
  peakSwingKneeBend: { measure: measureKneeFlexion, tolerance: 0.05 },
  landingOffset: { measure: measureOverstriding, tolerance: 1e-9 },
  contactShankOffset: { measure: measureFootStrike, tolerance: 1e-9 },
  stepWidth: { measure: measureStepWidth, tolerance: 1e-9 },
  swingFootArc: { measure: measureSwingFootArc, tolerance: 0.005 },
  // The stride moves no joint: it is the drawn stride bracket's length, contact to next contact.
  strideLength: { measure: measureStrideBracket, tolerance: 1e-12 },
}

/** The drawn stride: the stride bracket's length along the ground. */
export function measureStrideBracket(params: RunnerParams): number {
  const { start, end } = strideSpan(params, 'right')
  return end - start
}
