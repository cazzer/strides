import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import {
  CAMERA_FRAME_HALF_HEIGHT,
  CAMERA_PRESETS,
  LANDING_FRAME_ABOVE_HIP,
  LANDING_PHASE_WINDOW,
  LANDING_FRAME_BELOW_GROUND,
  STRIDE_FRAME_CLEAR_BOTTOM,
  STRIDE_FRAME_PAD,
  VIEWBOX_FRAME,
  drawingFrame,
  interpolateCamera,
  keyPhaseDwellWindow,
  landingCamera,
  projectPoint,
  projectPose,
  resolveCamera,
  strideCamera,
  type DrawingFrame,
} from './camera'
import { GAIT_PHASES, GROUND_Y, poseAt } from './gaitModel'
import {
  BOUNCE_BRACKET_X,
  BOUNCE_INSET_MAX_HEIGHT,
  STRIDE_BRACKET_DEPTH,
  STRIDE_TICK_HALF,
  bounceInset,
  headTopAnchor,
  strideSpan,
} from './runnerAnnotations'
import { NEUTRAL_RUNNER_PARAMS, RUNNER_PARAM_SPECS } from './runnerParams'
import { VIEW_HALF_WIDTH, stepPlayback, strideFramePad } from './runnerScene'
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
  it('has the nine presets, each finite with a positive zoom', () => {
    expect(PRESETS.sort()).toEqual(
      [
        'armsQuarter',
        'feetFront',
        'footSide',
        'landingSide',
        'legsSide',
        'strideSide',
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
    expect(CAMERA_PRESETS.armsQuarter.yawDeg).toBe(15)
  })

  /** The joints each preset frames, and the phases they must stay framed at. */
  const FOCUS: Record<CameraPreset, { joints: RegExp; phases: number[] }> = {
    wholeBodySide: { joints: /.*/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    upperFrontQuarter: { joints: /shoulder|elbow|wrist|hip|ear|nose/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    armsQuarter: { joints: /shoulder|elbow|wrist|hip|ear|nose/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    torsoSide: { joints: /shoulder|hip|ear|nose/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    legsSide: { joints: /hip|knee|ankle|heel|foot_index/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
    footSide: { joints: /^left_(ankle|heel|foot_index)$/, phases: [GAIT_PHASES.leftContact] },
    feetFront: { joints: /^left_(ankle|heel|foot_index)$/, phases: [GAIT_PHASES.leftContact] },
    landingSide: { joints: /hip|^right_(knee|ankle|heel|foot_index)$/, phases: [0.35, 0.5, 0.6] },
    strideSide: { joints: /.*/, phases: [0, 0.2, 0.4, 0.6, 0.8] },
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

  describe('strideCamera', () => {
    const [shortest, longest] = RUNNER_PARAM_SPECS.strideLength.range
    const cases = [shortest, 3.75, 5.7, 6.3, longest].flatMap((strideLength) => [
      { ...NEUTRAL_RUNNER_PARAMS, strideLength },
      { ...NEUTRAL_RUNNER_PARAMS, strideLength, landingOffset: 0.7, pelvisBounce: 0.5, torsoPitch: 35 },
    ])

    it('frames the whole figure, the whole stride and the bounce inset, with the label pads clear, at every stride', () => {
      // The bounce the inset magnifies: each case's own, up to its drawable limit (0.5), and past
      // it (1 torso length: a capped inset).
      const framed = cases.flatMap((values) => [
        { values, ratio: values.pelvisBounce / values.strideLength },
        { values, ratio: 1 / values.strideLength },
      ])
      for (const { values, ratio } of framed) {
        const camera = strideCamera(values, ratio)
        expect(camera.yawDeg).toBe(0)
        expect(camera.pitchDeg).toBe(0)
        const { start, end } = strideSpan(values, 'right')
        const below = GROUND_Y - STRIDE_BRACKET_DEPTH
        const ends = [start, end].map((x) => projectPoint({ x, y: below, z: 0 }, camera))
        const where = `stride ${values.strideLength}, landing ${values.landingOffset}, ratio ${ratio}`
        expect(ends[1].x, where).toBeLessThanOrEqual(VIEW_HALF_WIDTH - STRIDE_FRAME_PAD.right + 1e-9)
        for (const p of ends) {
          expect(p.y, where).toBeLessThanOrEqual(CAMERA_FRAME_HALF_HEIGHT - STRIDE_FRAME_PAD.bottom + 1e-9)
        }
        // The magnified bounce inset's top stays under the label pad, at the bounce's drawable limit.
        const inset = bounceInset(values, 'right', ratio)
        const top = projectPoint({ x: inset.x, y: inset.high, z: 0 }, camera)
        expect(top.y, where).toBeGreaterThanOrEqual(-CAMERA_FRAME_HALF_HEIGHT + STRIDE_FRAME_PAD.top - 1e-9)
        expect(inset.high - inset.low, where).toBeLessThanOrEqual(BOUNCE_INSET_MAX_HEIGHT)
        // Room left of the bounce's own bracket for its label (a bounce-headlined stop draws it).
        const bounce = projectPoint({ x: BOUNCE_BRACKET_X, y: 1, z: 0 }, camera)
        expect(bounce.x, where).toBeGreaterThanOrEqual(-VIEW_HALF_WIDTH + STRIDE_FRAME_PAD.left - 1e-9)
        for (let i = 0; i < 40; i += 1) {
          for (const j of projectPose(poseAt(i / 40, values), camera)) {
            expect(Math.abs(j.x), `${j.name} ${where}`).toBeLessThanOrEqual(VIEW_HALF_WIDTH)
            expect(j.y, `${j.name} ${where}`).toBeGreaterThanOrEqual(
              -CAMERA_FRAME_HALF_HEIGHT + STRIDE_FRAME_PAD.top - 1e-3,
            )
          }
        }
      }
    })

    it('zooms out as the stride grows: one scale for the figure and its stride', () => {
      const zooms = [shortest, 4, 6, 8, longest].map(
        (strideLength) => strideCamera({ ...NEUTRAL_RUNNER_PARAMS, strideLength }).zoom,
      )
      for (let i = 1; i < zooms.length; i += 1) expect(zooms[i]).toBeLessThan(zooms[i - 1])
    })

    it('is frozen, and the preset is the neutral figure’s stride frame', () => {
      const camera = strideCamera(NEUTRAL_RUNNER_PARAMS)
      expect(Object.isFrozen(camera) && Object.isFrozen(camera.target)).toBe(true)
      expect(resolveCamera('strideSide')).toEqual(camera)
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
    // The sandbox-only 3× foot frame and the stride frame (a third of the zoom, a few torso lengths
    // ahead) are the furthest apart: their tween covers 0.109 per 1/200 step, so it gets 400.
    const farApart = (a: CameraPreset, b: CameraPreset) =>
      (a === 'footSide' && b === 'strideSide') || (a === 'strideSide' && b === 'footSide')
    for (const from of PRESETS) {
      for (const to of PRESETS) {
        const steps = farApart(from, to) ? 400 : 200
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

describe('strideCamera fills the visible frame (strides-trn2.11)', () => {
  const [shortest, longest] = RUNNER_PARAM_SPECS.strideLength.range
  // The tour's drawings measured live: 1280×800 (401 × 404 px) and 390×844 (390 × 338 px), and a
  // tall one for good measure.
  const frames: DrawingFrame[] = [
    VIEWBOX_FRAME,
    drawingFrame(401, 404),
    drawingFrame(390, 338),
    drawingFrame(300, 600),
  ]
  const cases = [shortest, 3.14, 6.28, longest].flatMap((strideLength) => [
    { ...NEUTRAL_RUNNER_PARAMS, strideLength },
    { ...NEUTRAL_RUNNER_PARAMS, strideLength, landingOffset: 0.7, pelvisBounce: 0.5, torsoPitch: 35 },
  ])

  it('reads the visible frame of a meet-fitted drawing', () => {
    expect(drawingFrame(300, 400)).toEqual(VIEWBOX_FRAME)
    expect(drawingFrame(400, 400).halfWidth).toBeCloseTo(2, 9)
    expect(drawingFrame(400, 400).halfHeight).toBeCloseTo(2, 9)
    expect(drawingFrame(300, 800).halfHeight).toBeCloseTo(4, 9)
    expect(drawingFrame(0, 400)).toEqual(VIEWBOX_FRAME)
  })

  it('keeps the figure, the stride, the inset and every label’s room inside the frame and above its clear bottom', () => {
    for (const frame of frames) {
      for (const values of cases) {
        for (const ratio of [values.pelvisBounce / values.strideLength, 1 / values.strideLength]) {
          for (const labels of [
            { headLabel: true, bounceLabel: false },
            { headLabel: false, bounceLabel: true },
          ]) {
            const pad = strideFramePad({ unitsPerPx: 1 / 100, strideLabelLines: 3, ...labels })
            const camera = strideCamera(values, ratio, {
              frame,
              pad,
              headLabel: labels.headLabel,
              bounceBracket: labels.bounceLabel,
            })
            const where = `frame ${frame.halfWidth}×${frame.halfHeight}, stride ${values.strideLength}, ratio ${ratio}`
            const bottomLimit = frame.halfHeight - 2 * frame.halfHeight * STRIDE_FRAME_CLEAR_BOTTOM
            const { start, end } = strideSpan(values, 'right')
            const below = GROUND_Y - STRIDE_BRACKET_DEPTH - STRIDE_TICK_HALF
            for (const x of [start, end]) {
              const p = projectPoint({ x, y: below, z: 0 }, camera)
              expect(p.x, where).toBeLessThanOrEqual(frame.halfWidth - pad.right + 1e-9)
              expect(p.y, where).toBeLessThanOrEqual(bottomLimit - pad.bottom + 1e-9)
            }
            const inset = bounceInset(values, 'right', ratio)
            const insetTop = projectPoint({ x: inset.x, y: inset.high, z: 0 }, camera)
            expect(insetTop.y, where).toBeGreaterThanOrEqual(-frame.halfHeight + pad.top - 1e-9)
            if (labels.bounceLabel) {
              const bracket = projectPoint({ x: BOUNCE_BRACKET_X, y: 1, z: 0 }, camera)
              expect(bracket.x, where).toBeGreaterThanOrEqual(-frame.halfWidth + pad.left - 1e-9)
            }
            for (let i = 0; i < 40; i += 1) {
              const pose = poseAt(i / 40, values)
              for (const j of projectPose(pose, camera)) {
                expect(j.x, `${j.name} ${where}`).toBeGreaterThanOrEqual(-frame.halfWidth + pad.left - 1e-3)
                expect(j.x, `${j.name} ${where}`).toBeLessThanOrEqual(frame.halfWidth - pad.right + 1e-3)
                expect(j.y, `${j.name} ${where}`).toBeGreaterThanOrEqual(-frame.halfHeight + pad.top - 1e-3)
              }
              if (labels.headLabel) {
                const head = projectPoint(headTopAnchor(pose), camera)
                expect(head.y, where).toBeGreaterThanOrEqual(-frame.halfHeight + pad.top - 1e-3)
              }
            }
          }
        }
      }
    }
  })

  it('is tight: the framed span meets the padded frame on its limiting side', () => {
    for (const frame of frames) {
      for (const values of cases) {
        const pad = strideFramePad({ unitsPerPx: 1 / 100, strideLabelLines: 2, headLabel: true, bounceLabel: false })
        const camera = strideCamera(values, 0.025, { frame, pad, headLabel: true, bounceBracket: false })
        const { end } = strideSpan(values, 'right')
        let left = Infinity
        let top = -Infinity
        for (let i = 0; i < 30; i += 1) {
          const pose = poseAt(i / 30, values)
          for (const j of pose) left = Math.min(left, j.x)
          top = Math.max(top, headTopAnchor(pose).y)
        }
        const width = (end - left) * camera.zoom + pad.left + pad.right
        const usable = 2 * frame.halfHeight * (1 - STRIDE_FRAME_CLEAR_BOTTOM)
        const height =
          (Math.max(top, bounceInset(values, 'right', 0.025).high) - (GROUND_Y - STRIDE_BRACKET_DEPTH - STRIDE_TICK_HALF)) *
            camera.zoom +
          pad.top +
          pad.bottom
        const fill = Math.max(width / (2 * frame.halfWidth), height / usable)
        expect(fill, `frame ${frame.halfWidth}, stride ${values.strideLength}`).toBeCloseTo(1, 6)
      }
    }
  })

  it('draws the figure larger in a wider frame and for a shorter stride, never tied to one stride length', () => {
    const values = { ...NEUTRAL_RUNNER_PARAMS, strideLength: 6.28 }
    const pad = strideFramePad({ unitsPerPx: 1 / 100, strideLabelLines: 2, headLabel: true, bounceLabel: false })
    const zoom = (frame: DrawingFrame, strideLength = 6.28) =>
      strideCamera({ ...values, strideLength }, 0.0246, { frame, pad, headLabel: true, bounceBracket: false }).zoom
    expect(zoom(drawingFrame(401, 404))).toBeGreaterThan(zoom(VIEWBOX_FRAME) * 1.25)
    expect(zoom(drawingFrame(390, 338))).toBeGreaterThan(zoom(VIEWBOX_FRAME) * 1.4)
    // Half the stride (one step instead of a gait cycle) frames a larger figure.
    expect(zoom(drawingFrame(401, 404), 3.14)).toBeGreaterThan(zoom(drawingFrame(401, 404)) * 1.3)
  })
})

describe('keyPhaseDwellWindow', () => {
  it('rests exactly on its phase for its time once a cycle, and otherwise plays the whole cycle', () => {
    for (const phase of [0, 0.12, 0.5, 0.62, 0.99]) {
      const window = keyPhaseDwellWindow(phase, 500)
      let state = { phase: phase + 0.3 - Math.floor(phase + 0.3), holdLeftMs: 0 }
      let rested = 0
      let rests = 0
      let travelled = 0
      // Four cycles at one cycle a second, in 30 fps steps.
      for (let t = 0; t < 4000 + 4 * 500; t += 1000 / 30) {
        const next = stepPlayback(state, 1000 / 30, 1, window)
        if (next.holdLeftMs > 0 && state.holdLeftMs === 0) rests += 1
        if (next.holdLeftMs > 0) {
          rested += 1000 / 30
          expect(next.phase).toBe(phase)
        } else travelled += next.phase - state.phase - Math.floor(next.phase - state.phase)
        state = next
      }
      expect(rests, String(phase)).toBe(4)
      expect(travelled, String(phase)).toBeGreaterThan(3.5)
      expect(rested / rests, String(phase)).toBeGreaterThan(500 - 1000 / 30)
      expect(rested / rests, String(phase)).toBeLessThan(500 + 2 * (1000 / 30))
    }
  })
})
