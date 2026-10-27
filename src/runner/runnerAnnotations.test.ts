import { describe, expect, it } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { projectPoint } from './camera'
import { GAIT_PHASES, GROUND_Y, MODEL_PROPORTIONS, pelvisHeight, poseAt } from './gaitModel'
import {
  CLAMPED_LABEL_SUFFIX,
  KEY_LEG_PHASE,
  PARAM_ANNOTATION_KIND,
  RUNNER_METRIC_UNITS,
  formatRunnerValue,
  labelLines,
  phaseForLeg,
  planAnnotations,
  shownWhileStill,
  type AnnotationInput,
  type AnnotationPlan,
  type RunnerAnnotation,
} from './runnerAnnotations'
import { runnerParamValues } from './runnerParams'
import { RUNNER_PARAM_IDS, effectiveSources } from './runnerScene'
import type { BoundRunnerParams, CameraState, RunnerMetricId, RunnerParamId, Vec3 } from './types'

const SIDE: CameraState = { yawDeg: 0, pitchDeg: 0, zoom: 1.7, target: { x: 0.1, y: 1, z: 0 } }
const FRONT: CameraState = { yawDeg: 90, pitchDeg: 0, zoom: 2.4, target: { x: 0, y: 0.3, z: 0 } }

function plan(
  bound: BoundRunnerParams,
  focusParams: readonly RunnerParamId[],
  extra: Partial<AnnotationInput> = {},
): AnnotationPlan {
  const values = extra.values ?? runnerParamValues(bound)
  return planAnnotations({
    bound,
    values,
    sources: effectiveSources(bound),
    focusParams,
    cameraYawDeg: 0,
    ...extra,
  })
}

function annotate(
  bound: BoundRunnerParams,
  focusParams: readonly RunnerParamId[],
  extra: Partial<AnnotationInput> = {},
): RunnerAnnotation[] {
  return plan(bound, focusParams, extra).annotations
}

function only(bound: BoundRunnerParams, paramId: RunnerParamId, yaw = 0): RunnerAnnotation {
  const [annotation, ...rest] = annotate(bound, [paramId], { cameraYawDeg: yaw })
  expect(rest).toEqual([])
  expect(annotation.paramId).toBe(paramId)
  return annotation
}

function screenLength(a: Vec3, b: Vec3, camera: CameraState): number {
  const p = projectPoint(a, camera)
  const q = projectPoint(b, camera)
  return Math.hypot(q.x - p.x, q.y - p.y) / camera.zoom
}

/** Screen angle at `centre` from point a to point b, degrees in [0, 180]. */
function screenAngle(centre: Vec3, a: Vec3, b: Vec3, camera: CameraState): number {
  const c = projectPoint(centre, camera)
  const p = projectPoint(a, camera)
  const q = projectPoint(b, camera)
  const angle = Math.atan2(q.y - c.y, q.x - c.x) - Math.atan2(p.y - c.y, p.x - c.x)
  return Math.abs((((angle * 180) / Math.PI + 540) % 360) - 180)
}

function liveJoint(phase: number, bound: BoundRunnerParams, name: KeypointName): Vec3 {
  return poseAt(phase, runnerParamValues(bound))[COMMON_KEYPOINT_NAMES.indexOf(name)]
}

function hipMid(phase: number, bound: BoundRunnerParams): Vec3 {
  const l = liveJoint(phase, bound, 'left_hip')
  const r = liveJoint(phase, bound, 'right_hip')
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 }
}

function sampleCycle(fn: (phase: number) => number, samples = 2000): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < samples; i += 1) {
    const v = fn(i / samples)
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  return { min, max }
}

