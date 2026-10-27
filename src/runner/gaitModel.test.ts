import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import {
  GAIT_PHASES,
  MODEL_PROPORTIONS,
  cyclesPerSecond,
  poseAt,
} from './gaitModel'
import { NEUTRAL_RUNNER_PARAMS, RUNNER_PARAM_SPECS } from './runnerParams'
import type { Joint3D, RunnerParamId, RunnerParams, Vec3 } from './types'

/*
 * "Measuring the model returns the bound value": each helper below is the named metric's own
 * formula (src/heuristics/<metric>.ts), applied to the model's joints in the projection that metric
 * is measured from — the side view reads (x, y), the front view reads (z, y). Torso length and hip
 * width are measured off the model, not assumed.
 */

const PARAM_IDS = Object.keys(RUNNER_PARAM_SPECS) as RunnerParamId[]
const DEG = 180 / Math.PI
const DENSE = Array.from({ length: 1000 }, (_, i) => i / 1000)

function withParams(overrides: Partial<Record<RunnerParamId, number>>): RunnerParams {
  return { ...NEUTRAL_RUNNER_PARAMS, ...overrides }
}

function joint(pose: Joint3D[], name: KeypointName): Joint3D {
  const found = pose.find((j) => j.name === name)
  if (found === undefined) throw new Error(`missing ${name}`)
  return found
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

function hipMid(pose: Joint3D[]): Vec3 {
  return mid(joint(pose, 'left_hip'), joint(pose, 'right_hip'))
}

function shoulderMid(pose: Joint3D[]): Vec3 {
  return mid(joint(pose, 'left_shoulder'), joint(pose, 'right_shoulder'))
}

/** `estimateBodyScale`: shoulder-mid to hip-mid, side projection. */
function torsoLength(pose: Joint3D[]): number {
  const s = shoulderMid(pose)
  const h = hipMid(pose)
  return Math.hypot(s.x - h.x, s.y - h.y)
}

function hipWidth(pose: Joint3D[]): number {
  return Math.abs(joint(pose, 'right_hip').z - joint(pose, 'left_hip').z)
}

function peakToPeak(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

/** verticalOscillation: hip-mid vertical peak-to-peak over torso length. */
function measureVerticalOscillation(params: RunnerParams): number {
  const poses = DENSE.map((p) => poseAt(p, params))
  return peakToPeak(poses.map((pose) => hipMid(pose).y)) / torsoLength(poses[0])
}

/** trunkLean: atan2(dx, up) of hip-mid→shoulder-mid, travel is +x. */
function measureTrunkLean(params: RunnerParams): number {
  const pose = poseAt(0.3, params)
  const s = shoulderMid(pose)
  const h = hipMid(pose)
  return Math.atan2(s.x - h.x, s.y - h.y) * DEG
}

/** armSwingAmplitude: mean over both arms of p2p (wrist.y − shoulder.y), over torso length. */
function measureArmSwing(params: RunnerParams): number {
  const poses = DENSE.map((p) => poseAt(p, params))
  const side = (s: 'left' | 'right') =>
    peakToPeak(poses.map((pose) => joint(pose, `${s}_wrist`).y - joint(pose, `${s}_shoulder`).y))
  return (side('left') + side('right')) / 2 / torsoLength(poses[0])
}

/** kneeDrive's per-frame signed thigh angle: atan2(dx, dy) of hip→knee, image y down. */
function thighAngle(pose: Joint3D[], s: 'left' | 'right'): number {
  const hip = joint(pose, `${s}_hip`)
  const knee = joint(pose, `${s}_knee`)
  return Math.atan2(knee.x - hip.x, -(knee.y - hip.y)) * DEG
}

/** The model has one swing peak per leg per cycle, so the median of peaks is the cycle maximum. */
function measureKneeDrive(params: RunnerParams): number {
  return Math.max(...DENSE.map((p) => thighAngle(poseAt(p, params), 'left')))
}

/** kneeFlexion's per-frame value: 180 − hip-knee-ankle interior angle, side projection. */
function kneeFlexionAt(pose: Joint3D[], s: 'left' | 'right'): number {
  const hip = joint(pose, `${s}_hip`)
  const knee = joint(pose, `${s}_knee`)
  const ankle = joint(pose, `${s}_ankle`)
  const a = { x: hip.x - knee.x, y: hip.y - knee.y }
  const b = { x: ankle.x - knee.x, y: ankle.y - knee.y }
  const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))
  return 180 - Math.acos(Math.min(1, Math.max(-1, cos))) * DEG
}

