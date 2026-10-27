import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import {
  CONTACT_PARAMS,
  MODEL_PROPORTIONS,
  cyclesPerSecond,
  poseAt,
  realizeParams,
} from './gaitModel'
import {
  DENSE_PHASES,
  MEASURE_PARAM,
  hipWidth,
  joint,
  kneeFlexionAt,
  measureArmSwing,
  measureFootStrike,
  measureKneeDrive,
  measureKneeFlexion,
  measureOverstriding,
  measureStepWidth,
  measureSwingFootArc,
  measureTrunkLean,
  measureVerticalOscillation,
  torsoLength,
} from './measureModel.testUtils'
import { NEUTRAL_RUNNER_PARAMS, RUNNER_PARAM_SPECS } from './runnerParams'
import type { Joint3D, RunnerParamId, RunnerParams } from './types'

const PARAM_IDS = Object.keys(RUNNER_PARAM_SPECS) as RunnerParamId[]

function withParams(overrides: Partial<Record<RunnerParamId, number>>): RunnerParams {
  return { ...NEUTRAL_RUNNER_PARAMS, ...overrides }
}

function maxJointDistance(a: Joint3D[], b: Joint3D[]): number {
  return Math.max(...a.map((j, i) => Math.hypot(j.x - b[i].x, j.y - b[i].y, j.z - b[i].z)))
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
      ...DENSE_PHASES.flatMap((p) =>
        poseAt(p, NEUTRAL_RUNNER_PARAMS)
          .filter((j) => /ankle|heel|foot_index/.test(j.name))
          .map((j) => j.y),
      ),
    )
    expect(Math.abs(lowest)).toBeLessThan(0.005)
  })
})

