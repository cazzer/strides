import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import {
  CONTACT_PARAMS,
  GAIT_PHASES,
  MODEL_PROPORTIONS,
  PELVIS_HEIGHT,
  cyclesPerSecond,
  pelvisHeight,
  poseAt,
  realizeParams,
} from './gaitModel'
import {
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
} from './__fixtures__/measureModel'
import { KEY_LEG_PHASE, phaseForLeg } from './runnerAnnotations'
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

})

/** The lowest point (ankle, heel or toe) of the left foot at cycle phase `phase`. */
function lowestLeftFoot(params: RunnerParams, phase: number): number {
  const pose = poseAt(phase, params)
  return Math.min(
    joint(pose, 'left_ankle').y,
    joint(pose, 'left_heel').y,
    joint(pose, 'left_foot_index').y,
  )
}

/** The left foot's worst distance from the ground through stance, (0, stanceEnd] at 1/1000. */
function stancePinError(params: RunnerParams): number {
  let worst = 0
  for (let i = 1; i <= GAIT_PHASES.stanceEnd * 1000; i += 1) {
    worst = Math.max(worst, Math.abs(lowestLeftFoot(params, i / 1000)))
  }
  return worst
}

/** The left foot's lowest point through swing, (stanceEnd, 1) at 1/1000: negative is underground. */
function swingClearance(params: RunnerParams): number {
  let lowest = Infinity
  for (let i = GAIT_PHASES.stanceEnd * 1000 + 1; i < 1000; i += 1) {
    lowest = Math.min(lowest, lowestLeftFoot(params, i / 1000))
  }
  return lowest
}

function grid(axes: Partial<Record<RunnerParamId, readonly number[]>>): RunnerParams[] {
  return Object.entries(axes).reduce<RunnerParams[]>(
    (sets, [id, values]) => sets.flatMap((set) => (values ?? []).map((v) => ({ ...set, [id]: v }))),
    [NEUTRAL_RUNNER_PARAMS],
  )
}

/** The parameters that shape the legs or the figure's height, at their range ends. */
const LEG_CORNERS = grid(
  Object.fromEntries(
    (
      ['pelvisBounce', 'landingOffset', 'contactShankOffset', 'peakThighAngle', 'peakSwingKneeBend', 'stepWidth'] as const
    ).map((id) => [id, RUNNER_PARAM_SPECS[id].range]),
  ),
).map((params) => realizeParams(params))

/**
 * The declared realistic domain the pin holds over (design.md D15): landing offsets up to 0.3
 * torso lengths, everything else across its realistic spread.
 */
const PIN_DOMAIN = grid({
  pelvisBounce: [0, 0.07, 0.14, 0.2, 0.3],
  landingOffset: [-0.1, 0, 0.15, 0.3],
  contactShankOffset: [-0.2, -0.05, 0.08, 0.2, 0.3],
  peakThighAngle: [15, 20, 40, 85],
  peakSwingKneeBend: [60, 100, 150],
  stepWidth: [-1, 0.3, 1.5],
}).map((params) => realizeParams(params))

/** The domain sweeps sample thousands of poses; under a loaded full-suite run they need longer. */
const DOMAIN_SWEEP_TIMEOUT_MS = 60_000

