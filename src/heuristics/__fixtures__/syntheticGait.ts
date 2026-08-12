import { COMMON_KEYPOINT_NAMES } from '../../pose/types'
import type { KeypointName } from '../../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../../pose/robustness/types'

export interface SyntheticGaitParams {
  durationSec: number
  fps: number
  /** Steps per minute, both feet combined (a realistic run cadence is roughly 160-190). */
  cadenceStepsPerMin: number
  /** Peak ankle-relative-to-hip sagittal sway, in px, for the side-view geometry. */
  strideAmplitudePx: number
  /** Peak-to-peak hip-y bounce amplitude, in px. */
  verticalBouncePx: number
  /** Constant forward lean angle, in degrees (only expressed in the 'side' geometry). */
  trunkLeanDeg: number
  view: 'side' | 'front'
  /**
   * Real-world scale attached to every generated frame. Omitted (→ `null` per frame) by default,
   * matching every backend except MediaPipe. A function form lets a test generate a *drifting*
   * scale (the camera-approach case) without hand-building frames.
   */
  pixelsPerMeter?: number | ((t: number, frameIndex: number) => number | null)
  /**
   * Peak-to-peak head (ear-mid) bounce as a fraction of `verticalBouncePx`, the hip's peak-to-peak
   * bounce — i.e. `earMid`'s expected vertical-oscillation value is hand-computable as
   * `verticalBouncePx * headBounceDamping / TORSO_LENGTH_PX`. Defaults to 0.85, the midpoint of
   * the 0.80–0.92 ratio measured between hip-mid and ear-mid signals in epic #27's integration-
   * level A/B (see `openspec/changes/widen-keypoints-selectable-vo-signal/design.md`).
   */
  headBounceDamping?: number
}

/**
 * Fixed torso length for every synthetic figure, modeled as a rigid segment rotated by the lean
 * angle around the hip. Because it's rigid, `distance(shoulderMid, hipMid)` comes out to exactly
 * this value regardless of lean — matching a real torso, whose length doesn't change as it leans.
 * Chosen as a plausible mid-frame pixel scale; not derived from real footage.
 */
const TORSO_LENGTH_PX = 150
const HIP_BASE_X = 200
const HIP_BASE_Y = 400
const TRAVEL_SPEED_PX_PER_SEC = 100

/** Left/right shoulder and hip nearly coincide in side view — a small fixed offset, not zero, so
 * bilateral-pair resolution always has two distinct points to work with. */
const SIDE_VIEW_BILATERAL_OFFSET_PX = 6
/** True shoulder/hip width, fully visible face-on. Deliberately well clear of
 * frontViewMinBilateralSpreadRatio (0.55 * 150px torso = 82.5px), not just barely over it, so a
 * clean front-view fixture reads as confidently front rather than borderline. */
const FRONT_VIEW_BILATERAL_OFFSET_PX = 130
/**
 * Front-on, the sagittal (fore-aft) leg reach that dominates side-view ankle sway is invisible;
 * only a much smaller mediolateral component remains visible. This factor is a documented
 * judgment call (not a measurement) chosen so front-view fixtures land comfortably under the
 * view-detection sagittal-excursion threshold while side-view fixtures land comfortably over it.
 */
const FRONT_VIEW_ANKLE_SWAY_FACTOR = 0.15
/** Ankle vertical lift amplitude — large enough relative to TORSO_LENGTH_PX to comfortably clear
 * the default footstrike-prominence threshold. Independent of strideAmplitudePx: it only needs
 * to make footstrikes detectable, and doesn't feed into any hand-computed expected value. */
const ANKLE_LIFT_PX = 50

/** Default peak-to-peak head bounce as a fraction of the hip's — see `SyntheticGaitParams`'s
 * `headBounceDamping` doc. */
const DEFAULT_HEAD_BOUNCE_DAMPING = 0.85
/** Rigid vertical offset from the shoulder midpoint's own (bounce-free) baseline up to the head
 * midpoint's baseline — a plausible neck-to-head-center distance, not measured from footage.
 * Constant across every frame: the head doesn't get closer to or further from the shoulders as
 * either bounces, only the two baselines differ. */
const HEAD_ABOVE_SHOULDER_PX = 60
/** Left/right ear x-spread around the head midpoint in side view — small but nonzero, same reason
 * as SIDE_VIEW_BILATERAL_OFFSET_PX: bilateral-pair resolution always needs two distinct points. */
