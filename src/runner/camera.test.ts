import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import {
  CAMERA_FRAME_HALF_HEIGHT,
  CAMERA_PRESETS,
  LANDING_FRAME_ABOVE_HIP,
  LANDING_PHASE_WINDOW,
  LANDING_FRAME_BELOW_GROUND,
  interpolateCamera,
  landingCamera,
  projectPoint,
  projectPose,
  resolveCamera,
} from './camera'
import { GAIT_PHASES, GROUND_Y, poseAt } from './gaitModel'
import { NEUTRAL_RUNNER_PARAMS, RUNNER_PARAM_SPECS } from './runnerParams'
import { VIEW_HALF_WIDTH } from './runnerScene'
import type { CameraPreset, CameraState, RunnerParamId, RunnerParams } from './types'

const PRESETS = Object.keys(CAMERA_PRESETS) as CameraPreset[]
const origin = { x: 0, y: 0, z: 0 }
const at = (yawDeg: number, pitchDeg = 0, zoom = 1): CameraState => ({
  yawDeg,
  pitchDeg,
  zoom,
  target: origin,
})

function yawMod(yaw: number): number {
  return ((yaw % 360) + 360) % 360
}

describe('projection', () => {
  it('yaw 0 is the side view: travel goes screen-right, up goes screen-up, the right side is nearer', () => {
    expect(projectPoint({ x: 1, y: 0, z: 0 }, at(0)).x).toBeCloseTo(1, 12)
    expect(projectPoint({ x: 0, y: 1, z: 0 }, at(0)).y).toBeCloseTo(-1, 12)
    const right = projectPoint({ x: 0, y: 0, z: 1 }, at(0))
    expect(right.x).toBeCloseTo(0, 12)
    expect(right.depth).toBeGreaterThan(projectPoint({ x: 0, y: 0, z: -1 }, at(0)).depth)
  })

  it("yaw 90 is the front view: the runner's left is on screen right and travel is toward the camera", () => {
    expect(projectPoint({ x: 0, y: 0, z: -1 }, at(90)).x).toBeCloseTo(1, 12)
    const ahead = projectPoint({ x: 1, y: 0, z: 0 }, at(90))
    expect(ahead.x).toBeCloseTo(0, 12)
    expect(ahead.depth).toBeCloseTo(1, 12)
  })

  it('maps the target to the origin and scales by zoom', () => {
    const camera: CameraState = { yawDeg: 33, pitchDeg: 12, zoom: 2.5, target: { x: 1, y: 2, z: -0.5 } }
    const projected = projectPoint(camera.target, camera)
    expect(projected.x).toBeCloseTo(0, 12)
    expect(projected.y).toBeCloseTo(0, 12)
    expect(projectPoint({ x: 2, y: 2, z: -0.5 }, { ...camera, yawDeg: 0, pitchDeg: 0 }).x)
      .toBeCloseTo(2.5, 12)
  })

  it('a pitched-up camera looks down: a point nearer the camera drops on screen, height shrinks', () => {
    const camera = at(0, 30)
    expect(projectPoint({ x: 0, y: 1, z: 0 }, camera).y).toBeCloseTo(-Math.cos(Math.PI / 6), 12)
    expect(projectPoint({ x: 0, y: 0, z: 1 }, camera).y).toBeCloseTo(Math.sin(Math.PI / 6), 12)
    expect(projectPoint({ x: 0, y: 1, z: 0 }, camera).depth).toBeCloseTo(0.5, 12)
  })

  it('projectPose keeps names and order', () => {
    const pose = poseAt(0.2, NEUTRAL_RUNNER_PARAMS)
    expect(projectPose(pose, 'wholeBodySide').map((j) => j.name)).toEqual(pose.map((j) => j.name))
  })
})

