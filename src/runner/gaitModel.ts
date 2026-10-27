/**
 * The model runner's forward kinematics: a procedural, seamlessly looping gait cycle over the
 * nineteen `COMMON_KEYPOINT_NAMES` joints, driven by `RunnerParams`.
 *
 * **Everything fixed here is illustrative.** The body proportions, the keyframe values of the
 * curves, the foot shape and the arm geometry are a drawable stick figure, not measurements and not
 * targets. The only numbers that carry a claim are the bound parameters, and each one is realized
 * so that applying its metric's own formula to the joints this module returns gives back the
 * parameter's value (see `runnerParams.ts` and design.md D1).
 *
 * The stance foot stands on the ground (design.md D15). The figure's height is solved so that the
 * contact foot's lowest point is exactly on y = 0, and through stance the leg is solved by
 * two-segment inverse kinematics so the foot stays on the ground while the ankle slides back under
 * the hip. The bindings outrank the pin: where the geometry a parameter set asks for cannot keep
 * the foot down without breaking a binding (very large landing offsets), the mid-stance foot gives
 * way by a bounded amount instead, and the contact instant still sits exactly on the ground.
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

/** The ground plane's height. The stance foot stands on it (design.md D15). */
export const GROUND_Y = 0

/** The model's torso, for converting `verticalOscillationCm` into torso lengths. Illustrative. */
export const MODEL_TORSO_LENGTH_CM = 50

/**
 * Nominal hip-mid height, for framing: the camera presets aim at it. The drawn height is
 * `pelvisHeight(params)`, solved per parameter set so the contact foot stands on the ground; at the
 * neutral parameters it is 0.058 below this (pinned by `gaitModel.test.ts`), which the framing
 * absorbs, so the presets are unchanged.
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

/**
 * Stance/swing keyframes that no parameter binds. Illustrative. The stance leg's angles come from
 * the pin's inverse kinematics; these keys shape the swing and the toe-off target.
 */
const KNEE_MID_STANCE_DEG = 30
const KNEE_TOE_OFF_DEG = 28
const KNEE_LATE_SWING_DEG = 15
const KNEE_LATE_SWING_PHASE = 0.9
/**
 * The contact knee bend is held at or below the mid-stance key, so late swing → contact →
 * mid-stance never forms a second prominent knee-flexion maximum (design.md D2, D4).
 */
const MAX_CONTACT_KNEE_DEG = KNEE_MID_STANCE_DEG
const FOOT_MID_STANCE_DEG = 0
const FOOT_TOE_OFF_DEG = -35
/** Toe only slightly down at peak swing knee bend, so the swing toe clears the ground. */
const FOOT_MID_SWING_DEG = -5
const FOOT_LATE_SWING_DEG = 5

/**
 * How far above their lowest the hips sit at contact and toe-off, torso lengths (design.md D15):
 * the part of the bounce the planted stance leg absorbs. Large enough that a typical bounce mostly
 * happens in stance (so the flight hop never jumps in one frame) and the mid-stance knee visibly
 * bends; small enough that the stance knee stays under its cap. Illustrative.
 */
const STANCE_DROP = 0.1
/** The flight peak of the hips, in leg phase: midway between toe-off and the other contact. */
const FLIGHT_PEAK_PHASE = 0.44
/**
 * The stance knee's largest bend, above the larger of its contact and toe-off bends. Kept under
 * `kneeFlexionMinProminenceDegrees` (20) so stance never forms a second prominent knee-flexion
 * maximum. Illustrative.
 */
const STANCE_KNEE_PROMINENCE_MARGIN_DEG = 18
/** The stance knee also stays this far below the swing peak, so the swing peak is the maximum. */
const STANCE_KNEE_BELOW_SWING_DEG = 5
/**
 * How far the stance thigh may rise above its contact angle. Kept under
 * `kneeDriveMinProminenceDegrees` (10) so stance never forms a second prominent thigh maximum.
 * Illustrative.
 */
const STANCE_THIGH_RISE_MAX_DEG = 5

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

/** How far the foot's lowest point (heel or toe) sits below the ankle with the sole at `footDeg`. */
function footDrop(footDeg: number): number {
  const { heel, toe } = MODEL_PROPORTIONS
  const f = footDeg * DEG
  const below = (point: { along: number; normal: number }) =>
    -(point.along * Math.sin(f) + point.normal * Math.cos(f))
  return Math.max(below(heel), below(toe))
}

/** The toe's distance from the ankle, and its angle above the sole line. */
const TOE_REACH = Math.hypot(MODEL_PROPORTIONS.toe.along, MODEL_PROPORTIONS.toe.normal)
const TOE_ANGLE = Math.atan2(-MODEL_PROPORTIONS.toe.normal, MODEL_PROPORTIONS.toe.along)

/** The sole angle whose toe sits `drop` below the ankle: the toe's drop is R·sin(φ − f). */
function toeDownFootDeg(drop: number): number {
  return (TOE_ANGLE - Math.asin(clamp(drop / TOE_REACH, -1, 1))) / DEG
}