describe('units and labels', () => {
  it('states each binding metric’s unit as its producing module does', () => {
    for (const id of Object.keys(RUNNER_METRIC_UNITS) as RunnerMetricId[]) {
      expect(RUNNER_METRIC_UNITS[id]).toBe(makeMetric(id).unit)
    }
  })

  it('formats a value the way the guided card does', () => {
    expect(formatRunnerValue('trunkLean', 5)).toBe('5.0°')
    expect(formatRunnerValue('cadence', 179.6)).toBe('180 steps/min')
    expect(formatRunnerValue('verticalOscillationCm', 7.5)).toBe('7.5 cm')
    expect(formatRunnerValue('stepWidth', 0.05)).toBe('5.0%')
    expect(formatRunnerValue('overstriding', 0.08)).toBe('8.0% of torso length')
    expect(formatRunnerValue('footStrikePattern', 0.1)).toBe('Heel strike (proxy)')
  })

  it('labels the metric’s own value, never the drawn one', () => {
    const bound = bindAll({ trunkLean: makeMetric('trunkLean', { value: 40 }) })
    expect(bound.torsoPitch).toMatchObject({ value: 35, metricValue: 40, clamped: true })
    const annotation = only(bound, 'torsoPitch')
    expect(annotation.label.text).toBe(`40.0°${CLAMPED_LABEL_SUFFIX}`)
    expect(CLAMPED_LABEL_SUFFIX).toBe(' · shown approximately')
    expect(annotation.clamped).toBe(true)
    expect(only(bindAll(), 'torsoPitch').label.text).toBe('5.0°')
  })

  it('says a foot strike that gave way to a measured landing is shown approximately', () => {
    const bound = bindAll({
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    })
    const [landing, strike] = annotate(bound, ['landingOffset', 'contactShankOffset'])
    expect(landing.label.text).toBe('5.0% of torso length')
    expect(landing.clamped).toBe(false)
    expect(strike.label.text).toBe(`Heel strike (proxy)${CLAMPED_LABEL_SUFFIX}`)
    expect(strike.label.lines).toEqual(['Heel strike (proxy)', 'shown approximately'])
    expect(landing.label.lines).toEqual(['5.0%', 'of torso length'])
    expect(strike.clamped).toBe(true)
  })

  it('breaks a long label into lines, never changing its words', () => {
    expect(labelLines('5.0°', false)).toEqual(['5.0°'])
    expect(labelLines('15.0% of torso length', false)).toEqual(['15.0%', 'of torso length'])
    expect(labelLines('15.0% of torso length', true)).toEqual([
      '15.0%',
      'of torso length',
      'shown approximately',
    ])
    expect(labelLines('7.5 cm', true)).toEqual(['7.5 cm', 'shown approximately'])
  })
})

describe('which annotations are drawn', () => {
  it('annotates each measured focus parameter with its natural kind, in focus order', () => {
    const annotations = annotate(bindAll(), ['peakThighAngle', 'pelvisBounce', 'stepWidth'])
    expect(annotations.map((a) => [a.paramId, a.kind])).toEqual([
      ['peakThighAngle', 'angleArc'],
      ['pelvisBounce', 'bracket'],
      ['stepWidth', 'offset'],
    ])
    for (const id of RUNNER_PARAM_IDS) {
      if (id === 'cadence') continue
      expect(only(bindAll(), id).kind).toBe(PARAM_ANNOTATION_KIND[id])
    }
  })

  it('never annotates cadence, a neutral focus parameter, or one shown neutral by an override', () => {
    expect(annotate(bindAll(), ['cadence'])).toEqual([])
    expect(annotate(bindOnly(['cadence']), ['torsoPitch'])).toEqual([])
    const bound = bindAll()
    expect(
      annotate(bound, ['torsoPitch'], { sources: effectiveSources(bound, { torsoPitch: 'neutral' }) }),
    ).toEqual([])
  })

  it('applies the kind filter', () => {
    const focus: RunnerParamId[] = ['torsoPitch', 'pelvisBounce', 'landingOffset']
    expect(annotate(bindAll(), focus, { kind: 'bracket' }).map((a) => a.paramId)).toEqual([
      'pelvisBounce',
    ])
    expect(annotate(bindAll(), focus, { kind: 'offset' }).map((a) => a.paramId)).toEqual([
      'landingOffset',
    ])
  })

  it('draws no limb-shaped guide: every guide is a two-point line, short unless a plumb', () => {
    for (const id of RUNNER_PARAM_IDS) {
      if (id === 'cadence') continue
      for (const yaw of [0, 90]) {
        for (const guide of only(bindAll(), id, yaw).guides) {
          expect(guide).toHaveLength(2)
          const [a, b] = guide
          const plumb = a.x === b.x && a.z === b.z
          if (!plumb) {
            expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(MODEL_PROPORTIONS.thigh)
          }
        }
      }
    }
  })
})