function measureKneeFlexion(params: RunnerParams): number {
  return Math.max(...DENSE.map((p) => kneeFlexionAt(poseAt(p, params), 'left')))
}

/** overstriding: (ankle.x − hipMid.x) / torso at the left foot's contact. */
function measureOverstriding(params: RunnerParams): number {
  const pose = poseAt(GAIT_PHASES.leftContact, params)
  return (joint(pose, 'left_ankle').x - hipMid(pose).x) / torsoLength(pose)
}

/** footStrikePattern: (ankle.x − same-side knee.x) / torso at contact. */
function measureFootStrike(params: RunnerParams): number {
  const pose = poseAt(GAIT_PHASES.leftContact, params)
  return (joint(pose, 'left_ankle').x - joint(pose, 'left_knee').x) / torsoLength(pose)
}

/** stepWidth: outward (ankle − hipMid) lateral offset at contact, over hip width (front view). */
function measureStepWidth(params: RunnerParams): number {
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
function measureSwingFootArc(params: RunnerParams): number {
  const samples = 2000
  const { swingArcStart, swingArcEnd } = GAIT_PHASES
  const offsets = Array.from({ length: samples }, (_, i) => {
    const pose = poseAt(swingArcStart + ((swingArcEnd - swingArcStart) * i) / samples, params)
    return (joint(pose, 'left_ankle').z - joint(pose, 'left_knee').z) / hipWidth(pose)
  })
  return percentile(offsets, 0.8) - percentile(offsets, 0.2)
}

function maxJointDistance(a: Joint3D[], b: Joint3D[]): number {
  return Math.max(
    ...a.map((j, i) => Math.hypot(j.x - b[i].x, j.y - b[i].y, j.z - b[i].z)),
  )
}

/** Every combination of each parameter's range ends. */
function rangeCorners(): RunnerParams[] {
  return PARAM_IDS.reduce<RunnerParams[]>(
    (sets, id) =>
      sets.flatMap((set) => RUNNER_PARAM_SPECS[id].range.map((end) => ({ ...set, [id]: end }))),
    [NEUTRAL_RUNNER_PARAMS],
  )
}

const CORNERS = rangeCorners()

describe('poseAt structure', () => {
  it('returns the nineteen joints in COMMON_KEYPOINT_NAMES order', () => {
    expect(poseAt(0.3, NEUTRAL_RUNNER_PARAMS).map((j) => j.name)).toEqual([
      ...COMMON_KEYPOINT_NAMES,
    ])
  })

  it('is finite at the neutral parameters and every range corner', () => {
    expect(CORNERS).toHaveLength(2 ** PARAM_IDS.length)
    for (const params of [NEUTRAL_RUNNER_PARAMS, ...CORNERS]) {
      for (const p of [0, 0.1, 0.25, 0.4, 0.55, 0.62, 0.85, 0.95]) {
        for (const j of poseAt(p, params)) {
          expect(Number.isFinite(j.x) && Number.isFinite(j.y) && Number.isFinite(j.z)).toBe(true)
        }
      }
    }
  })

  it('keeps every segment length constant over the cycle', () => {
    for (const params of [NEUTRAL_RUNNER_PARAMS, CORNERS[0], CORNERS[CORNERS.length - 1], CORNERS[317]]) {
      const lengths = (pose: Joint3D[]) =>
        SKELETON_EDGES.map(([a, b]) => {
          const ja = joint(pose, a)
          const jb = joint(pose, b)
          return Math.hypot(ja.x - jb.x, ja.y - jb.y, ja.z - jb.z)
        })
      const reference = lengths(poseAt(0, params))
      for (let i = 1; i < 48; i += 1) {
        lengths(poseAt(i / 48, params)).forEach((length, edge) =>
          expect(length).toBeCloseTo(reference[edge], 9),
        )
      }
    }
  })

  it('has the illustrative proportions it documents', () => {
    const pose = poseAt(0.3, NEUTRAL_RUNNER_PARAMS)
    expect(torsoLength(pose)).toBeCloseTo(1, 12)
    expect(hipWidth(pose)).toBeCloseTo(MODEL_PROPORTIONS.hipWidth, 12)
  })

  it('puts the neutral runner on the ground: its lowest foot point over the cycle is y ≈ 0', () => {
    const lowest = Math.min(
      ...DENSE.flatMap((p) =>
        poseAt(p, NEUTRAL_RUNNER_PARAMS)
          .filter((j) => /ankle|heel|foot_index/.test(j.name))
          .map((j) => j.y),
      ),
    )
    expect(Math.abs(lowest)).toBeLessThan(0.005)
  })
})

describe('poseAt loops seamlessly', () => {
  it('phase 0 and phase 1 are the same pose', () => {
    for (const params of [NEUTRAL_RUNNER_PARAMS, ...CORNERS.filter((_, i) => i % 37 === 0)]) {
      expect(maxJointDistance(poseAt(0, params), poseAt(1, params))).toBeLessThan(1e-9)
      expect(maxJointDistance(poseAt(1 - 1e-9, params), poseAt(0, params))).toBeLessThan(1e-6)
    }
  })

  it('wraps any phase, including negative ones', () => {
    const params = NEUTRAL_RUNNER_PARAMS
    expect(maxJointDistance(poseAt(1.25, params), poseAt(0.25, params))).toBeLessThan(1e-9)
    expect(maxJointDistance(poseAt(-0.75, params), poseAt(0.25, params))).toBeLessThan(1e-9)
    expect(maxJointDistance(poseAt(-3.1, params), poseAt(0.9, params))).toBeLessThan(1e-9)
  })

  it('is continuous: small phase steps move every joint a little', () => {
    for (const params of [NEUTRAL_RUNNER_PARAMS, CORNERS[0], CORNERS[CORNERS.length - 1]]) {
      for (let i = 0; i < 2000; i += 1) {
        expect(maxJointDistance(poseAt(i / 2000, params), poseAt((i + 1) / 2000, params)))
          .toBeLessThan(0.05)
      }
    }
  })

  it('the second half-cycle is the first mirrored: left and right swapped, z negated', () => {
    const swap = (name: KeypointName): KeypointName =>
      name.startsWith('left_')
        ? (name.replace('left_', 'right_') as KeypointName)
        : name.startsWith('right_')
          ? (name.replace('right_', 'left_') as KeypointName)
          : name
    for (const params of [NEUTRAL_RUNNER_PARAMS, CORNERS[5], CORNERS[700]]) {
      for (const p of [0, 0.13, 0.3, 0.47, 0.6, 0.81]) {
        const pose = poseAt(p, params)
        const later = poseAt(p + 0.5, params)
        for (const j of later) {
          const counterpart = joint(pose, swap(j.name))
          expect(j.x).toBeCloseTo(counterpart.x, 9)
          expect(j.y).toBeCloseTo(counterpart.y, 9)
          expect(j.z).toBeCloseTo(-counterpart.z, 9)
        }
      }
    }
  })
})

/** Joints each binding may move; every other joint must stay bit-identical. */
const ALLOWED_JOINTS: Record<RunnerParamId, RegExp | null> = {
  cadence: null,
  pelvisBounce: /.*/,
  torsoPitch: /shoulder|elbow|wrist|ear|nose/,
  armSwing: /elbow|wrist/,
  peakThighAngle: /knee|ankle|heel|foot_index/,
  peakSwingKneeBend: /ankle|heel|foot_index/,
  landingOffset: /knee|ankle|heel|foot_index/,
  contactShankOffset: /knee|ankle|heel|foot_index/,
  stepWidth: /knee|ankle|heel|foot_index/,
  swingFootArc: /ankle|heel|foot_index/,
}

interface BindingCase {
  sweep: number[]
  measure: ((params: RunnerParams) => number) | null
  tolerance: number
}

const BINDING_CASES: Record<RunnerParamId, BindingCase> = {
  cadence: { sweep: [120, 150, 170, 190, 220], measure: cyclesPerSecond, tolerance: 0 },
  pelvisBounce: { sweep: [0, 0.1, 0.2, 0.3, 0.5], measure: measureVerticalOscillation, tolerance: 1e-9 },
  torsoPitch: { sweep: [-15, 0, 10, 20, 35], measure: measureTrunkLean, tolerance: 1e-9 },
  armSwing: { sweep: [0.05, 0.2, 0.4, 0.6, 0.9], measure: measureArmSwing, tolerance: 1e-9 },
  peakThighAngle: { sweep: [25, 40, 55, 70, 85], measure: measureKneeDrive, tolerance: 1e-6 },
  peakSwingKneeBend: { sweep: [50, 75, 100, 125, 150], measure: measureKneeFlexion, tolerance: 1e-6 },
  landingOffset: { sweep: [-0.2, 0, 0.2, 0.4, 0.6], measure: measureOverstriding, tolerance: 1e-9 },
  contactShankOffset: { sweep: [-0.1, -0.05, 0, 0.05, 0.12], measure: measureFootStrike, tolerance: 1e-9 },
  stepWidth: { sweep: [-1.5, -0.5, 0, 0.5, 1.5], measure: measureStepWidth, tolerance: 1e-9 },
  swingFootArc: { sweep: [0, 0.1, 0.3, 0.5, 0.8], measure: measureSwingFootArc, tolerance: 0.005 },
}

describe('each binding moves only its own part, in the direction of its value', () => {
  for (const id of PARAM_IDS) {
    const { sweep, measure, tolerance } = BINDING_CASES[id]

    it(`${id}: measuring the model returns the bound value, rising with it`, () => {
      const realized = sweep.map((value) => {
        const params = withParams({ [id]: value })
        const measured = measure === null ? value : measure(params)
        if (id === 'cadence') expect(measured).toBe(value / 120)
        else expect(Math.abs(measured - value)).toBeLessThanOrEqual(tolerance)
        return measured
      })
      for (let i = 1; i < realized.length; i += 1) {
        expect(realized[i]).toBeGreaterThan(realized[i - 1])
      }
    })

    it(`${id}: joints outside its allowed set are bit-identical`, () => {
      const allowed = ALLOWED_JOINTS[id]
      const low = withParams({ [id]: sweep[0] })
      const high = withParams({ [id]: sweep[sweep.length - 1] })
      for (let i = 0; i < 24; i += 1) {
        const a = poseAt(i / 24, low)
        const b = poseAt(i / 24, high)
        if (id === 'pelvisBounce') {
          // Every joint, by the same vertical shift and nothing else.
          const shift = b[0].y - a[0].y
          a.forEach((j, k) => {
            expect(b[k].x).toBe(j.x)
            expect(b[k].z).toBe(j.z)
            expect(b[k].y - j.y).toBeCloseTo(shift, 12)
          })
          continue
        }
        a.forEach((j, k) => {
          if (allowed !== null && allowed.test(j.name)) return
          expect(b[k]).toEqual(j)
        })
      }
    })
  }

  it('the joints a binding is allowed to move do move', () => {
    for (const id of PARAM_IDS) {
      if (id === 'cadence' || id === 'pelvisBounce') continue
      const { sweep } = BINDING_CASES[id]
      const a = DENSE.map((p) => poseAt(p, withParams({ [id]: sweep[0] })))
      const b = DENSE.map((p) => poseAt(p, withParams({ [id]: sweep[sweep.length - 1] })))
      const moved = new Set<string>()
      a.forEach((pose, i) =>
        pose.forEach((j, k) => {
          if (Math.hypot(j.x - b[i][k].x, j.y - b[i][k].y, j.z - b[i][k].z) > 1e-6) {
            moved.add(j.name.replace(/^(left|right)_/, ''))
          }
        }),
      )
      expect(moved.size, id).toBeGreaterThan(0)
    }
  })

  it('cadence sets the cycle rate and no geometry', () => {
    expect(cyclesPerSecond(withParams({ cadence: 180 }))).toBe(1.5)
    expect(poseAt(0.37, withParams({ cadence: 120 }))).toEqual(
      poseAt(0.37, withParams({ cadence: 220 })),
    )
  })

  it('reproduces every always-exact binding at every range corner', () => {
    for (const params of CORNERS.filter((_, i) => i % 9 === 0)) {
      expect(measureVerticalOscillation(params)).toBeCloseTo(params.pelvisBounce, 9)
      expect(measureTrunkLean(params)).toBeCloseTo(params.torsoPitch, 9)
      expect(measureArmSwing(params)).toBeCloseTo(params.armSwing, 9)
      expect(measureKneeFlexion(params)).toBeCloseTo(params.peakSwingKneeBend, 6)
      expect(measureOverstriding(params)).toBeCloseTo(params.landingOffset, 9)
      expect(measureStepWidth(params)).toBeCloseTo(params.stepWidth, 9)
      expect(Math.abs(measureSwingFootArc(params) - params.swingFootArc)).toBeLessThan(0.005)
    }
  })

  it('keeps the swing-foot arc exact whatever the step width', () => {
    for (const stepWidth of [-1.5, 0.05, 1.5]) {
      for (const swingFootArc of [0.1, 0.6]) {
        const measured = measureSwingFootArc(withParams({ stepWidth, swingFootArc }))
        expect(Math.abs(measured - swingFootArc)).toBeLessThan(0.005)
      }
    }
  })
})

describe('documented conflicts', () => {
  it('contact conflict (shank offset over half the landing offset): landing exact, foot strike gives way', () => {
    // 0.3 ahead of the hip AND 0.3 ahead of the knee would need the knee bent backwards.
    const params = withParams({ landingOffset: 0.3, contactShankOffset: 0.3 })
    expect(measureOverstriding(params)).toBeCloseTo(0.3, 9)
    const strike = measureFootStrike(params)
    expect(strike).toBeLessThan(0.3)
    expect(strike).toBeGreaterThan(0)
    // The contact knee is held straight rather than hyperextended (acos loses precision near 0°).
    expect(kneeFlexionAt(poseAt(0, params), 'left')).toBeCloseTo(0, 4)
  })

  it('contact conflict the other way (knee would bend past 45°): landing exact, knee held at 45°', () => {
    const params = withParams({ landingOffset: 0.6, contactShankOffset: -0.3 })
    expect(measureOverstriding(params)).toBeCloseTo(0.6, 9)
    expect(kneeFlexionAt(poseAt(0, params), 'left')).toBeCloseTo(45, 6)
  })

  it('a peak thigh angle below the contact thigh angle reads as the contact angle', () => {
    const params = withParams({ peakThighAngle: 10, landingOffset: 0.6 })
    expect(measureKneeDrive(params)).toBeGreaterThan(10)
    expect(measureKneeDrive(params)).toBeCloseTo(thighAngle(poseAt(0, params), 'left'), 9)
  })
})