const SIDE_VIEW_EAR_SPREAD_PX = 8
/** True ear-to-ear spread, fully visible face-on — narrower than FRONT_VIEW_BILATERAL_OFFSET_PX's
 * shoulder spread, since a head is narrower than shoulders. A documented judgment call, not a
 * measurement. */
const FRONT_VIEW_EAR_SPREAD_PX = 70

function detectedKeypoint(name: KeypointName, x: number, y: number): RobustKeypoint {
  return { name, x, y, score: 0.9, status: 'detected' }
}

/** Rigid torso vector from hip to shoulder, rotated by `leanDeg` — see trunkLean.ts's
 * `atan2(dx, -dy)` for why this construction recovers exactly `leanDeg` back out. */
function torsoOffset(leanDeg: number): { dx: number; dy: number } {
  const leanRad = (leanDeg * Math.PI) / 180
  return {
    dx: TORSO_LENGTH_PX * Math.sin(leanRad),
    dy: -TORSO_LENGTH_PX * Math.cos(leanRad),
  }
}

/**
 * Generates a parametric, sinusoidal-gait `RobustPoseFrame[]` with view-consistent geometry —
 * every keypoint `status: 'detected'`, every frame `source: 'detected'`.
 *
 * Vertical bounce (hip/shoulder y) oscillates at 2x stride frequency (two bounces per full gait
 * cycle — once per footstrike, left and right), amplitude `verticalBouncePx / 2` so that
 * consecutive extrema differ by exactly `verticalBouncePx` (peak-to-trough), making the expected
 * vertical-oscillation value hand-computable as `verticalBouncePx / TORSO_LENGTH_PX`.
 *
 * Each ankle sways sagittally at stride frequency, left and right in opposite phase (when one leg
 * is forward the other is back). Ankle-y is built as a monotone function of that same sway phase
 * so its single per-stride maximum (the footstrike proxy) always lands exactly when the ankle is
 * at its peak forward sway — making the expected overstride ratio hand-computable as
 * `strideAmplitudePx / TORSO_LENGTH_PX` for both legs, independent of ANKLE_LIFT_PX.
 *
 * The head (nose + ears) is a rigid unit offset above the shoulder midpoint's own bounce-free
 * baseline, oscillating at the SAME phase/frequency as the hip bounce but with its own
 * (damped) amplitude — `verticalBouncePx * headBounceDamping / 2` half-amplitude — rather than
 * literally inheriting the shoulder's full-amplitude motion, so that `earMid`'s expected
 * vertical-oscillation value is hand-computable as `verticalBouncePx * headBounceDamping /
 * TORSO_LENGTH_PX`, independent of `HEAD_ABOVE_SHOULDER_PX`. Both ears share the head's y exactly
 * (only x differs, view-appropriately spread), same construction `hipY`/`shoulderY` already use
 * for their own bilateral pairs. Nose is x-centered on the head midpoint, at the same y.
 */