describe('the held phase', () => {
  it('is the held phase asked for without a keyed focus, and the keyed one with', () => {
    const contact = GAIT_PHASES.rightContact
    expect(plan(bindAll(), [], { heldPhaseWithoutKey: contact }).heldPhase).toBe(contact)
    expect(plan(bindAll(), ['torsoPitch'], { heldPhaseWithoutKey: contact }).heldPhase).toBe(contact)
    expect(
      plan(bindAll(), ['peakThighAngle'], { heldPhaseWithoutKey: contact }).heldPhase,
    ).toBe(phaseForLeg('right', GAIT_PHASES.peakThigh))
  })

  it('is mid-stance without a keyed focus', () => {
    expect(plan(bindAll(), []).heldPhase).toBe(GAIT_PHASES.midStance)
    expect(plan(bindAll(), ['torsoPitch', 'pelvisBounce', 'armSwing']).heldPhase).toBe(
      GAIT_PHASES.midStance,
    )
    expect(plan(bindOnly(['cadence']), ['peakThighAngle']).heldPhase).toBe(GAIT_PHASES.midStance)
  })

  it('is the first keyed focus parameter’s key phase on the near leg', () => {
    expect(plan(bindAll(), ['torsoPitch', 'peakThighAngle', 'landingOffset']).heldPhase).toBe(
      phaseForLeg('right', GAIT_PHASES.peakThigh),
    )
    expect(plan(bindAll(), ['landingOffset'], { cameraYawDeg: 180 }).heldPhase).toBe(
      phaseForLeg('left', GAIT_PHASES.leftContact),
    )
  })

  it('takes a front view’s held phase on the same leg a side view does', () => {
    const side = plan(bindAll(), ['stepWidth', 'swingFootArc'], { cameraYawDeg: 0 })
    const front = plan(bindAll(), ['stepWidth', 'swingFootArc'], { cameraYawDeg: 90 })
    expect(front.heldPhase).toBe(side.heldPhase)
    expect(front.heldPhase).toBe(phaseForLeg('right', GAIT_PHASES.leftContact))
    const [step, swing] = front.annotations
    expect(step.side).toBe('right')
    expect(step.keyPhase).toBe(front.heldPhase)
    // At that phase the left leg (leg phase 0.5) is nearer its mid-arc key than the right (0).
    expect(swing.side).toBe('left')
  })

  it('shows a still figure only the marks at its held phase', () => {
    const { heldPhase, annotations } = plan(bindAll(), ['peakThighAngle', 'peakSwingKneeBend', 'torsoPitch'])
    expect(annotations.map((a) => shownWhileStill(a, heldPhase))).toEqual([true, false, true])
    expect(annotations[2].keyPhase).toBeNull()
  })
})