describe('poseAt loops seamlessly', () => {
  it('approaching phase 1 from below arrives at the phase-0 pose', () => {
    for (const params of [NEUTRAL_RUNNER_PARAMS, ...CORNERS.filter((_, i) => i % 37 === 0)]) {
      expect(maxJointDistance(poseAt(1 - 1e-12, params), poseAt(0, params))).toBeLessThan(1e-9)
    }
  })

  it("approaching phase 0.5 from below arrives at the phase-0.5 pose (the right leg's wrap)", () => {
    for (const params of [NEUTRAL_RUNNER_PARAMS, ...CORNERS.filter((_, i) => i % 37 === 0)]) {
      expect(maxJointDistance(poseAt(0.5 - 1e-12, params), poseAt(0.5, params))).toBeLessThan(1e-9)
    }
  })

  it('wraps any phase, including negative ones', () => {
    const params = NEUTRAL_RUNNER_PARAMS
    expect(maxJointDistance(poseAt(1, params), poseAt(0, params))).toBeLessThan(1e-12)
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

type JointFamily = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'foot_index' | 'ear' | 'nose'

function family(name: KeypointName): JointFamily {
  return name.replace(/^(left|right)_/, '') as JointFamily
}

const LEG: JointFamily[] = ['knee', 'ankle', 'heel', 'foot_index']
const FOOT: JointFamily[] = ['ankle', 'heel', 'foot_index']

/**
 * The joint families each binding moves — exactly these, no fewer and no more. Every other joint
 * stays bit-identical. `pelvisBounce` moves every joint by one vertical shift (tested separately).
 */
const MOVED_JOINTS: Record<Exclude<RunnerParamId, 'pelvisBounce'>, JointFamily[]> = {
  cadence: [],
  torsoPitch: ['shoulder', 'elbow', 'wrist', 'ear', 'nose'],
  armSwing: ['elbow', 'wrist'],
  peakThighAngle: LEG,
  peakSwingKneeBend: FOOT,
  landingOffset: LEG,
  contactShankOffset: LEG,
  stepWidth: LEG,
  swingFootArc: FOOT,
}

/**
 * Sweeps low → high with everything else neutral. Contact sweeps stay inside the conflict-free
 * region, so the raw parameters are what is drawn (asserted below via `realizeParams`).
 */
const SWEEPS: Record<RunnerParamId, number[]> = {
  cadence: [120, 150, 170, 190, 220],
  pelvisBounce: [0, 0.1, 0.2, 0.3, 0.5],
  torsoPitch: [-15, 0, 10, 20, 35],
  armSwing: [0.05, 0.2, 0.4, 0.6, 0.9],
  peakThighAngle: [25, 40, 55, 70, 85],
  peakSwingKneeBend: [50, 75, 100, 125, 150],
  landingOffset: [0.2, 0.3, 0.4, 0.5, 0.55],
  contactShankOffset: [-0.05, 0, 0.04, 0.08, 0.12],
  stepWidth: [-1.5, -0.5, 0, 0.5, 1.5],
  swingFootArc: [0, 0.1, 0.3, 0.5, 0.8],
}

describe('each binding moves only its own part, in the direction of its value', () => {
  for (const id of PARAM_IDS) {
    const sweep = SWEEPS[id]
    const { measure, tolerance } = MEASURE_PARAM[id]

    it(`${id}: measuring the model returns the bound value, rising with it`, () => {
      const realized = sweep.map((value) => {
        const params = withParams({ [id]: value })
        expect(realizeParams(params)).toEqual(params)
        const measured = measure(params)
        expect(Math.abs(measured - value)).toBeLessThanOrEqual(tolerance)
        return measured
      })
      for (let i = 1; i < realized.length; i += 1) {
        expect(realized[i]).toBeGreaterThan(realized[i - 1])
      }
    })

    it(`${id}: moves exactly its own joints; every other joint is bit-identical`, () => {
      const low = withParams({ [id]: sweep[0] })
      const high = withParams({ [id]: sweep[sweep.length - 1] })
      const moved = new Set<JointFamily>()
      for (let i = 0; i < 48; i += 1) {
        const a = poseAt(i / 48, low)
        const b = poseAt(i / 48, high)
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
          if (Math.hypot(j.x - b[k].x, j.y - b[k].y, j.z - b[k].z) > 1e-6) moved.add(family(j.name))
          if (!MOVED_JOINTS[id].includes(family(j.name))) expect(b[k]).toEqual(j)
        })
      }
      if (id !== 'pelvisBounce') expect([...moved].sort()).toEqual([...MOVED_JOINTS[id]].sort())
    })
  }

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
      expect(Math.abs(measureKneeFlexion(params) - params.peakSwingKneeBend)).toBeLessThan(0.05)
      expect(measureOverstriding(params)).toBeCloseTo(params.landingOffset, 9)
      expect(measureStepWidth(params)).toBeCloseTo(params.stepWidth, 9)
      expect(Math.abs(measureSwingFootArc(params) - params.swingFootArc)).toBeLessThan(0.005)
    }
  })

  it('keeps the knee-flexion reading exact at the largest contact knee bend', () => {
    // Reviewer cases: contact bends that used to form a second prominent knee-flexion maximum.
    for (const [landingOffset, contactShankOffset] of [[0.7, -0.3], [0.4, -0.1], [0.6, -0.3]]) {
      for (const peakSwingKneeBend of [50, 90, 150]) {
        const params = realizeParams(withParams({ landingOffset, contactShankOffset, peakSwingKneeBend }))
        expect(Math.abs(measureKneeFlexion(params) - peakSwingKneeBend)).toBeLessThan(0.05)
      }
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

/** Every subset of the three contact parameters, as the `measured` set. */
const MEASURED_SUBSETS: ReadonlySet<RunnerParamId>[] = Array.from({ length: 8 }, (_, mask) =>
  new Set(CONTACT_PARAMS.filter((_, bit) => mask & (1 << bit))),
)

const CONTACT_GRID: RunnerParams[] = [-0.3, -0.1, 0, 0.05, 0.1, 0.3, 0.7].flatMap((landingOffset) =>
  [-0.3, -0.05, 0, 0.03, 0.1, 0.2, 0.4].flatMap((contactShankOffset) =>
    [10, 12, 25, 85].flatMap((peakThighAngle) =>
      [-1.5, 0.3, 1.5].map((stepWidth) =>
        withParams({ landingOffset, contactShankOffset, peakThighAngle, stepWidth }),
      ),
    ),
  ),
)

describe('realizeParams: what the model draws for the contact leg', () => {
  it('measuring the model drawn from realized parameters returns every realized value', () => {
    for (const params of CONTACT_GRID.filter((_, i) => i % 3 === 0)) {
      for (const measured of [MEASURED_SUBSETS[0], MEASURED_SUBSETS[7], MEASURED_SUBSETS[2], MEASURED_SUBSETS[4]]) {
        const drawn = realizeParams(params, measured)
        for (const id of CONTACT_PARAMS) {
          const { measure, tolerance } = MEASURE_PARAM[id]
          expect(Math.abs(measure(drawn) - drawn[id]), `${id} ${JSON.stringify(drawn)}`)
            .toBeLessThanOrEqual(tolerance)
        }
      }
    }
  })

  it('touches only the three contact parameters', () => {
    const params = withParams({ landingOffset: 0.05, contactShankOffset: 0.1, peakThighAngle: 10 })
    const drawn = realizeParams(params, MEASURED_SUBSETS[7])
    for (const id of PARAM_IDS) {
      if (!(CONTACT_PARAMS as readonly RunnerParamId[]).includes(id)) expect(drawn[id]).toBe(params[id])
    }
  })

  it('a measured parameter never gives way to a neutral one', () => {
    for (const params of CONTACT_GRID) {
      for (const measured of MEASURED_SUBSETS) {
        const drawn = realizeParams(params, measured)
        const changed = CONTACT_PARAMS.filter((id) => drawn[id] !== params[id])
        for (const id of changed) {
          if (!measured.has(id)) continue
          // It gave way, so a stronger MEASURED partner must exist (earlier in precedence order).
          const stronger = CONTACT_PARAMS.slice(0, CONTACT_PARAMS.indexOf(id)).filter((other) =>
            measured.has(other),
          )
          expect(stronger.length, `${id} gave way with ${[...measured]}`).toBeGreaterThan(0)
        }
        // A lone measured parameter is always drawn exactly.
        if (measured.size === 1) {
          const [only] = [...measured]
          expect(drawn[only]).toBe(params[only])
        }
      }
    }
  })

  it('both offsets measured and in conflict: landing exact, foot strike gives way', () => {
    // Reviewer cases on realistic numbers.
    for (const [landingOffset, contactShankOffset, expectedStrike] of [
      [0.05, 0.1, 0.025],
      [0.1, 0.06, 0.05],
      [-0.1, 0, -0.05],
    ]) {
      const params = withParams({ landingOffset, contactShankOffset })
      const drawn = realizeParams(params, new Set(['landingOffset', 'contactShankOffset']))
      expect(drawn.landingOffset).toBe(landingOffset)
      expect(drawn.contactShankOffset).not.toBe(contactShankOffset)
      expect(drawn.contactShankOffset).toBeCloseTo(expectedStrike, 2)
      expect(measureOverstriding(drawn)).toBeCloseTo(landingOffset, 9)
      expect(measureFootStrike(drawn)).toBeCloseTo(drawn.contactShankOffset, 9)
      // The contact knee is held straight rather than hyperextended (acos loses precision near 0°).
      expect(kneeFlexionAt(poseAt(0, drawn), 'left')).toBeCloseTo(0, 4)
    }
  })

  it('a measured foot strike beats a neutral landing offset', () => {
    const params = withParams({ contactShankOffset: 0.2 })
    const drawn = realizeParams(params, new Set(['contactShankOffset']))
    expect(drawn.contactShankOffset).toBe(0.2)
    expect(measureFootStrike(drawn)).toBeCloseTo(0.2, 9)
    expect(drawn.landingOffset).not.toBe(NEUTRAL_RUNNER_PARAMS.landingOffset)
    expect(measureOverstriding(drawn)).toBeCloseTo(drawn.landingOffset, 9)
  })

  it('a measured thigh peak beats the neutral contact leg; a measured landing beats a measured thigh peak', () => {
    const peakOnly = realizeParams(withParams({ peakThighAngle: 12 }), new Set(['peakThighAngle']))
    expect(peakOnly.peakThighAngle).toBe(12)
    expect(Math.abs(measureKneeDrive(peakOnly) - 12)).toBeLessThan(0.05)
    expect(peakOnly.landingOffset).toBe(NEUTRAL_RUNNER_PARAMS.landingOffset)

    const both = realizeParams(
      withParams({ peakThighAngle: 10, landingOffset: 0.6 }),
      new Set(['peakThighAngle', 'landingOffset']),
    )
    expect(both.landingOffset).toBe(0.6)
    expect(both.peakThighAngle).toBeGreaterThan(10)
    expect(Math.abs(measureKneeDrive(both) - both.peakThighAngle)).toBeLessThan(0.05)
  })

  it('poseAt clamps the contact knee bend to [0°, 30°] for conflicting raw parameters', () => {
    expect(kneeFlexionAt(poseAt(0, withParams({ landingOffset: 0.6, contactShankOffset: -0.3 })), 'left'))
      .toBeCloseTo(30, 6)
    expect(measureOverstriding(withParams({ landingOffset: 0.6, contactShankOffset: -0.3 })))
      .toBeCloseTo(0.6, 9)
  })

  it('is continuous in each of its inputs across the conflict boundaries', () => {
    const bases = [
      withParams({ landingOffset: 0.05, contactShankOffset: 0.1, peakThighAngle: 10 }),
      withParams({ landingOffset: 0.3, contactShankOffset: -0.3, peakThighAngle: 20 }),
      withParams({ landingOffset: -0.1, contactShankOffset: 0.4, peakThighAngle: 40 }),
    ]
    for (const measured of MEASURED_SUBSETS) {
      for (const id of CONTACT_PARAMS) {
        const [lo, hi] = RUNNER_PARAM_SPECS[id].range
        for (const base of bases) {
          let previous: Joint3D[] | null = null
          for (let i = 0; i <= 400; i += 1) {
            const drawn = realizeParams({ ...base, [id]: lo + ((hi - lo) * i) / 400 }, measured)
            const pose = poseAt(0, drawn)
            if (previous !== null) expect(maxJointDistance(pose, previous)).toBeLessThan(0.02)
            previous = pose
          }
        }
      }
    }
  })
})

describe('tweening between neutral and bound values', () => {
  it('stays finite and continuous for every convex mix of two parameter sets', () => {
    const from = NEUTRAL_RUNNER_PARAMS
    const to = realizeParams(CORNERS[CORNERS.length - 1], new Set(CONTACT_PARAMS))
    const mix = (t: number): RunnerParams =>
      Object.fromEntries(PARAM_IDS.map((id) => [id, from[id] + (to[id] - from[id]) * t])) as Record<
        RunnerParamId,
        number
      >
    for (const phase of [0, 0.3, 0.62, 0.85]) {
      let previous: Joint3D[] | null = null
      for (let i = 0; i <= 400; i += 1) {
        const pose = poseAt(phase, mix(i / 400))
        for (const j of pose) {
          expect(Number.isFinite(j.x) && Number.isFinite(j.y) && Number.isFinite(j.z)).toBe(true)
        }
        if (previous !== null) expect(maxJointDistance(pose, previous)).toBeLessThan(0.02)
        previous = pose
      }
    }
  })
})
