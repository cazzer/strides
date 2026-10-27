/**
 * The model runner's forward kinematics: a procedural, seamlessly looping gait cycle over the
 * nineteen `COMMON_KEYPOINT_NAMES` joints, driven by `RunnerParams`.
 *
 * **Everything fixed here is illustrative.** The body proportions, the keyframe values of the
 * curves, the foot shape and the arm geometry are a drawable stick figure, not measurements and not
 * targets. The only numbers that carry a claim are the bound parameters, and each one is realized
 * so that applying its metric's own formula to the joints this module returns gives back the
 * parameter's value (see `runnerParams.ts` and design.md D1). There is no inverse kinematics: the
 * stance foot is not pinned to the ground, so it slides and lifts a little during stance.
 *
 * Frame: x = direction of travel, y = up (ground at y = 0), z = the runner's right. Units are
 * torso lengths. Hip-mid sits at x = 0, z = 0. Phase 0..1 is one full gait cycle: left contact at
 * 0, right contact at 0.5. The right side is the left side half a cycle later, mirrored.
 */
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import type { Joint3D, RunnerParamId, RunnerParams, Vec3 } from './types'

/** Illustrative stick-figure proportions, torso lengths (shoulder-mid to hip-mid = 1). */
export const MODEL_PROPORTIONS = {
  /** Distance between the two hip joints. The model's hip width, the unit of `stepWidth`. */
  hipWidth: 0.4,
  shoulderWidth: 0.75,
  thigh: 0.85,
  shank: 0.85,
  upperArm: 0.6,
  forearm: 0.55,
  /** Fixed elbow bend; the arm swings as a rigid unit about the shoulder. */
  elbowFlexionDeg: 80,
  /** Mean forward angle of the arm unit, so the swing stays monotone over its whole range. */
  armCentreDeg: 48,
  /** Heel and toe positions in the foot frame: `along` the sole, along its upward `normal`. */
  heel: { along: -0.15, normal: -0.1 },
  toe: { along: 0.45, normal: -0.1 },
  /** Head points in the torso frame relative to shoulder-mid. */
  ear: { forward: -0.05, up: 0.42, lateral: 0.12 },
  nose: { forward: 0.12, up: 0.38 },
} as const

/** The model's torso, for converting `verticalOscillationCm` into torso lengths. Illustrative. */
export const MODEL_TORSO_LENGTH_CM = 50

/**
 * Mean hip-mid height. Tuned once so that, at the neutral parameters, the lowest foot point over
 * the whole cycle sits on the ground (pinned by `gaitModel.test.ts`). Fixed rather than solved per
 * pose, because solving it would let a leg parameter move the torso.
 */
export const PELVIS_HEIGHT = 1.8066

/** Key instants of the cycle, in LEFT-leg phase. The right leg runs half a cycle later. */
export const GAIT_PHASES = {
  leftContact: 0,
  rightContact: 0.5,
  /** Lowest hip, the stance knee's loading bend. */
  midStance: 0.19,
  /** Toe-off: the thigh's most trailing angle. */
  stanceEnd: 0.38,
  peakSwingKneeBend: 0.62,
  peakThigh: 0.85,
  /** The swing-foot arc runs from the other foot's contact to the end of early-to-mid swing. */
  swingArcStart: 0.5,
  swingArcEnd: 5 / 6,
} as const

const DEG = Math.PI / 180

/** Stance/swing keyframes that no parameter binds. Illustrative. */
const THIGH_TOE_OFF_DEG = -22
const KNEE_MID_STANCE_DEG = 30
const KNEE_TOE_OFF_DEG = 22
const KNEE_LATE_SWING_DEG = 15
const KNEE_LATE_SWING_PHASE = 0.9
/**
 * The contact knee bend is held at or below the mid-stance key, so late swing → contact →
 * mid-stance never forms a second prominent knee-flexion maximum (design.md D2, D4).
 */
const MAX_CONTACT_KNEE_DEG = KNEE_MID_STANCE_DEG
const FOOT_MID_STANCE_DEG = 0
const FOOT_TOE_OFF_DEG = -35
const FOOT_MID_SWING_DEG = -20
const FOOT_LATE_SWING_DEG = 5

/**
 * P80 − P20 of a raised cosine sampled uniformly over one full period, as a fraction of its peak:
 * the value v = (1 − cos φ)/2 has P(v ≤ x) = arccos(1 − 2x)/π, so P80 − P20 = cos(π/5).
 */
const RAISED_COSINE_P80_P20 = Math.cos(Math.PI / 5)

const ARM_SWING_PHASE_OFFSET = 0.15