export function generateSyntheticGait(params: SyntheticGaitParams): RobustPoseFrame[] {
  const {
    durationSec,
    fps,
    cadenceStepsPerMin,
    strideAmplitudePx,
    verticalBouncePx,
    trunkLeanDeg,
    view,
    pixelsPerMeter,
    headBounceDamping = DEFAULT_HEAD_BOUNCE_DAMPING,
  } = params

  const scaleAt = (t: number, frameIndex: number): number | null => {
    if (pixelsPerMeter === undefined) return null
    return typeof pixelsPerMeter === 'function'
      ? pixelsPerMeter(t, frameIndex)
      : pixelsPerMeter
  }

  // 2 steps (left + right) per full stride.
  const strideFreqHz = cadenceStepsPerMin / 120
  const frameCount = Math.max(1, Math.round(durationSec * fps))
  const bilateralOffset =
    view === 'side' ? SIDE_VIEW_BILATERAL_OFFSET_PX : FRONT_VIEW_BILATERAL_OFFSET_PX
  const ankleSwayAmplitude =
    view === 'side' ? strideAmplitudePx : strideAmplitudePx * FRONT_VIEW_ANKLE_SWAY_FACTOR
  // Lean is a sagittal-plane rotation, invisible face-on — a front-view figure keeps its
  // shoulders x-aligned with its hips regardless of the requested trunkLeanDeg.
  const lean = view === 'side' ? trunkLeanDeg : 0

  const frames: RobustPoseFrame[] = []

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps

    const hipMidX = HIP_BASE_X + TRAVEL_SPEED_PX_PER_SEC * t
    const hipMidY =
      HIP_BASE_Y + (verticalBouncePx / 2) * Math.sin(2 * Math.PI * (2 * strideFreqHz) * t)

    const { dx, dy } = torsoOffset(lean)
    const shoulderMidX = hipMidX + dx
    const shoulderMidY = hipMidY + dy

    const leftHipX = hipMidX - bilateralOffset / 2
    const rightHipX = hipMidX + bilateralOffset / 2
    const leftShoulderX = shoulderMidX - bilateralOffset / 2
    const rightShoulderX = shoulderMidX + bilateralOffset / 2

    const leftPhase = 2 * Math.PI * strideFreqHz * t
    const rightPhase = leftPhase + Math.PI

    const leftAnkleX = leftHipX + ankleSwayAmplitude * Math.sin(leftPhase)
    const rightAnkleX = rightHipX + ankleSwayAmplitude * Math.sin(rightPhase)
    // Monotone in sin(phase): maximal (ground contact) exactly when sin(phase) = 1, i.e. at the
    // same instant the ankle is at its peak forward sway — see the module doc comment.
    const groundY = HIP_BASE_Y + TORSO_LENGTH_PX
    const leftAnkleY = groundY - (ANKLE_LIFT_PX * (1 - Math.sin(leftPhase))) / 2
    const rightAnkleY = groundY - (ANKLE_LIFT_PX * (1 - Math.sin(rightPhase))) / 2

    const leftKneeX = (leftHipX + leftAnkleX) / 2
    const leftKneeY = (hipMidY + leftAnkleY) / 2
    const rightKneeX = (rightHipX + rightAnkleX) / 2
    const rightKneeY = (hipMidY + rightAnkleY) / 2

    // Rigid offset above the shoulder midpoint's own bounce-free baseline (HIP_BASE_Y + dy, dy
    // constant across frames), not above the moving shoulderMidY — see the module doc for why.
    const headBaseY = HIP_BASE_Y + dy - HEAD_ABOVE_SHOULDER_PX
    const headBounceAmplitude = (verticalBouncePx * headBounceDamping) / 2
    const headMidX = shoulderMidX
    const headMidY =
      headBaseY + headBounceAmplitude * Math.sin(2 * Math.PI * (2 * strideFreqHz) * t)
    const earSpread = view === 'side' ? SIDE_VIEW_EAR_SPREAD_PX : FRONT_VIEW_EAR_SPREAD_PX
    const leftEarX = headMidX - earSpread / 2
    const rightEarX = headMidX + earSpread / 2

    const keypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
      switch (name) {
        case 'left_shoulder':
          return detectedKeypoint(name, leftShoulderX, shoulderMidY)
        case 'right_shoulder':
          return detectedKeypoint(name, rightShoulderX, shoulderMidY)
        case 'left_hip':
          return detectedKeypoint(name, leftHipX, hipMidY)
        case 'right_hip':
          return detectedKeypoint(name, rightHipX, hipMidY)
        case 'left_knee':
          return detectedKeypoint(name, leftKneeX, leftKneeY)
        case 'right_knee':
          return detectedKeypoint(name, rightKneeX, rightKneeY)
        case 'left_ankle':
          return detectedKeypoint(name, leftAnkleX, leftAnkleY)
        case 'right_ankle':
          return detectedKeypoint(name, rightAnkleX, rightAnkleY)
        case 'left_elbow':
          return detectedKeypoint(name, leftShoulderX, shoulderMidY + 40)
        case 'right_elbow':
          return detectedKeypoint(name, rightShoulderX, shoulderMidY + 40)
        case 'left_wrist':
          return detectedKeypoint(name, leftShoulderX, shoulderMidY + 80)
        case 'right_wrist':
          return detectedKeypoint(name, rightShoulderX, shoulderMidY + 80)
        case 'nose':
          return detectedKeypoint(name, headMidX, headMidY)
        case 'left_ear':
          return detectedKeypoint(name, leftEarX, headMidY)
        case 'right_ear':
          return detectedKeypoint(name, rightEarX, headMidY)
        default: {
          const exhaustiveCheck: never = name
          throw new Error(`unhandled keypoint name: ${String(exhaustiveCheck)}`)
        }
      }
    })

    frames.push({
      timestamp: t,
      keypoints,
      source: 'detected',
      pixelsPerMeter: scaleAt(t, i),
    })
  }

  return frames
}