describe('the marks are the drawn values and lie on the live figure', () => {
  const bound = bindAll()
  const values = runnerParamValues(bound)
  const heldFor = (id: RunnerParamId, yaw = 0) => plan(bound, [id], { cameraYawDeg: yaw }).heldPhase

  it('trunk lean: the arc sweeps the lean, from vertical to hip-mid→shoulder-mid', () => {
    const phase = heldFor('torsoPitch')
    const [arcPoints] = only(bound, 'torsoPitch').marks
    const hip = hipMid(phase, bound)
    const ls = liveJoint(phase, bound, 'left_shoulder')
    const rs = liveJoint(phase, bound, 'right_shoulder')
    const shoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0 }
    const end = arcPoints[arcPoints.length - 1]
    expect(screenAngle(hip, end, shoulder, SIDE)).toBeCloseTo(0, 9)
    expect(screenAngle(hip, arcPoints[0], { ...hip, y: hip.y + 1 }, SIDE)).toBeCloseTo(0, 9)
    expect(screenAngle(hip, arcPoints[0], end, SIDE)).toBeCloseTo(values.torsoPitch, 9)
  })

  it('knee drive: the arc runs from the down vertical onto the live thigh at the held phase', () => {
    const phase = heldFor('peakThighAngle')
    const [arcPoints] = only(bound, 'peakThighAngle').marks
    const hip = liveJoint(phase, bound, 'right_hip')
    const knee = liveJoint(phase, bound, 'right_knee')
    expect(screenAngle(hip, arcPoints[arcPoints.length - 1], knee, SIDE)).toBeCloseTo(0, 9)
    expect(screenAngle(hip, arcPoints[0], { ...hip, y: hip.y - 1 }, SIDE)).toBeCloseTo(0, 9)
    expect(screenAngle(hip, arcPoints[0], arcPoints[arcPoints.length - 1], SIDE)).toBeCloseTo(
      values.peakThighAngle,
      9,
    )
  })

  it('knee flexion: the arc runs from the thigh’s continuation onto the live shank', () => {
    const phase = heldFor('peakSwingKneeBend')
    const [arcPoints] = only(bound, 'peakSwingKneeBend').marks
    const hip = liveJoint(phase, bound, 'right_hip')
    const knee = liveJoint(phase, bound, 'right_knee')
    const ankle = liveJoint(phase, bound, 'right_ankle')
    const beyond = { x: 2 * knee.x - hip.x, y: 2 * knee.y - hip.y, z: knee.z }
    expect(screenAngle(knee, arcPoints[0], beyond, SIDE)).toBeCloseTo(0, 9)
    expect(screenAngle(knee, arcPoints[arcPoints.length - 1], ankle, SIDE)).toBeCloseTo(0, 9)
    expect(screenAngle(knee, beyond, ankle, SIDE)).toBeCloseTo(values.peakSwingKneeBend, 9)
  })

  it('bounce: the bracket spans hip-mid’s height range over a cycle', () => {
    const [span] = only(bound, 'pelvisBounce').marks
    const range = sampleCycle((p) => hipMid(p, bound).y)
    expect(Math.min(span[0].y, span[1].y)).toBeCloseTo(range.min, 6)
    expect(Math.max(span[0].y, span[1].y)).toBeCloseTo(range.max, 6)
    expect(screenLength(span[0], span[1], SIDE)).toBeCloseTo(values.pelvisBounce, 12)
    expect((span[0].y + span[1].y) / 2).toBe(pelvisHeight(values))
  })

  it('arm swing: the bracket spans the wrist’s travel below the shoulder', () => {
    const [span] = only(bound, 'armSwing').marks
    const range = sampleCycle(
      (p) => liveJoint(p, bound, 'right_wrist').y - liveJoint(p, bound, 'right_shoulder').y,
    )
    expect(range.max - range.min).toBeCloseTo(values.armSwing, 4)
    expect(screenLength(span[0], span[1], SIDE)).toBeCloseTo(values.armSwing, 12)
  })

  it('landing: the offset runs from hip-mid to the live contact ankle, with plumbs from both', () => {
    const phase = heldFor('landingOffset')
    const annotation = only(bound, 'landingOffset')
    const [[start, end]] = annotation.marks
    const hip = hipMid(phase, bound)
    const ankle = liveJoint(phase, bound, 'right_ankle')
    expect(start.x).toBeCloseTo(hip.x, 12)
    expect(end.x).toBeCloseTo(ankle.x, 12)
    expect(screenLength(start, end, SIDE)).toBeCloseTo(values.landingOffset, 9)
    expect(start.y).toBeLessThan(GROUND_Y)
    // The guides meet the two points the metric reads: hip-mid and the contact ankle.
    const [hipGuide, ankleGuide] = annotation.guides
    expect(hipGuide[0].x).toBeCloseTo(hip.x, 12)
    expect(hipGuide[0].y).toBeCloseTo(hip.y, 12)
    expect(hipGuide[1].x).toBeCloseTo(hip.x, 12)
    expect(hipGuide[1].y).toBeLessThan(start.y)
    expect(ankleGuide[0]).toEqual({ x: ankle.x, y: ankle.y, z: ankle.z })
    expect(ankleGuide[1].y).toBeLessThan(end.y)
  })

  it('foot strike: the offset runs at ankle height from under the live knee to the live ankle', () => {
    const phase = heldFor('contactShankOffset')
    const annotation = only(bound, 'contactShankOffset')
    const [[start, end]] = annotation.marks
    const knee = liveJoint(phase, bound, 'right_knee')
    const ankle = liveJoint(phase, bound, 'right_ankle')
    expect(start.x).toBeCloseTo(knee.x, 12)
    expect(end.x).toBeCloseTo(ankle.x, 12)
    expect(start.y).toBeCloseTo(ankle.y, 12)
    expect(end.y).toBeCloseTo(ankle.y, 12)
    expect(screenLength(start, end, SIDE)).toBeCloseTo(values.contactShankOffset, 12)
    // A plumb from the live knee down past the mark.
    const [kneeGuide] = annotation.guides
    expect(kneeGuide[0]).toEqual({ x: knee.x, y: knee.y, z: knee.z })
    expect(kneeGuide[1].x).toBe(knee.x)
    expect(kneeGuide[1].y).toBeLessThan(ankle.y)
  })

  it('foot strike: the label hangs under the heel heel-down, under the toe on a forefoot strike', () => {
    for (const [value, keypoint] of [
      [0.12, 'right_heel'],
      [-0.12, 'right_foot_index'],
    ] as const) {
      const strike = bindAll({ footStrikePattern: makeMetric('footStrikePattern', { value }) })
      const phase = plan(strike, ['contactShankOffset']).heldPhase
      const { label } = only(strike, 'contactShankOffset')
      const point = liveJoint(phase, strike, keypoint)
      expect(label.side).toBe('below')
      expect(label.anchor).toEqual({ x: point.x, y: point.y, z: point.z })
      expect(point.y).toBeCloseTo(GROUND_Y, 9)
      expect(label.offsetLines).toBeUndefined()
    }
  })

  it('stacks the ground-lane labels in focus order at the lane’s lowest anchor', () => {
    for (const focus of [
      ['landingOffset', 'contactShankOffset'],
      ['contactShankOffset', 'landingOffset'],
    ] as RunnerParamId[][]) {
      const annotations = annotate(bound, focus)
      const [first, second] = annotations.map((a) => a.label)
      const landingMarkY = only(bound, 'landingOffset').marks[0][0].y
      expect(first.anchor.y).toBe(landingMarkY)
      expect(second.anchor.y).toBe(landingMarkY)
      expect(first.offsetLines).toBe(0)
      expect(second.offsetLines).toBe(first.lines.length)
    }
    // Labels off the ground lane are left alone.
    const [lean] = annotate(bound, ['torsoPitch', 'landingOffset', 'contactShankOffset'])
    expect(lean.label.offsetLines).toBeUndefined()
  })

  it('step width: from the midline to the live contact ankle, value × hip width', () => {
    const phase = heldFor('stepWidth', 90)
    const annotation = only(bound, 'stepWidth', 90)
    const [[start, end]] = annotation.marks
    expect(start.z).toBe(0)
    expect(end.z).toBeCloseTo(liveJoint(phase, bound, `${annotation.side}_ankle`).z, 12)
    expect(screenLength(start, end, FRONT)).toBeCloseTo(values.stepWidth * MODEL_PROPORTIONS.hipWidth, 9)
  })

  it('swing-foot arc: ends at the live swing ankle at mid-arc, value × hip width long', () => {
    const phase = heldFor('swingFootArc', 90)
    const annotation = only(bound, 'swingFootArc', 90)
    const [[start, end]] = annotation.marks
    expect(phase).toBe(phaseForLeg(annotation.side, KEY_LEG_PHASE.swingFootArc as number))
    const ankle = liveJoint(phase, bound, `${annotation.side}_ankle`)
    expect(end).toEqual({ x: ankle.x, y: ankle.y, z: ankle.z })
    expect(screenLength(start, end, FRONT)).toBeCloseTo(
      values.swingFootArc * MODEL_PROPORTIONS.hipWidth,
      9,
    )
  })

  it('draws a static override value, not the bound one, and labels the bound metric', () => {
    const tweened = { ...values, torsoPitch: 12 }
    const [annotation] = annotate(bound, ['torsoPitch'], { values: tweened })
    const [arcPoints] = annotation.marks
    const hip = annotation.fills[0][0]
    expect(screenAngle(hip, arcPoints[0], arcPoints[arcPoints.length - 1], SIDE)).toBeCloseTo(12, 9)
    expect(annotation.label.text).toBe('5.0°')
  })

  it('puts side-view limb marks on the near side', () => {
    expect(only(bound, 'landingOffset').marks[0][0].z).toBeGreaterThan(0)
    expect(only(bound, 'landingOffset', 180).marks[0][0].z).toBeLessThan(0)
  })
})
