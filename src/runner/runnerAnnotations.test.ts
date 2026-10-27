import { describe, expect, it } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { projectPoint } from './camera'
import { GAIT_PHASES, MODEL_PROPORTIONS, poseAt } from './gaitModel'
import {
  CLAMPED_LABEL_SUFFIX,
  PARAM_ANNOTATION_KIND,
  RUNNER_METRIC_UNITS,
  buildAnnotations,
  formatRunnerValue,
  labelLines,
  type AnnotationInput,
  type RunnerAnnotation,
} from './runnerAnnotations'
import { runnerParamValues } from './runnerParams'
import { RUNNER_PARAM_IDS, effectiveSources } from './runnerScene'
import type { BoundRunnerParams, CameraState, RunnerMetricId, RunnerParamId, Vec3 } from './types'

const SIDE: CameraState = { yawDeg: 0, pitchDeg: 0, zoom: 1.7, target: { x: 0.1, y: 1, z: 0 } }
const FRONT: CameraState = { yawDeg: 90, pitchDeg: 0, zoom: 2.4, target: { x: 0, y: 0.3, z: 0 } }

function annotate(
  bound: BoundRunnerParams,
  focusParams: readonly RunnerParamId[],
  extra: Partial<AnnotationInput> = {},
): RunnerAnnotation[] {
  return buildAnnotations({
    bound,
    values: runnerParamValues(bound),
    sources: effectiveSources(bound),
    focusParams,
    nearSide: 'right',
    ...extra,
  })
}

function only(bound: BoundRunnerParams, paramId: RunnerParamId): RunnerAnnotation {
  const [annotation, ...rest] = annotate(bound, [paramId])
  expect(rest).toEqual([])
  expect(annotation.paramId).toBe(paramId)
  return annotation
}

function projectedLength(points: readonly Vec3[], camera: CameraState): number {
  const a = projectPoint(points[0], camera)
  const b = projectPoint(points[points.length - 1], camera)
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Screen angle at `centre` from ray a to ray b, degrees. */
function screenAngle(centre: Vec3, a: Vec3, b: Vec3, camera: CameraState): number {
  const c = projectPoint(centre, camera)
  const p = projectPoint(a, camera)
  const q = projectPoint(b, camera)
  const angle = Math.atan2(q.y - c.y, q.x - c.x) - Math.atan2(p.y - c.y, p.x - c.x)
  return Math.abs((((angle * 180) / Math.PI + 540) % 360) - 180)
}

function jointAt(phase: number, bound: BoundRunnerParams, name: KeypointName): Vec3 {
  return poseAt(phase, runnerParamValues(bound))[COMMON_KEYPOINT_NAMES.indexOf(name)]
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
    expect(annotation.clamped).toBe(true)
    expect(only(bindAll(), 'torsoPitch').label.text).toBe('5.0°')
  })

  it('says a foot strike that gave way to a measured landing was drawn at a limit', () => {
    const bound = bindAll({
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    })
    const [landing, strike] = annotate(bound, ['landingOffset', 'contactShankOffset'])
    expect(landing.label.text).toBe('5.0% of torso length')
    expect(landing.clamped).toBe(false)
    expect(strike.label.text).toBe(`Heel strike (proxy)${CLAMPED_LABEL_SUFFIX}`)
    expect(strike.label.lines).toEqual(['Heel strike (proxy)', 'drawn at limit'])
    expect(landing.label.lines).toEqual(['5.0%', 'of torso length'])
    expect(strike.clamped).toBe(true)
  })

  it('breaks a long label into lines, never changing its words', () => {
    expect(labelLines('5.0°', false)).toEqual(['5.0°'])
    expect(labelLines('15.0% of torso length', false)).toEqual(['15.0%', 'of torso length'])
    expect(labelLines('15.0% of torso length', true)).toEqual(['15.0%', 'of torso length', 'drawn at limit'])
    expect(labelLines('7.5 cm', true)).toEqual(['7.5 cm', 'drawn at limit'])
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
      annotate(bound, ['torsoPitch'], {
        sources: effectiveSources(bound, { torsoPitch: 'neutral' }),
      }),
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
})

describe('the marks are the drawn values, exactly', () => {
  const bound = bindAll()
  const values = runnerParamValues(bound)

  it.each([
    ['pelvisBounce', values.pelvisBounce],
    ['armSwing', values.armSwing],
    ['landingOffset', values.landingOffset],
    ['contactShankOffset', values.contactShankOffset],
  ] as const)('%s spans its value in the side view', (paramId, value) => {
    const [mark] = only(bound, paramId).marks
    expect(projectedLength(mark, SIDE) / SIDE.zoom).toBeCloseTo(value, 9)
  })

  it.each([
    ['stepWidth', values.stepWidth * MODEL_PROPORTIONS.hipWidth],
    ['swingFootArc', values.swingFootArc * MODEL_PROPORTIONS.hipWidth],
  ] as const)('%s spans value × hip width in the front view', (paramId, length) => {
    const [mark] = only(bound, paramId).marks
    expect(projectedLength(mark, FRONT) / FRONT.zoom).toBeCloseTo(length, 9)
  })

  it.each(['torsoPitch', 'peakThighAngle', 'peakSwingKneeBend'] as const)(
    '%s sweeps its value between its two rays, and the arc ends on them',
    (paramId) => {
      const { guides, marks } = only(bound, paramId)
      const reference = guides[0]
      const valueRay = guides[guides.length - 1]
      const centre = valueRay[0]
      const refEnd = reference[reference.length - 1]
      const valueEnd = valueRay[1]
      expect(screenAngle(centre, refEnd, valueEnd, SIDE)).toBeCloseTo(values[paramId], 9)
      const [arc] = marks
      expect(screenAngle(centre, refEnd, arc[0], SIDE)).toBeCloseTo(0, 9)
      expect(screenAngle(centre, valueEnd, arc[arc.length - 1], SIDE)).toBeCloseTo(0, 9)
    },
  )

  it('lays the knee-drive and knee-flexion rays along the key pose’s own segments', () => {
    const peak = GAIT_PHASES.peakThigh - 0.5
    const hip = jointAt(peak, bound, 'right_hip')
    const knee = jointAt(peak, bound, 'right_knee')
    const thighRay = only(bound, 'peakThighAngle').guides[1]
    expect(screenAngle(hip, knee, thighRay[1], SIDE)).toBeCloseTo(0, 9)

    const bend = GAIT_PHASES.peakSwingKneeBend - 0.5
    const bendKnee = jointAt(bend, bound, 'right_knee')
    const ankle = jointAt(bend, bound, 'right_ankle')
    const shankRay = only(bound, 'peakSwingKneeBend').guides[1]
    expect(screenAngle(bendKnee, ankle, shankRay[1], SIDE)).toBeCloseTo(0, 9)
  })

  it('draws a mid-tween override value, not the bound one', () => {
    const tweened = { ...values, torsoPitch: 12 }
    const [annotation] = annotate(bound, ['torsoPitch'], { values: tweened })
    const [reference, valueRay] = annotation.guides
    expect(screenAngle(valueRay[0], reference[1], valueRay[1], SIDE)).toBeCloseTo(12, 9)
    expect(annotation.label.text).toBe('5.0°')
  })

  it('puts the per-limb marks on the near side', () => {
    const right = only(bound, 'landingOffset').marks[0][0].z
    const [left] = annotate(bound, ['landingOffset'], { nearSide: 'left' })
    expect(right).toBeGreaterThan(0)
    expect(left.marks[0][0].z).toBeLessThan(0)
  })
})