describe('the stance foot stands on the ground', () => {
  it('pins the neutral stance foot to y = 0 from contact to toe-off', () => {
    expect(Math.abs(lowestLeftFoot(NEUTRAL_RUNNER_PARAMS, 0))).toBeLessThan(1e-12)
    expect(stancePinError(NEUTRAL_RUNNER_PARAMS)).toBeLessThan(1e-9)
  })

  it('puts the contact foot exactly on the ground for every parameter set', () => {
    for (const params of [...CORNERS, ...LEG_CORNERS]) {
      expect(Math.abs(lowestLeftFoot(params, 0))).toBeLessThan(1e-12)
    }
  })

  it('pins the stance foot to within 0.01 over the declared domain and at the back-landing corners', () => {
    const backLanding = LEG_CORNERS.filter((params) => params.landingOffset < 0)
    expect(backLanding).toHaveLength(32)
    for (const params of [...PIN_DOMAIN, ...backLanding]) {
      expect(stancePinError(params), JSON.stringify(params)).toBeLessThan(0.01)
    }
  }, DOMAIN_SWEEP_TIMEOUT_MS)

  it('keeps the swing foot off the ground over the declared domain and at real overstrides', () => {
    const overstrides = grid({
      landingOffset: [0.35, 0.4, 0.512, 0.6, 0.7],
      peakSwingKneeBend: [50, 100, 150],
      stepWidth: [-1.5, 0.3, 1.5],
      pelvisBounce: RUNNER_PARAM_SPECS.pelvisBounce.range,
      contactShankOffset: RUNNER_PARAM_SPECS.contactShankOffset.range,
      peakThighAngle: RUNNER_PARAM_SPECS.peakThighAngle.range,
    }).map((params) => realizeParams(params))
    let extremeWorst = 0
    for (const params of [...PIN_DOMAIN, ...overstrides]) {
      const clearance = swingClearance(params)
      // The swing knee may not bend past the bound peak, so a 50° peak bend, or legs crossed to
      // the far end of step width, can leave too little room to carry the foot clear under the
      // lowest hips; past the demo clip's 0.512 landing the stance foot's own sink carries into
      // early swing (design.md D15). Bounded below, measured.
      if (params.peakSwingKneeBend < 60 || params.stepWidth < -1 || params.landingOffset > 0.52) {
        extremeWorst = Math.min(extremeWorst, clearance)
      } else {
        expect(clearance, JSON.stringify(params)).toBeGreaterThanOrEqual(-0.005)
      }
    }
    expect(extremeWorst).toBeGreaterThan(-0.2)
  }, DOMAIN_SWEEP_TIMEOUT_MS)

  it('lets the foot give way, by a bounded amount, where the bindings cannot keep it down', () => {
    // The 0.7 landing corners: pinning them needs a stance knee bend that would break kneeFlexion.
    const farLanding = LEG_CORNERS.filter((params) => params.landingOffset > 0.5)
    expect(farLanding).toHaveLength(32)
    for (const params of farLanding) {
      const label = JSON.stringify(params)
      expect(Math.abs(lowestLeftFoot(params, 0)), label).toBeLessThan(1e-12)
      expect(stancePinError(params), label).toBeLessThan(0.13)
      expect(swingClearance(params), label).toBeGreaterThan(-0.18)
      for (const id of PARAM_IDS) {
        const { measure, tolerance } = MEASURE_PARAM[id]
        expect(Math.abs(measure(params) - params[id]), `${id} ${label}`).toBeLessThanOrEqual(tolerance)
      }
    }
  }, DOMAIN_SWEEP_TIMEOUT_MS)

  it('every still frame the renderer holds shows a foot on the ground at the neutral parameters', () => {
    const legPhases = [GAIT_PHASES.midStance, ...Object.values(KEY_LEG_PHASE).filter((q) => q !== null)]
    for (const q of legPhases) {
      for (const side of ['left', 'right'] as const) {
        const pose = poseAt(phaseForLeg(side, q), NEUTRAL_RUNNER_PARAMS)
        const lowest = Math.min(
          ...pose.filter((j) => /ankle|heel|foot_index/.test(j.name)).map((j) => j.y),
        )
        expect(Math.abs(lowest), `${side} ${q}`).toBeLessThan(1e-9)
      }
    }
  })

  it('stands the neutral runner near the nominal framing height the camera presets aim at', () => {
    // The camera presets keep their framing (D15): the neutral hips' mid-height sits 0.058 below.
    expect(Math.abs(pelvisHeight(NEUTRAL_RUNNER_PARAMS) - PELVIS_HEIGHT)).toBeLessThan(0.06)
  })

  it('bends the neutral stance knee visibly at the mid-stance still frame', () => {
    expect(kneeFlexionAt(poseAt(GAIT_PHASES.midStance, NEUTRAL_RUNNER_PARAMS), 'left'))
      .toBeGreaterThan(20)
  })
})

/**
 * The hips drawn at 30 fps from several start phases: the largest change between frames, and the
 * spread of each step's highest drawn hip over 12 steps (aliasing of the flight peak).
 */
function hipAt30Fps(params: RunnerParams): { largestStep: number; peakSpread: number } {
  const perFrame = cyclesPerSecond(params) / 30
  let largestStep = 0
  let peakSpread = 0
  for (const start of [0, 0.007, 0.013, 0.021, 0.033]) {
    const phases = Array.from({ length: 30 * 8 }, (_, f) => start + f * perFrame)
    const hips = phases.map((p) => joint(poseAt(p, params), 'left_hip').y)
    for (let f = 1; f < hips.length; f += 1) {
      largestStep = Math.max(largestStep, Math.abs(hips[f] - hips[f - 1]))
    }
    // One step runs from one mid-stance (the lowest hips) to the next.
    const stepOf = (p: number) => Math.floor((p - GAIT_PHASES.midStance) * 2)
    const peaks = new Map<number, number>()
    phases.forEach((p, f) => peaks.set(stepOf(p), Math.max(peaks.get(stepOf(p)) ?? -Infinity, hips[f])))
    const whole = [...peaks.values()].slice(1, 13)
    peakSpread = Math.max(peakSpread, Math.max(...whole) - Math.min(...whole))
  }
  return { largestStep, peakSpread }
}