type Keyframe = readonly [phase: number, value: number]

/**
 * Periodic cosine-eased keyframe curve over q ∈ [0, 1). Exact at each key, C1, never overshoots,
 * and the segment from the last key wraps to the first key at q = 1.
 */
function periodicEase(keys: readonly Keyframe[], q: number): number {
  for (let i = 0; i < keys.length; i += 1) {
    const [q0, v0] = keys[i]
    const [nextPhase, v1] = keys[(i + 1) % keys.length]
    const q1 = i + 1 < keys.length ? nextPhase : nextPhase + 1
    if (q >= q0 && q < q1) {
      const u = (q - q0) / (q1 - q0)
      return v0 + ((v1 - v0) * (1 - Math.cos(Math.PI * u))) / 2
    }
  }
  return keys[0][1]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function fract(value: number): number {
  return value - Math.floor(value)
}

interface ContactGeometry {
  thighDeg: number
  kneeDeg: number
  shankDeg: number
}

interface SagittalLegLengths {
  thigh: number
  shank: number
}

/** sin of the whole leg's constant outward tilt that puts the contact ankle at `stepWidth`. */
function legTiltSin(stepWidth: number): number {
  const { hipWidth, thigh, shank } = MODEL_PROPORTIONS
  // Each segment tilts outward by the same angle, so the contact ankle's lateral offset from its
  // own hip joint is (T + S)·sin(tilt), independent of the sagittal angles.
  return clamp(((stepWidth - 0.5) * hipWidth) / (thigh + shank), -1, 1)
}

/** The leg segments' side-view lengths: the outward tilt shortens both by cos(tilt). */
function sagittalLegLengths(stepWidth: number): SagittalLegLengths {
  const sinTilt = legTiltSin(stepWidth)
  const scale = Math.sqrt(1 - sinTilt * sinTilt)
  return { thigh: MODEL_PROPORTIONS.thigh * scale, shank: MODEL_PROPORTIONS.shank * scale }
}

const MAX_CONTACT_KNEE_RAD = MAX_CONTACT_KNEE_DEG * DEG

/**
 * The contact thigh angle that puts the ankle exactly `landingOffset` ahead of the hip with knee
 * bend `kneeRad`: ankle.x − hip.x = Im(e^{iθ}(T + S e^{−iκ})) = R sin(θ + φ). Increasing in the
 * knee bend over [0, MAX_CONTACT_KNEE_DEG] for these proportions.
 */
function thighForLanding(landingOffset: number, kneeRad: number, legs: SagittalLegLengths): number {
  const re = legs.thigh + legs.shank * Math.cos(kneeRad)
  const im = -legs.shank * Math.sin(kneeRad)
  return Math.asin(clamp(landingOffset / Math.hypot(re, im), -1, 1)) - Math.atan2(im, re)
}

/** The shank angle that puts the ankle exactly `contactShankOffset` ahead of the knee. */
function shankForStrike(contactShankOffset: number, legs: SagittalLegLengths): number {
  return Math.asin(clamp(contactShankOffset / legs.shank, -1, 1))
}

/**
 * Thigh, knee and shank angles at contact, as `poseAt` draws them. Both offsets are exact when the
 * knee bend they imply lies in [0°, MAX_CONTACT_KNEE_DEG]. Otherwise the bend is clamped and the
 * thigh re-solved so the landing offset stays exact: the shank offset gives way. Parameters from
 * `realizeParams` never conflict, so for them both offsets are always exact.
 */
function solveContact(params: RunnerParams): ContactGeometry {
  const legs = sagittalLegLengths(params.stepWidth)
  const shankRatio = params.contactShankOffset / legs.shank
  const shankRad = Math.asin(clamp(shankRatio, -1, 1))
  const thighRatio = (params.landingOffset - legs.shank * Math.sin(shankRad)) / legs.thigh
  const thighRad = Math.asin(clamp(thighRatio, -1, 1))
  const kneeRad = thighRad - shankRad
  if (
    Math.abs(shankRatio) <= 1 &&
    Math.abs(thighRatio) <= 1 &&
    kneeRad >= 0 &&
    kneeRad <= MAX_CONTACT_KNEE_RAD
  ) {
    return { thighDeg: thighRad / DEG, kneeDeg: kneeRad / DEG, shankDeg: shankRad / DEG }
  }
  const knee = clamp(kneeRad, 0, MAX_CONTACT_KNEE_RAD)
  const thighSolved = thighForLanding(params.landingOffset, knee, legs)
  return { thighDeg: thighSolved / DEG, kneeDeg: knee / DEG, shankDeg: (thighSolved - knee) / DEG }
}

/** The three parameters that share the contact leg geometry, in default precedence order. */
export const CONTACT_PARAMS = ['landingOffset', 'contactShankOffset', 'peakThighAngle'] as const

type ContactParamId = (typeof CONTACT_PARAMS)[number]

/**
 * The parameters the model actually draws. `landingOffset`, `contactShankOffset` and
 * `peakThighAngle` all constrain the contact leg (the measured knee drive reads the larger of the
 * swing peak and the contact thigh angle), and some combinations cannot all be drawn. This
 * resolves them by precedence and returns a conflict-free set, for which measuring `poseAt` returns
 * every value exactly. Every other parameter is returned unchanged.
 *
 * Precedence: a parameter in `measured` beats one that is not, so a neutral partner gives way and
 * the measured value is drawn exactly. Within the measured (or within the neutral) ones the order
 * is landing offset, then contact shank offset, then peak thigh angle (design.md D4). A parameter
 * that gives way is drawn as close to its requested value as the stronger ones allow.
 */
export function realizeParams(
  params: RunnerParams,
  measured: ReadonlySet<RunnerParamId> = new Set(),
): RunnerParams {
  const rank = (id: ContactParamId) =>
    (measured.has(id) ? 0 : CONTACT_PARAMS.length) + CONTACT_PARAMS.indexOf(id)
  const landingRank = rank('landingOffset')
  const strikeRank = rank('contactShankOffset')
  const thighPeakRank = rank('peakThighAngle')
  const legs = sagittalLegLengths(params.stepWidth)
  const landing = params.landingOffset
  const peak = params.peakThighAngle * DEG
  const strikeShank = shankForStrike(params.contactShankOffset, legs)
  const landingKept = landingRank < strikeRank

  // Landing vs foot strike: the knee bend both imply, clamped; the stronger one stays exact.
  const exactThigh = Math.asin(
    clamp((landing - legs.shank * Math.sin(strikeShank)) / legs.thigh, -1, 1),
  )
  let knee = clamp(exactThigh - strikeShank, 0, MAX_CONTACT_KNEE_RAD)
  let thigh = landingKept ? thighForLanding(landing, knee, legs) : strikeShank + knee

  if (thigh > peak && thighPeakRank < Math.max(landingRank, strikeRank)) {
    // The thigh peak outranks the weaker contact offset, so the contact thigh comes down to it.
    const peakOutranksKept = thighPeakRank < Math.min(landingRank, strikeRank)
    if (landingKept) {
      if (thighForLanding(landing, 0, legs) <= peak) {
        const shankOnLanding = Math.asin(
          clamp((landing - legs.thigh * Math.sin(peak)) / legs.shank, -1, 1),
        )
        knee = clamp(peak - shankOnLanding, 0, MAX_CONTACT_KNEE_RAD)
        thigh = peak
      } else if (peakOutranksKept) {
        // Even a straight leg lands too far ahead for this thigh peak, so both offsets give way.
        // The leg stays straight, which is where the landing-exact branch above leaves it at the
        // boundary, so the drawn offsets stay continuous in the inputs.
        thigh = peak
        knee = 0
      } else {
        knee = 0
        thigh = thighForLanding(landing, 0, legs)
      }
    } else if (peak - strikeShank >= 0) {
      knee = Math.min(peak - strikeShank, MAX_CONTACT_KNEE_RAD)
      thigh = peak
    } else if (peakOutranksKept) {
      knee = 0
      thigh = peak
    } else {
      knee = 0
      thigh = strikeShank
    }
  }

  const drawnStrike = legs.shank * Math.sin(thigh - knee)
  const drawnLanding = legs.thigh * Math.sin(thigh) + drawnStrike
  const drawnPeak = Math.max(peak, thigh) / DEG
  // A value the solve reproduced is returned as given, not as its floating-point echo.
  const keep = (requested: number, drawn: number) =>
    Math.abs(drawn - requested) <= 1e-9 ? requested : drawn
  return {
    ...params,
    landingOffset: keep(landing, drawnLanding),
    contactShankOffset: keep(params.contactShankOffset, drawnStrike),
    peakThighAngle: keep(params.peakThighAngle, drawnPeak),
  }
}

/** Raised-cosine bump over early-to-mid swing; 0 elsewhere, C1 at both ends. */
function swingArcBump(q: number): number {
  const { swingArcStart, swingArcEnd } = GAIT_PHASES
  if (q < swingArcStart || q > swingArcEnd) return 0
  const u = (q - swingArcStart) / (swingArcEnd - swingArcStart)
  return (1 - Math.cos(2 * Math.PI * u)) / 2
}

interface LegFrame {
  contact: ContactGeometry
  /** sin of the whole leg's constant lateral tilt, outward positive. */
  sinTilt: number
  /** Peak extra outward sin of the shank's lateral tilt during the swing arc. */
  arcSinPeak: number
}

function legFrame(params: RunnerParams): LegFrame {
  const { hipWidth, shank } = MODEL_PROPORTIONS
  return {
    contact: solveContact(params),
    sinTilt: legTiltSin(params.stepWidth),
    arcSinPeak: (params.swingFootArc * hipWidth) / (shank * RAISED_COSINE_P80_P20),
  }
}

interface LegJoints {
  knee: Vec3
  ankle: Vec3
  heel: Vec3
  footIndex: Vec3
}

/**
 * One leg at leg phase q. `side` is the sign of the runner's outward direction in world z: −1 for
 * the left leg, +1 for the right.
 */
function legAt(q: number, side: -1 | 1, hip: Vec3, frame: LegFrame, params: RunnerParams): LegJoints {
  const { thigh, shank, heel, toe } = MODEL_PROPORTIONS
  const { contact, sinTilt, arcSinPeak } = frame

  const thighDeg = periodicEase(
    [
      [GAIT_PHASES.leftContact, contact.thighDeg],
      [GAIT_PHASES.stanceEnd, THIGH_TOE_OFF_DEG],
      [GAIT_PHASES.peakThigh, params.peakThighAngle],
    ],
    q,
  )
  const kneeDeg = periodicEase(
    [
      [GAIT_PHASES.leftContact, contact.kneeDeg],
      [GAIT_PHASES.midStance, KNEE_MID_STANCE_DEG],
      [GAIT_PHASES.stanceEnd, KNEE_TOE_OFF_DEG],
      [GAIT_PHASES.peakSwingKneeBend, params.peakSwingKneeBend],
      [KNEE_LATE_SWING_PHASE, KNEE_LATE_SWING_DEG],
    ],
    q,
  )
  const footDeg = periodicEase(
    [
      [GAIT_PHASES.leftContact, contact.shankDeg],
      [GAIT_PHASES.midStance, FOOT_MID_STANCE_DEG],
      [GAIT_PHASES.stanceEnd, FOOT_TOE_OFF_DEG],
      [GAIT_PHASES.peakSwingKneeBend, FOOT_MID_SWING_DEG],
      [KNEE_LATE_SWING_PHASE, FOOT_LATE_SWING_DEG],
    ],
    q,
  )

  const thighRad = thighDeg * DEG
  const shankRad = (thighDeg - kneeDeg) * DEG
  const thighCos = Math.sqrt(1 - sinTilt * sinTilt)
  // The swing arc adds outward tilt to the shank alone, chosen so the shank's lateral component is
  // sinTilt·S plus a raised cosine: the ankle-minus-knee lateral range is then exactly the bump's.
  const shankSin = clamp(sinTilt + arcSinPeak * swingArcBump(q), -1, 1)
  const shankCos = Math.sqrt(1 - shankSin * shankSin)

  const knee = {
    x: hip.x + thigh * thighCos * Math.sin(thighRad),
    y: hip.y - thigh * thighCos * Math.cos(thighRad),
    z: hip.z + side * thigh * sinTilt,
  }
  const ankle = {
    x: knee.x + shank * shankCos * Math.sin(shankRad),
    y: knee.y - shank * shankCos * Math.cos(shankRad),
    z: knee.z + side * shank * shankSin,
  }
  const footRad = footDeg * DEG
  const sole = { x: Math.cos(footRad), y: Math.sin(footRad) }
  const normal = { x: -Math.sin(footRad), y: Math.cos(footRad) }
  const footPoint = (offset: { along: number; normal: number }): Vec3 => ({
    x: ankle.x + offset.along * sole.x + offset.normal * normal.x,
    y: ankle.y + offset.along * sole.y + offset.normal * normal.y,
    z: ankle.z,
  })
  return { knee, ankle, heel: footPoint(heel), footIndex: footPoint(toe) }
}

interface ArmJoints {
  elbow: Vec3
  wrist: Vec3
}

/**
 * The arm swings as a rigid bent unit about the shoulder, in the world sagittal plane (so trunk
 * lean translates the arm but never changes wrist-relative-to-shoulder height). The wrist's drop
 * below the shoulder is R·cos(θ + φ), and θ + φ swings sinusoidally about `armCentreDeg` with an
 * amplitude chosen so its peak-to-peak drop is exactly `armSwing`.
 */
function armAt(p: number, shoulder: Vec3, params: RunnerParams): ArmJoints {
  const { upperArm, forearm, elbowFlexionDeg, armCentreDeg } = MODEL_PROPORTIONS
  const bend = elbowFlexionDeg * DEG
  const re = upperArm + forearm * Math.cos(bend)
  const im = forearm * Math.sin(bend)
  const reach = Math.hypot(re, im)
  const unitAngle = Math.atan2(im, re)
  const centre = armCentreDeg * DEG
  const amplitude = Math.asin(clamp(params.armSwing / (2 * reach * Math.sin(centre)), -1, 1))
  const armRad =
    centre - unitAngle + amplitude * Math.sin(2 * Math.PI * (p - ARM_SWING_PHASE_OFFSET))
  const elbow = {
    x: shoulder.x + upperArm * Math.sin(armRad),
    y: shoulder.y - upperArm * Math.cos(armRad),
    z: shoulder.z,
  }
  const wrist = {
    x: elbow.x + forearm * Math.sin(armRad + bend),
    y: elbow.y - forearm * Math.cos(armRad + bend),
    z: elbow.z,
  }
  return { elbow, wrist }
}

/** Gait cycles per second: two steps per cycle. */
export function cyclesPerSecond(params: RunnerParams): number {
  return params.cadence / 120
}

/**
 * The model runner at `phase` (any real number; one cycle per unit, so 0 and 1 are the same pose).
 * Returns one joint per `COMMON_KEYPOINT_NAMES` entry, in that order.
 *
 * Each metric's formula reads each value back exactly only for `realizeParams` /
 * `bindRunnerParams` output. Other input (e.g. a mid-tween mix) is drawn with the
 * default-order contact resolution (landing exact, foot strike gives way), which is continuous.
 */
export function poseAt(phase: number, params: RunnerParams): Joint3D[] {
  const p = fract(phase)
  const { hipWidth, shoulderWidth, ear, nose } = MODEL_PROPORTIONS

  const hipMid = {
    x: 0,
    y:
      PELVIS_HEIGHT -
      (params.pelvisBounce / 2) * Math.cos(4 * Math.PI * (p - GAIT_PHASES.midStance)),
    z: 0,
  }
  const leftHip = { x: hipMid.x, y: hipMid.y, z: hipMid.z - hipWidth / 2 }
  const rightHip = { x: hipMid.x, y: hipMid.y, z: hipMid.z + hipWidth / 2 }

  const lean = params.torsoPitch * DEG
  const up = { x: Math.sin(lean), y: Math.cos(lean) }
  const forward = { x: Math.cos(lean), y: -Math.sin(lean) }
  const shoulderMid = { x: hipMid.x + up.x, y: hipMid.y + up.y, z: hipMid.z }
  const torsoPoint = (fwd: number, upward: number, lateral: number): Vec3 => ({
    x: shoulderMid.x + fwd * forward.x + upward * up.x,
    y: shoulderMid.y + fwd * forward.y + upward * up.y,
    z: shoulderMid.z + lateral,
  })
  const leftShoulder = torsoPoint(0, 0, -shoulderWidth / 2)
  const rightShoulder = torsoPoint(0, 0, shoulderWidth / 2)

  const frame = legFrame(params)
  const leftLeg = legAt(p, -1, leftHip, frame, params)
  const rightLeg = legAt(fract(p + 0.5), 1, rightHip, frame, params)
  const leftArm = armAt(p, leftShoulder, params)
  const rightArm = armAt(p + 0.5, rightShoulder, params)

  const joints: Record<KeypointName, Vec3> = {
    left_shoulder: leftShoulder,
    right_shoulder: rightShoulder,
    left_elbow: leftArm.elbow,
    right_elbow: rightArm.elbow,
    left_wrist: leftArm.wrist,
    right_wrist: rightArm.wrist,
    left_hip: leftHip,
    right_hip: rightHip,
    left_knee: leftLeg.knee,
    right_knee: rightLeg.knee,
    left_ankle: leftLeg.ankle,
    right_ankle: rightLeg.ankle,
    nose: torsoPoint(nose.forward, nose.up, 0),
    left_ear: torsoPoint(ear.forward, ear.up, -ear.lateral),
    right_ear: torsoPoint(ear.forward, ear.up, ear.lateral),
    left_heel: leftLeg.heel,
    right_heel: rightLeg.heel,
    left_foot_index: leftLeg.footIndex,
    right_foot_index: rightLeg.footIndex,
  }
  return COMMON_KEYPOINT_NAMES.map((name) => ({ name, ...joints[name] }))
}