/**
 * The bounce shape at contact and toe-off, in [−1, 1]: `STANCE_DROP` above the lowest hips, or the
 * flight peak itself when the bounce is no larger than that. Continuous in the bounce.
 */
function stanceEndsBounceShape(bounce: number): number {
  const stanceLimited = bounce > 0 ? -1 + 2 * Math.min(1, STANCE_DROP / bounce) : 1
  return Math.min(SINUSOID_STANCE_ENDS_SHAPE, stanceLimited)
}

/**
 * Where a sinusoidal bounce (lowest at mid-stance, highest at the flight peak) sits at contact and
 * toe-off. A small bounce keeps this shape, so it moves no faster than a sinusoid would.
 */
const SINUSOID_STANCE_ENDS_SHAPE = -Math.cos(4 * Math.PI * GAIT_PHASES.midStance)

/**
 * The hips' height relative to `pelvisHeight`, as a fraction of half the bounce, in [−1, 1]. It
 * repeats every half cycle (one step), and its keys sit at the half-cycle phase so they are hit
 * exactly: lowest at mid-stance, highest at the flight peak, so the peak-to-peak is the bounce
 * exactly. The hips stay low through stance, which leaves the stance leg room to stay planted.
 */
function bounceShape(p: number, bounce: number): number {
  const atStanceEnds = stanceEndsBounceShape(bounce)
  return periodicEase(
    [
      [0, atStanceEnds],
      [2 * GAIT_PHASES.midStance, -1],
      [2 * GAIT_PHASES.stanceEnd, atStanceEnds],
      [2 * FLIGHT_PEAK_PHASE, 1],
    ],
    fract(2 * p),
  )
}

/**
 * The hip-mid height that puts the contact foot's lowest point exactly on the ground (y = 0). A
 * whole-figure vertical placement: no metric reads absolute height, so it moves no binding.
 */
export function pelvisHeight(params: RunnerParams): number {
  const legs = sagittalLegLengths(params.stepWidth)
  const contact = solveContact(params)
  return (
    GROUND_Y +
    footDrop(contact.shankDeg) +
    legs.thigh * Math.cos(contact.thighDeg * DEG) +
    legs.shank * Math.cos(contact.shankDeg * DEG) -
    (params.pelvisBounce / 2) * stanceEndsBounceShape(params.pelvisBounce)
  )
}

interface LegAngles {
  thighDeg: number
  kneeDeg: number
  footDeg: number
}

interface StanceFrame {
  contact: ContactGeometry
  legs: SagittalLegLengths
  /** The stance ankle's side-view x relative to the hip, at contact and at toe-off. */
  contactAnkleX: number
  toeOffAnkleX: number
  /** The hip-to-ankle distance at the stance knee's largest allowed bend. */
  minStanceReach: number
  maxStanceThighDeg: number
}

interface LegFrame extends StanceFrame {
  /** sin of the whole leg's constant lateral tilt, outward positive. */
  sinTilt: number
  /** Peak extra outward sin of the shank's lateral tilt during the swing arc. */
  arcSinPeak: number
  pelvisHeight: number
  /** The stance solve at toe-off: where the swing curves start. */
  toeOff: LegAngles
  lateSwingKneeDeg: number
}

function hipHeight(p: number, frame: LegFrame, params: RunnerParams): number {
  return frame.pelvisHeight + (params.pelvisBounce / 2) * bounceShape(p, params.pelvisBounce)
}

/** The hip-to-ankle distance of a two-segment leg with knee bend `kneeRad`. */
function legReach(kneeRad: number, legs: SagittalLegLengths): number {
  const { thigh, shank } = legs
  return Math.sqrt(thigh * thigh + shank * shank + 2 * thigh * shank * Math.cos(kneeRad))
}

/**
 * The stance leg at leg phase q in (0, stanceEnd], by inverse kinematics: the ankle slides back
 * linearly from its contact x to its toe-off x, at the height that puts the foot's lowest point on
 * the ground. Where the leg cannot reach that far down, the heel lifts onto the toe. The bindings
 * outrank the pin: the knee bend is capped so stance forms no second prominent knee-flexion
 * maximum, the leg cannot over-extend, and the thigh may not rise into a second prominent thigh
 * maximum. Where one of those engages, the foot gives way from the ground.
 */