/** A sinusoidal bounce's largest change between 30 fps frames: the floor any bounce is held to. */
function sinusoidFrameStep(params: RunnerParams): number {
  return params.pelvisBounce * Math.sin(2 * Math.PI * (cyclesPerSecond(params) / 30))
}

describe('the bounce plays smoothly at 30 fps', () => {
  const CADENCES = [150, 174, 190]

  it('moves the hips no more than 1.3× a sinusoid per frame, with steady step peaks, up to the neutral bounce', () => {
    for (const pelvisBounce of [0.03, 0.07, 0.1, 0.14]) {
      for (const cadence of CADENCES) {
        const params = withParams({ pelvisBounce, cadence })
        const { largestStep, peakSpread } = hipAt30Fps(params)
        const label = `${pelvisBounce} @ ${cadence}`
        expect(largestStep, label).toBeLessThanOrEqual(1.3 * sinusoidFrameStep(params))
        expect(peakSpread, label).toBeLessThanOrEqual(0.12 * pelvisBounce)
      }
    }
  }, DOMAIN_SWEEP_TIMEOUT_MS)

  it('holds larger bounces to their measured known limit (design.md D15)', () => {
    for (const pelvisBounce of [0.17, 0.2, 0.3, 0.5]) {
      for (const cadence of CADENCES) {
        const params = withParams({ pelvisBounce, cadence })
        const { largestStep, peakSpread } = hipAt30Fps(params)
        const label = `${pelvisBounce} @ ${cadence}`
        expect(largestStep, label).toBeLessThanOrEqual(2.8 * sinusoidFrameStep(params))
        expect(peakSpread, label).toBeLessThanOrEqual(0.35 * pelvisBounce)
      }
    }
  }, DOMAIN_SWEEP_TIMEOUT_MS)
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
 * keeps its x and z bit-identical, and its height changes only by one vertical shift per phase
 * shared by the whole figure (the height that keeps the runner standing on the ground; no metric
 * reads absolute height). The parameters that do not shape the legs move nothing else at all.
 */
const MOVED_JOINTS: Record<RunnerParamId, JointFamily[]> = {
  cadence: [],
  pelvisBounce: LEG,
  torsoPitch: ['shoulder', 'elbow', 'wrist', 'ear', 'nose'],
  armSwing: ['elbow', 'wrist'],
  peakThighAngle: LEG,
  peakSwingKneeBend: FOOT,
  landingOffset: LEG,
  contactShankOffset: LEG,
  stepWidth: LEG,
  swingFootArc: FOOT,
}

/** The parameters the figure's height depends on; every other one leaves the figure bit-identical. */
const SHAPES_THE_LEGS = new Set<RunnerParamId>([
  'pelvisBounce',
  'peakThighAngle',
  'peakSwingKneeBend',
  'landingOffset',
  'contactShankOffset',
  'stepWidth',
])

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

    it(`${id}: moves exactly its own joints; every other joint moves only with the whole figure`, () => {
      const low = withParams({ [id]: sweep[0] })
      const high = withParams({ [id]: sweep[sweep.length - 1] })
      const moved = new Set<JointFamily>()
      for (let i = 0; i < 48; i += 1) {
        const a = poseAt(i / 48, low)
        const b = poseAt(i / 48, high)
        // The whole-figure vertical shift at this phase, read off a hip (no binding's own joint).
        const shift = joint(b, 'left_hip').y - joint(a, 'left_hip').y
        if (!SHAPES_THE_LEGS.has(id)) expect(shift).toBe(0)
        a.forEach((j, k) => {
          if (Math.hypot(j.x - b[k].x, j.y + shift - b[k].y, j.z - b[k].z) > 1e-6) {
            moved.add(family(j.name))
          }
          if (MOVED_JOINTS[id].includes(family(j.name))) return
          expect(b[k].x).toBe(j.x)
          expect(b[k].z).toBe(j.z)
          if (SHAPES_THE_LEGS.has(id)) expect(Math.abs(b[k].y - j.y - shift)).toBeLessThan(1e-12)
          else expect(b[k]).toEqual(j)
        })
      }
      expect([...moved].sort()).toEqual([...MOVED_JOINTS[id]].sort())
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