describe('presets', () => {
  it('has the seven presets, each finite with a positive zoom', () => {
    expect(PRESETS.sort()).toEqual(
      [
        'feetFront',
        'footSide',
        'landingSide',
        'legsSide',
        'torsoSide',
        'upperFrontQuarter',
        'wholeBodySide',
      ],
    )
    for (const preset of PRESETS) {
      const camera = CAMERA_PRESETS[preset]
      expect(camera.zoom).toBeGreaterThan(0)
      for (const v of [camera.yawDeg, camera.pitchDeg, camera.target.x, camera.target.y, camera.target.z]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    }
    expect(CAMERA_PRESETS.wholeBodySide.yawDeg).toBe(0)
    expect(CAMERA_PRESETS.feetFront.yawDeg).toBe(90)
    expect(CAMERA_PRESETS.upperFrontQuarter.yawDeg).toBe(45)
  })

  /** The joints each preset frames, and the phases they must stay framed at. */
  const FOCUS: Record<CameraPreset, { joints: RegExp; phases: number[] }> = {
    wholeBodySide: { joints: /.*/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    upperFrontQuarter: { joints: /shoulder|elbow|wrist|hip|ear|nose/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    torsoSide: { joints: /shoulder|hip|ear|nose/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    legsSide: { joints: /hip|knee|ankle|heel|foot_index/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    footSide: { joints: /^left_(ankle|heel|foot_index)$/, phases: [GAIT_PHASES.leftContact] },
    feetFront: { joints: /^left_(ankle|heel|foot_index)$/, phases: [GAIT_PHASES.leftContact] },
    landingSide: { joints: /hip|^right_(knee|ankle|heel|foot_index)$/, phases: [0.35, 0.5, 0.6] },
  }

  function corner(end: 0 | 1): RunnerParams {
    return Object.fromEntries(
      (Object.keys(RUNNER_PARAM_SPECS) as RunnerParamId[]).map((id) => [id, RUNNER_PARAM_SPECS[id].range[end]]),
    ) as Record<RunnerParamId, number>
  }

  for (const preset of PRESETS) {
    it(`${preset} frames its focus joints within ±CAMERA_FRAME_HALF_HEIGHT`, () => {
      const { joints, phases } = FOCUS[preset]
      for (const params of [NEUTRAL_RUNNER_PARAMS]) {
        for (const phase of phases) {
          for (const j of projectPose(poseAt(phase, params), preset)) {
            if (!joints.test(j.name as KeypointName)) continue
            expect(Math.abs(j.x), `${j.name} x`).toBeLessThanOrEqual(CAMERA_FRAME_HALF_HEIGHT)
            expect(Math.abs(j.y), `${j.name} y`).toBeLessThanOrEqual(CAMERA_FRAME_HALF_HEIGHT)
          }
        }
      }
    })
  }

  it('projects finite coordinates at the range corners for every preset', () => {
    for (const params of [corner(0), corner(1)]) {
      for (const preset of PRESETS) {
        for (const j of projectPose(poseAt(0.3, params), preset)) {
          expect(Number.isFinite(j.x) && Number.isFinite(j.y) && Number.isFinite(j.depth)).toBe(true)
        }
      }
    }
  })

  it('presets and their targets are frozen', () => {
    expect(Object.isFrozen(CAMERA_PRESETS)).toBe(true)
    for (const preset of PRESETS) {
      expect(Object.isFrozen(CAMERA_PRESETS[preset])).toBe(true)
      expect(Object.isFrozen(CAMERA_PRESETS[preset].target)).toBe(true)
    }
  })

  describe('landingCamera', () => {
    const withLanding = (landingOffset: number): RunnerParams => ({ ...NEUTRAL_RUNNER_PARAMS, landingOffset })
    const index = (name: KeypointName) => COMMON_KEYPOINT_NAMES.indexOf(name)
    const withBounce = (pelvisBounce: number): RunnerParams => ({ ...NEUTRAL_RUNNER_PARAMS, pelvisBounce })
    const cases = [
      NEUTRAL_RUNNER_PARAMS,
      ...[-0.3, 0.3, 0.512, 0.7].map(withLanding),
      // The bounce's range end, and halfway: hip-mid rises well above its contact height.
      ...[RUNNER_PARAM_SPECS.pelvisBounce.range[1], RUNNER_PARAM_SPECS.pelvisBounce.range[1] / 2].map(withBounce),
    ]
    const windowPhases = Array.from(
      { length: 61 },
      (_, i) => LANDING_PHASE_WINDOW.start + (LANDING_PHASE_WINDOW.length * i) / 60,
    )
    const hipMidY = (pose: ReturnType<typeof poseAt>) =>
      (pose[index('left_hip')].y + pose[index('right_hip')].y) / 2

    it('frames hip-mid and the near leg through the landing window, at every landing offset and bounce', () => {
      for (const values of cases) {
        const camera = landingCamera(values)
        for (const phase of windowPhases) {
          for (const j of projectPose(poseAt(phase, values), camera)) {
            if (!/hip|^right_(knee|ankle|heel|foot_index)$/.test(j.name)) continue
            const where = `${j.name} at ${phase}, landing ${values.landingOffset}, bounce ${values.pelvisBounce}`
            expect(Math.abs(j.x), where).toBeLessThanOrEqual(VIEW_HALF_WIDTH)
            expect(Math.abs(j.y), where).toBeLessThanOrEqual(CAMERA_FRAME_HALF_HEIGHT)
          }
        }
      }
    })

    it('is side on and level, with the contact ankle and the hip-to-ground span in frame', () => {
      const fills: boolean[] = []
      for (const values of cases) {
        const camera = landingCamera(values)
        const pose = poseAt(GAIT_PHASES.rightContact, values)
        const ankle = projectPoint(pose[index('right_ankle')], camera)
        expect(Math.abs(ankle.x)).toBeLessThan(VIEW_HALF_WIDTH)
        expect(camera.yawDeg).toBe(0)
        expect(camera.pitchDeg).toBe(0)
        // From just above hip-mid's highest point in the window to below the ground fits the
        // frame's height, centred; it fills it unless the window's reach needs the camera further out.
        const hipY = Math.max(...windowPhases.map((phase) => hipMidY(poseAt(phase, values))))
        if (values.pelvisBounce === RUNNER_PARAM_SPECS.pelvisBounce.range[1]) {
          expect(hipY - hipMidY(pose)).toBeGreaterThan(0.1)
        }
        const top = projectPoint({ x: 0, y: hipY + LANDING_FRAME_ABOVE_HIP, z: 0 }, camera).y
        const bottom = projectPoint({ x: 0, y: GROUND_Y - LANDING_FRAME_BELOW_GROUND, z: 0 }, camera).y
        // Sampled more finely than the camera's own 31 samples: the peak can sit between them.
        expect(top).toBeGreaterThanOrEqual(-CAMERA_FRAME_HALF_HEIGHT - 1e-3)
        expect(top + bottom).toBeCloseTo(0, 2)
        expect(bottom).toBeLessThanOrEqual(CAMERA_FRAME_HALF_HEIGHT + 1e-12)
        fills.push(Math.abs(bottom - CAMERA_FRAME_HALF_HEIGHT) < 1e-12)
      }
      // The neutral figure's reach fits at the height-filling zoom.
      expect(fills[0]).toBe(true)
    })

    it('is frozen, and the preset is the neutral figure’s landing frame', () => {
      const camera = landingCamera(NEUTRAL_RUNNER_PARAMS)
      expect(Object.isFrozen(camera) && Object.isFrozen(camera.target)).toBe(true)
      expect(resolveCamera('landingSide')).toEqual(camera)
      expect(camera.zoom).toBeGreaterThan(1.5)
      expect(camera.zoom).toBeLessThan(2)
    })
  })

  it('resolveCamera accepts a preset name or a state', () => {
    expect(resolveCamera('legsSide')).toBe(CAMERA_PRESETS.legsSide)
    const state = at(12, 3, 2)
    expect(resolveCamera(state)).toBe(state)
  })
})

describe('interpolateCamera', () => {
  it('returns each end at t = 0 and t = 1, and clamps t', () => {
    const a = CAMERA_PRESETS.wholeBodySide
    const b = CAMERA_PRESETS.feetFront
    for (const [t, end] of [[0, a], [1, b], [-2, a], [3, b]] as const) {
      const camera = interpolateCamera(a, b, t)
      expect(yawMod(camera.yawDeg)).toBeCloseTo(yawMod(end.yawDeg), 9)
      expect(camera.pitchDeg).toBeCloseTo(end.pitchDeg, 9)
      expect(camera.zoom).toBeCloseTo(end.zoom, 9)
      expect(camera.target.x).toBeCloseTo(end.target.x, 9)
      expect(camera.target.y).toBeCloseTo(end.target.y, 9)
      expect(camera.target.z).toBeCloseTo(end.target.z, 9)
    }
  })

  it('takes the shorter way round: 350° to 10° passes through 0°, not 180°', () => {
    expect(yawMod(interpolateCamera(at(350), at(10), 0.5).yawDeg)).toBeCloseTo(0, 9)
    expect(yawMod(interpolateCamera(at(10), at(350), 0.25).yawDeg)).toBeCloseTo(5, 9)
  })

  it('returns yaw normalised to [0, 360)', () => {
    expect(interpolateCamera(at(350), at(10), 1).yawDeg).toBeCloseTo(10, 9)
    expect(interpolateCamera(at(10), at(350), 0.75).yawDeg).toBeCloseTo(355, 9)
    for (let i = 0; i <= 20; i += 1) {
      const { yawDeg } = interpolateCamera(at(-30), at(400), i / 20)
      expect(yawDeg).toBeGreaterThanOrEqual(0)
      expect(yawDeg).toBeLessThan(360)
    }
  })

  it('interpolates zoom geometrically: 1 to 4 is 2 at the midpoint', () => {
    expect(interpolateCamera(at(0, 0, 1), at(0, 0, 4), 0.5).zoom).toBeCloseTo(2, 12)
  })

  it('accepts preset names', () => {
    expect(interpolateCamera('torsoSide', 'legsSide', 0)).toEqual(CAMERA_PRESETS.torsoSide)
  })

  it('moves every projected joint continuously between every pair of presets', () => {
    const pose = poseAt(0.3, NEUTRAL_RUNNER_PARAMS)
    const steps = 200
    for (const from of PRESETS) {
      for (const to of PRESETS) {
        let previous = projectPose(pose, interpolateCamera(from, to, 0))
        for (let i = 1; i <= steps; i += 1) {
          const current = projectPose(pose, interpolateCamera(from, to, i / steps))
          current.forEach((j, k) => {
            expect(Math.hypot(j.x - previous[k].x, j.y - previous[k].y)).toBeLessThan(0.1)
          })
          previous = current
        }
      }
    }
  })
})