function stanceAngles(q: number, hipY: number, frame: StanceFrame): LegAngles {
  const { thigh, shank } = frame.legs
  const reach = thigh + shank
  const x =
    frame.contactAnkleX + ((frame.toeOffAnkleX - frame.contactAnkleX) * q) / GAIT_PHASES.stanceEnd
  let footDeg = periodicEase(
    [
      [GAIT_PHASES.leftContact, frame.contact.shankDeg],
      [GAIT_PHASES.midStance, FOOT_MID_STANCE_DEG],
      [GAIT_PHASES.stanceEnd, FOOT_TOE_OFF_DEG],
    ],
    q,
  )
  let ankleY = footDrop(footDeg)
  const lowestReachable = hipY - Math.sqrt(Math.max(0, reach * reach - x * x))
  if (lowestReachable > ankleY) {
    ankleY = Math.min(lowestReachable, TOE_REACH)
    footDeg = Math.min(footDeg, toeDownFootDeg(ankleY))
  }
  const v = ankleY - hipY
  const d = clamp(Math.hypot(x, v), frame.minStanceReach, reach)
  const thighRad =
    Math.atan2(x, -v) +
    Math.acos(clamp((thigh * thigh + d * d - shank * shank) / (2 * thigh * d), -1, 1))
  const kneeRad =
    Math.PI - Math.acos(clamp((thigh * thigh + shank * shank - d * d) / (2 * thigh * shank), -1, 1))
  return {
    thighDeg: Math.min(thighRad / DEG, frame.maxStanceThighDeg),
    kneeDeg: kneeRad / DEG,
    footDeg,
  }
}

function legFrame(params: RunnerParams): LegFrame {
  const { hipWidth, shank } = MODEL_PROPORTIONS
  const contact = solveContact(params)
  const legs = sagittalLegLengths(params.stepWidth)
  const height = pelvisHeight(params)
  const stanceEndsHipY =
    height + (params.pelvisBounce / 2) * stanceEndsBounceShape(params.pelvisBounce)
  const toeOffReach = legReach(KNEE_TOE_OFF_DEG * DEG, legs)
  const toeOffAnkleDepth = stanceEndsHipY - footDrop(FOOT_TOE_OFF_DEG)
  const maxStanceKneeDeg = Math.min(
    params.peakSwingKneeBend - STANCE_KNEE_BELOW_SWING_DEG,
    Math.max(KNEE_TOE_OFF_DEG, contact.kneeDeg) + STANCE_KNEE_PROMINENCE_MARGIN_DEG,
  )
  const stance: StanceFrame = {
    contact,
    legs,
    contactAnkleX:
      legs.thigh * Math.sin(contact.thighDeg * DEG) + legs.shank * Math.sin(contact.shankDeg * DEG),
    toeOffAnkleX: -Math.sqrt(Math.max(0, toeOffReach ** 2 - toeOffAnkleDepth ** 2)),
    minStanceReach: legReach(maxStanceKneeDeg * DEG, legs),
    maxStanceThighDeg: Math.min(
      Math.max(params.peakThighAngle, contact.thighDeg),
      contact.thighDeg + STANCE_THIGH_RISE_MAX_DEG,
    ),
  }
  return {
    ...stance,
    sinTilt: legTiltSin(params.stepWidth),
    arcSinPeak: (params.swingFootArc * hipWidth) / (shank * RAISED_COSINE_P80_P20),
    pelvisHeight: height,
    toeOff: stanceAngles(GAIT_PHASES.stanceEnd, stanceEndsHipY, stance),
    lateSwingKneeDeg: Math.max(KNEE_LATE_SWING_DEG, contact.kneeDeg),
  }
}

/** Swing, toe-off → contact: forward-kinematic keyframe curves from the stance solve's toe-off. */
function swingAngles(q: number, frame: LegFrame, params: RunnerParams): LegAngles {
  const { contact, toeOff } = frame
  return {
    thighDeg: periodicEase(
      [
        [GAIT_PHASES.leftContact, contact.thighDeg],
        [GAIT_PHASES.stanceEnd, toeOff.thighDeg],
        [GAIT_PHASES.peakThigh, params.peakThighAngle],
      ],
      q,
    ),
    kneeDeg: periodicEase(
      [
        [GAIT_PHASES.leftContact, contact.kneeDeg],
        [GAIT_PHASES.stanceEnd, toeOff.kneeDeg],
        [GAIT_PHASES.peakSwingKneeBend, params.peakSwingKneeBend],
        [KNEE_LATE_SWING_PHASE, frame.lateSwingKneeDeg],
      ],
      q,
    ),
    footDeg: periodicEase(
      [
        [GAIT_PHASES.leftContact, contact.shankDeg],
        [GAIT_PHASES.stanceEnd, toeOff.footDeg],
        [GAIT_PHASES.peakSwingKneeBend, FOOT_MID_SWING_DEG],
        [KNEE_LATE_SWING_PHASE, FOOT_LATE_SWING_DEG],
      ],
      q,
    ),
  }
}

function legAngles(q: number, hipY: number, frame: LegFrame, params: RunnerParams): LegAngles {
  const { contact } = frame
  // Contact is drawn from its own geometry, so the contact-instant bindings stay exact.
  if (q === GAIT_PHASES.leftContact) {
    return { thighDeg: contact.thighDeg, kneeDeg: contact.kneeDeg, footDeg: contact.shankDeg }
  }
  if (q <= GAIT_PHASES.stanceEnd) return stanceAngles(q, hipY, frame)
  return swingAngles(q, frame, params)
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
  const { sinTilt, arcSinPeak } = frame
  const { thighDeg, kneeDeg, footDeg } = legAngles(q, hip.y, frame, params)

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

  const frame = legFrame(params)
  const hipMid = { x: 0, y: hipHeight(p, frame, params), z: 0 }
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
