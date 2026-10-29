import { describe, expect, it } from 'vitest'
import type { MetricId } from '../heuristics/types'
import { makeHeuristics, makeMetric, makeVerticalOscillation } from '../results/__fixtures__/metricResult'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { measureStrideBracket, measureVerticalOscillation } from './__fixtures__/measureModel'
import { CAMERA_PRESETS, projectPoint, resolveCamera } from './camera'
import { GAIT_PHASES, GROUND_Y, MODEL_PROPORTIONS, cyclesPerSecond, pelvisHeight, poseAt } from './gaitModel'
import { flashAnchor } from './introFlash'
import {
  BEAT_DECAY_CYCLES,
  BOUNCE_INSET_BASE,
  BOUNCE_INSET_FACTOR,
  CLAMPED_LABEL_SUFFIX,
  KEY_LEG_PHASE,
  PARAM_ANNOTATION_KIND,
  RUNNER_METRIC_UNITS,
  beatEnvelope,
  bounceInset,
  formatRunnerValue,
  labelLines,
  phaseForLeg,
  planAnnotations,
  STACK_GAP_LINES,
  shownWhileStill,
  type AnnotationInput,
  type AnnotationPlan,
  type RunnerAnnotation,
} from './runnerAnnotations'
import { bindRunnerParams, runnerParamValues } from './runnerParams'
import {
  LABEL_CHAR_WIDTH_EM,
  LABEL_LINE_HEIGHT,
  RUNNER_PARAM_IDS,
  RUNNER_PX,
  effectiveSources,
  placeLabel,
  stepPlayback,
} from './runnerScene'
import type {
  BoundRunnerParams,
  CameraState,
  RunnerMetricId,
  RunnerParamId,
  RunnerParams,
  Vec3,
} from './types'

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
    expect(formatRunnerValue('footStrikePattern', 0.1)).toBe('Heel first (estimate)')
  })

  it('names the foot strike by the part that lands first, classed as the cards class it', () => {
    // The same inputs `formatGuidedValue.test.ts` classes (midfoot band 0.05, strict both sides).
    expect(formatRunnerValue('footStrikePattern', 0.02)).toBe('Midfoot first (estimate)')
    expect(formatRunnerValue('footStrikePattern', 0.05)).toBe('Midfoot first (estimate)')
    expect(formatRunnerValue('footStrikePattern', 0.2)).toBe('Heel first (estimate)')
    expect(formatRunnerValue('footStrikePattern', -0.2)).toBe('Forefoot first (estimate)')
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
    expect(strike.label.text).toBe(`Heel first (estimate)${CLAMPED_LABEL_SUFFIX}`)
    expect(strike.label.lines).toEqual(['Heel first (estimate)', 'shown approximately'])
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
      expect(only(bindAll(), id).kind).toBe(PARAM_ANNOTATION_KIND[id])
    }
    expect(PARAM_ANNOTATION_KIND.cadence).toBe('beat')
  })

  it('never annotates a neutral focus parameter, or one shown neutral by an override', () => {
    expect(annotate(bindOnly(['trunkLean']), ['cadence'])).toEqual([])
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

  describe('vertical ratio: the bounce over one stride', () => {
    // side-landscape's live reading: hip bounce 15.4% of torso over a 6.26-torso stride.
    const ratio = 0.0246
    const vr = bindAll({
      verticalOscillation: makeVerticalOscillation({ value: 0.154 }),
      verticalRatio: makeMetric('verticalRatio', { value: ratio }),
    })
    const v = runnerParamValues(vr)
    const annotation = only(vr, 'strideLength')
    const [stride, startTick, endTick, inset] = annotation.marks

    it('the stride bracket runs along the ground from the near foot’s contact, the bound stride exactly', () => {
      expect(stride[0].y).toBe(stride[1].y)
      expect(stride[0].y).toBeLessThan(GROUND_Y)
      expect(screenLength(stride[0], stride[1], SIDE)).toBeCloseTo(v.strideLength, 12)
      expect(v.strideLength).toBe(0.154 / ratio)
      expect(measureStrideBracket(v)).toBeCloseTo(v.strideLength, 12)
      // It starts under the near foot's first contact point at that foot's contact.
      const contact = poseAt(phaseForLeg('right', GAIT_PHASES.leftContact), v)
      const heel = contact[COMMON_KEYPOINT_NAMES.indexOf('right_heel')]
      const toe = contact[COMMON_KEYPOINT_NAMES.indexOf('right_foot_index')]
      expect(stride[0].x).toBe((toe.y < heel.y ? toe : heel).x)
      expect(stride[1].x).toBeGreaterThan(stride[0].x)
      // An end tick at each end, crossing the bracket.
      expect(startTick.map((p) => p.x)).toEqual([stride[0].x, stride[0].x])
      expect(endTick.map((p) => p.x)).toEqual([stride[1].x, stride[1].x])
    })

    it('the bounce inset is the bounce × its factor exactly: the measured bounce on vertical ratio’s clip', () => {
      expect(inset[0].x).toBe(inset[1].x)
      expect(Math.min(inset[0].y, inset[1].y)).toBe(BOUNCE_INSET_BASE)
      const length = screenLength(inset[0], inset[1], SIDE)
      expect(length).toBeCloseTo(0.154 * BOUNCE_INSET_FACTOR, 12)
      // The figure's own bounce (the same clip here) read with the metric's formula is the same number.
      expect(measureVerticalOscillation(v) * BOUNCE_INSET_FACTOR).toBeCloseTo(length, 9)
      expect(bounceInset(v, 'right', ratio).bounce).toBeCloseTo(0.154, 15)
      // It stands over the stride, clear of the figure.
      expect(inset[0].x).toBeGreaterThan(stride[0].x)
      expect(inset[0].x).toBeLessThan(stride[1].x)
    })

    it('in a mixed-clip session the inset is the bounce on vertical ratio’s clip, not the fused one', () => {
      const sourceIndices = Object.fromEntries(
        Object.keys(makeHeuristics()).filter((id) => id !== 'view').map((id) => [id, 0]),
      ) as Record<MetricId, number>
      const mixed = bindRunnerParams(
        makeHeuristics({ verticalRatio: makeMetric('verticalRatio', { value: ratio }) }),
        undefined,
        { sourceIndices: { ...sourceIndices, verticalOscillation: 1 }, ratioClipBounce: { value: 0.172, tier: 'normal' } },
      )
      const [mixedStride, , , mixedInset] = only(mixed, 'strideLength').marks
      expect(screenLength(mixedInset[0], mixedInset[1], SIDE)).toBeCloseTo(0.172 * BOUNCE_INSET_FACTOR, 12)
      expect(screenLength(mixedStride[0], mixedStride[1], SIDE)).toBeCloseTo(0.172 / ratio, 12)
      // The figure keeps the fused bounce (0.15): the inset is not a reading of the figure's hips.
      expect(mixed.pelvisBounce.value).toBe(0.15)
    })

    it('inset ÷ factor ÷ stride as drawn is vertical ratio, and the drawing says so', () => {
      const drawn =
        screenLength(inset[0], inset[1], SIDE) / BOUNCE_INSET_FACTOR / screenLength(stride[0], stride[1], SIDE)
      expect(drawn).toBeCloseTo(ratio, 12)
      expect(measureVerticalOscillation(v) / measureStrideBracket(v)).toBeCloseTo(ratio, 9)
      expect(annotation.clamped).toBe(false)
      expect(annotation.label.lines).toEqual([formatRunnerValue('verticalRatio', ratio), 'bounce ÷ stride'])
      expect(annotation.label.lines[0]).toBe('2.46%')
      expect(annotation.label.side).toBe('below')
      // The magnified inset names its factor; the stride is at true scale and says nothing more.
      expect(annotation.tags?.map((tag) => [tag.text, tag.side])).toEqual([
        [`hip bounce ×${BOUNCE_INSET_FACTOR}`, 'left'],
        ['stride', 'above'],
      ])
    })

    it('draws the bounce once: the bounce’s own true-scale bracket gives way to the inset', () => {
      expect(annotate(vr, ['pelvisBounce', 'strideLength']).map((a) => a.paramId)).toEqual(['strideLength'])
      expect(annotate(vr, ['pelvisBounce']).map((a) => a.paramId)).toEqual(['pelvisBounce'])
      // No mark of the stride's annotation is the true-scale bounce bracket.
      const [bounceBracket] = only(vr, 'pelvisBounce').marks
      for (const mark of annotation.marks) expect(mark).not.toEqual(bounceBracket)
    })

    it('says "shown approximately" when the stride had to be clamped', () => {
      const clamped = only(
        bindAll({
          verticalOscillation: makeVerticalOscillation({ value: 0.15 }),
          verticalRatio: makeMetric('verticalRatio', { value: 0.01 }),
        }),
        'strideLength',
      )
      expect(clamped.clamped).toBe(true)
      expect(clamped.label.lines.slice(-2)).toEqual(['bounce ÷ stride', 'shown approximately'])
    })

    it('is not drawn without a measured stride (the bounce known only in centimetres)', () => {
      const cmOnly = bindAll({ verticalOscillation: makeVerticalOscillation({ viewFit: 'unsuitable' }) })
      expect(annotate(cmOnly, ['pelvisBounce', 'strideLength']).map((a) => a.paramId)).toEqual(['pelvisBounce'])
    })
  })

  it('arm swing: the bracket spans the wrist’s travel below the shoulder', () => {
    const [span] = only(bound, 'armSwing').marks
    const range = sampleCycle(
      (p) => liveJoint(p, bound, 'right_wrist').y - liveJoint(p, bound, 'right_shoulder').y,
    )
    expect(range.max - range.min).toBeCloseTo(values.armSwing, 4)
    expect(screenLength(span[0], span[1], SIDE)).toBeCloseTo(values.armSwing, 12)
  })

  it('arm swing: the label sits above the bracket’s top end, never on the bracket, under its foot or on the near upper arm', () => {
    const camera = CAMERA_PRESETS.armsQuarter
    // Label scales as ModelRunner sizes them today, from the stage box: a 390 px phone (130 px per
    // unit) and the 1280 layout's ~401×404 stage (101). The phone SVG actually draws at ~84 px/unit,
    // so live phone labels are smaller still; strides-ikbu sizes them from the SVG.
    const SCALES = [
      { name: 'phone', pxPerUnit: 130 },
      { name: 'desktop', pxPerUnit: 101 },
    ]
    // A small swing, a front reading, a pinned side reading (above v* ≈ 0.523), the largest.
    for (const armSwing of [0.05, 0.33, 0.5627, 0.9]) {
      const arms = bindAll({ armSwingAmplitude: makeMetric('armSwingAmplitude', { value: armSwing }) })
      const { marks, label } = only(arms, 'armSwing', camera.yawDeg)
      const [[low, high]] = marks
      // The bracket's extent is the value exactly; the label hangs off its upper end.
      expect(high.y - low.y).toBeCloseTo(armSwing, 12)
      expect(label.anchor).toEqual(high)
      expect(label.side).toBe('above')
      expect(label.offsetLines).toBeUndefined()
      const top = projectPoint(high, camera)
      const foot = projectPoint(low, camera)
      expect(foot.y).toBeGreaterThan(top.y)
      for (const { name, pxPerUnit } of SCALES) {
        const unit = 1 / pxPerUnit
        const fontUnits = RUNNER_PX.label * unit
        const layout = placeLabel(top, label.side, label.lines, fontUnits, RUNNER_PX.labelGap * unit)
        // On a phone it is centred on the bracket, unclamped, up to the largest swing.
        if (name === 'phone') expect(layout.x, `${armSwing}`).toBeCloseTo(top.x, 12)
        // Every line wholly above the top tick: nothing covers the bracket or hangs toward a panel.
        const lineHalf = (fontUnits * LABEL_LINE_HEIGHT) / 2
        for (const y of layout.ys) expect(y + lineHalf, `${armSwing} ${name}`).toBeLessThan(top.y)
        // The near (camera-side, right) upper arm never runs through the label over the cycle.
        const halfWidth = (Math.max(...label.lines.map((l) => l.length)) * fontUnits * LABEL_CHAR_WIDTH_EM) / 2
        const box = {
          left: layout.x - halfWidth,
          right: layout.x + halfWidth,
          top: layout.ys[0] - lineHalf,
          bottom: layout.ys[layout.ys.length - 1] + lineHalf,
        }
        for (let i = 0; i < 120; i += 1) {
          const shoulder = projectPoint(liveJoint(i / 120, arms, 'right_shoulder'), camera)
          const elbow = projectPoint(liveJoint(i / 120, arms, 'right_elbow'), camera)
          for (let k = 0; k <= 40; k += 1) {
            const x = shoulder.x + ((elbow.x - shoulder.x) * k) / 40
            const y = shoulder.y + ((elbow.y - shoulder.y) * k) / 40
            const inBox = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
            expect(inBox, `${armSwing} ${name} phase ${i / 120}`).toBe(false)
          }
        }
      }
    }
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

  it('stacks the ground-lane labels in focus order, centred under the first, at the lane’s lowest anchor', () => {
    for (const focus of [
      ['landingOffset', 'contactShankOffset'],
      ['contactShankOffset', 'landingOffset'],
    ] as RunnerParamId[][]) {
      const annotations = annotate(bound, focus)
      const [first, second] = annotations.map((a) => a.label)
      const landingMarkY = only(bound, 'landingOffset').marks[0][0].y
      expect(first.anchor.y).toBe(landingMarkY)
      expect(second.anchor.y).toBe(landingMarkY)
      const own = only(bound, focus[0]).label.anchor.x
      expect(first.anchor.x).toBe(own)
      expect(second.anchor.x).toBe(own)
      expect(first.offsetLines).toBe(0)
      expect(second.offsetLines).toBe(first.lines.length + STACK_GAP_LINES)
      expect(STACK_GAP_LINES).toBe(0.5)
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

describe('the cadence footfall beat', () => {
  const bound = bindAll()
  const values = runnerParamValues(bound)

  it('labels the measured cadence above the head, where its intro flash goes', () => {
    const { heldPhase, annotations } = plan(bound, ['cadence'])
    expect(annotations).toHaveLength(1)
    const [beat] = annotations
    expect(beat.kind).toBe('beat')
    expect(beat.keyPhase).toBe(heldPhase)
    expect(beat.marks).toEqual([])
    expect(beat.fills).toEqual([])
    if (bound.cadence.source !== 'measured') throw new Error('cadence should be measured')
    const text = formatRunnerValue('cadence', bound.cadence.metricValue)
    expect(text).toMatch(/^\d+ steps\/min$/)
    expect(beat.label.lines).toEqual([text])
    expect(beat.label.side).toBe('above')
    expect(beat.label.anchor).toEqual(flashAnchor('cadence', values, heldPhase, 0))
    // Cadence is keyed on a footfall: the still frame holds the near foot's contact.
    expect(KEY_LEG_PHASE.cadence).toBe(GAIT_PHASES.leftContact)
    expect(heldPhase).toBe(phaseForLeg('right', GAIT_PHASES.leftContact))
    // Behind an earlier keyed focus it keeps that focus's held phase.
    expect(plan(bound, ['peakThighAngle', 'cadence']).heldPhase).toBe(
      plan(bound, ['peakThighAngle']).heldPhase,
    )
  })

  it('holds a side-view still frame with the near foot planted on the ticks', () => {
    for (const yaw of [0, 180]) {
      const camera = { ...SIDE, yawDeg: yaw }
      const { heldPhase, annotations } = plan(bound, ['cadence'], { cameraYawDeg: yaw })
      const near = yaw === 0 ? 'right' : 'left'
      const heel = liveJoint(heldPhase, bound, `${near}_heel`)
      const toe = liveJoint(heldPhase, bound, `${near}_foot_index`)
      const planted = toe.y < heel.y ? toe : heel
      expect(planted.y).toBeCloseTo(GROUND_Y, 9)
      for (const [top] of annotations[0].guides) {
        expect(projectPoint(top, camera).x).toBeCloseTo(projectPoint(planted, camera).x, 9)
        expect(top.y).toBe(GROUND_Y)
      }
    }
  })

  it('pulses once per footfall, from each foot’s contact point on the ground', () => {
    const [beat] = annotate(bound, ['cadence'])
    expect(beat.pulses?.map((p) => p.phase)).toEqual([GAIT_PHASES.leftContact, GAIT_PHASES.rightContact])
    for (const [i, side] of (['left', 'right'] as const).entries()) {
      const pulse = (beat.pulses ?? [])[i]
      const heel = liveJoint(pulse.phase, bound, `${side}_heel`)
      const toe = liveJoint(pulse.phase, bound, `${side}_foot_index`)
      const first = toe.y < heel.y ? toe : heel
      expect(pulse.centre).toEqual({ x: first.x, y: GROUND_Y, z: first.z })
      // The stance foot is pinned: the contact point is the live foot point, on the ground.
      expect(first.y).toBeCloseTo(GROUND_Y, 9)
      // Its still tick drops from the contact point below the ground.
      expect(beat.guides[i]).toEqual([pulse.centre, { ...pulse.centre, y: GROUND_Y - 0.08 }])
    }
  })

  it('beats as a ring that is full at contact and gone a quarter cycle later, every cycle', () => {
    expect(BEAT_DECAY_CYCLES).toBe(0.25)
    expect(beatEnvelope(0.5, 0.5)).toBe(1)
    expect(beatEnvelope(0.75, 0.5)).toBe(0)
    expect(beatEnvelope(0.9, 0.5)).toBe(0)
    expect(beatEnvelope(0.49, 0.5)).toBe(0)
    // Wraps: a contact at 0 is the same as one at 1.
    expect(beatEnvelope(1.1, 0)).toBeCloseTo(beatEnvelope(0.1, 0), 12)
    expect(beatEnvelope(0.05, 0.9)).toBeCloseTo(beatEnvelope(0.15, 0), 12)
    let previous = Infinity
    for (let i = 0; i <= 100; i += 1) {
      const e = beatEnvelope((i / 100) * BEAT_DECAY_CYCLES, 0)
      expect(e).toBeLessThanOrEqual(previous)
      expect(e).toBeGreaterThanOrEqual(0)
      previous = e
    }
  })

  /** Ring onsets (a strength that rises) over `seconds` of 30 fps playback. */
  function countOnsets(drawn: RunnerParams, rate: number, seconds: number): number {
    const [beat] = annotate(bound, ['cadence'], { values: drawn })
    const pulses = beat.pulses ?? []
    let state = { phase: 0.3, holdLeftMs: 0 }
    let previous = pulses.map((p) => beatEnvelope(state.phase, p.phase))
    let onsets = 0
    for (let frame = 0; frame < seconds * 30; frame += 1) {
      state = stepPlayback(state, 1000 / 30, cyclesPerSecond(drawn) * rate, null)
      const now = pulses.map((p) => beatEnvelope(state.phase, p.phase))
      onsets += now.filter((e, i) => e > previous[i]).length
      previous = now
    }
    return onsets
  }

  it('beats at the drawn cadence times the playback rate', () => {
    for (const cadence of [150, 180, 190]) {
      for (const rate of [1, 0.4]) {
        const expected = (cadence * rate * 10) / 60
        const onsets = countOnsets({ ...values, cadence }, rate, 10)
        expect(Math.abs(onsets - expected)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps the measured cadence in its label whatever the playback rate', () => {
    const slow = bindAll({ cadence: makeMetric('cadence', { value: 180 }) })
    expect(only(slow, 'cadence').label.text).toBe('180 steps/min')
  })

  it('stays well below the WCAG 2.3.1 flash-area threshold, in the focus accent', () => {
    expect(RUNNER_PX.beatRingMin).toBeLessThan(RUNNER_PX.beatRingMax)
    expect(RUNNER_PX.beatRingMax).toBeLessThanOrEqual(16)
  })
})

describe('the step-width guides meet both feet in the front view', () => {
  const bound = bindAll()
  const FEET_FRONT = resolveCamera(CAMERA_PRESETS.feetFront)

  for (const stepWidth of [0.15, 0.3, -0.2]) {
    for (const swingFootArc of [0.15, 0.6]) {
      it(`step width ${stepWidth}, swing arc ${swingFootArc}`, () => {
        const values = { ...runnerParamValues(bound), stepWidth, swingFootArc }
        const { annotations } = plan(bound, ['stepWidth'], { values, cameraYawDeg: FEET_FRONT.yawDeg })
        const [step] = annotations
        const [[start, end]] = step.marks
        expect(Math.abs(end.z - start.z)).toBeCloseTo(Math.abs(stepWidth) * MODEL_PROPORTIONS.hipWidth, 12)
        const [midline, ...ticks] = step.guides
        expect(ticks).toHaveLength(2)
        // The midline rises from hip-mid.
        const hipAtKey = (() => {
          const pose = poseAt(step.keyPhase as number, values)
          const l = pose[COMMON_KEYPOINT_NAMES.indexOf('left_hip')]
          const r = pose[COMMON_KEYPOINT_NAMES.indexOf('right_hip')]
          return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 }
        })()
        const top = projectPoint(midline[0], FEET_FRONT)
        const hip = projectPoint(hipAtKey, FEET_FRONT)
        expect(top.x).toBeCloseTo(hip.x, 9)
        expect(top.y).toBeCloseTo(hip.y, 9)
        // A plumb: both ends straight under hip-mid.
        expect(midline[0]).toEqual({ x: hipAtKey.x, y: hipAtKey.y, z: 0 })
        expect(midline[1].x).toBe(hipAtKey.x)
        for (const tick of ticks) expect(tick[0].y).toBe(GROUND_Y)
        const tickXs = ticks.map((tick) => projectPoint(tick[0], FEET_FRONT).x)
        // Every stance ankle, either foot, stands right above a tick.
        for (const side of ['left', 'right'] as const) {
          for (let i = 0; i < 50; i += 1) {
            const phase = phaseForLeg(side, i / 100)
            const ankle = poseAt(phase, values)[COMMON_KEYPOINT_NAMES.indexOf(`${side}_ankle`)]
            const x = projectPoint(ankle, FEET_FRONT).x
            expect(Math.min(...tickXs.map((t) => Math.abs(t - x)))).toBeLessThan(1e-9)
          }
        }
      })
    }
  }
})
