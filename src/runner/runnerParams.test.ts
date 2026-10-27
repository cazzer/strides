import { describe, expect, it } from 'vitest'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import { referenceBandEnvelope } from '../guidance/types'
import type { MetricId, MetricResult } from '../heuristics/types'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillation,
  makeVerticalOscillationCm,
} from '../results/__fixtures__/metricResult'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { MODEL_TORSO_LENGTH_CM } from './gaitModel'
import {
  NEUTRAL_RUNNER_PARAMS,
  RUNNER_PARAM_SEGMENTS,
  RUNNER_PARAM_SPECS,
  bindRunnerParams,
  paramForMetric,
  runnerParamValues,
  segmentSource,
} from './runnerParams'
import type { BoundRunnerParams, RunnerMetricId, RunnerParamId, SkeletonEdge } from './types'

const PARAM_IDS = Object.keys(RUNNER_PARAM_SPECS) as RunnerParamId[]
const ALL_METRICS = Object.keys(METRIC_GUIDANCE) as MetricId[]

const EXPECTED_BINDING: Record<RunnerParamId, RunnerMetricId> = {
  cadence: 'cadence',
  pelvisBounce: 'verticalOscillation',
  torsoPitch: 'trunkLean',
  armSwing: 'armSwingAmplitude',
  peakThighAngle: 'kneeDrive',
  peakSwingKneeBend: 'kneeFlexion',
  landingOffset: 'overstriding',
  contactShankOffset: 'footStrikePattern',
  stepWidth: 'stepWidth',
  swingFootArc: 'swingFootLateralExcursion',
}

function expectNeutral(bound: BoundRunnerParams, id: RunnerParamId): void {
  expect(bound[id]).toEqual({ source: 'neutral', value: RUNNER_PARAM_SPECS[id].neutral })
}

describe('bindRunnerParams', () => {
  it('binds every parameter to its metric when all are measured', () => {
    const heuristics = makeHeuristics()
    const bound = bindRunnerParams(heuristics)
    for (const id of PARAM_IDS) {
      const metricId = EXPECTED_BINDING[id]
      const metricValue = heuristics[metricId].value
      expect(bound[id]).toEqual({
        source: 'measured',
        value: metricValue,
        metricId,
        metricValue,
        clamped: false,
      })
    }
  })

  it('leaves a parameter neutral when its metric is null', () => {
    for (const id of PARAM_IDS) {
      if (id === 'pelvisBounce') continue
      const metricId = EXPECTED_BINDING[id]
      const bound = bindRunnerParams(
        makeHeuristics({ [metricId]: makeMetric(metricId, { value: null, confidence: 0 }) }),
      )
      expectNeutral(bound, id)
      for (const other of PARAM_IDS) {
        if (other !== id) expect(bound[other].source).toBe('measured')
      }
    }
  })

  it("leaves a parameter neutral when its metric's view fit is unsuitable (tier 'excluded')", () => {
    for (const id of PARAM_IDS) {
      if (id === 'pelvisBounce') continue
      const metricId = EXPECTED_BINDING[id]
      const bound = bindRunnerParams(
        makeHeuristics({ [metricId]: makeMetric(metricId, { viewFit: 'unsuitable' }) }),
      )
      expectNeutral(bound, id)
    }
  })

  it('binds a caveated (low-confidence) metric: uncertain is still measured', () => {
    const bound = bindRunnerParams(
      makeHeuristics({ trunkLean: makeMetric('trunkLean', { confidence: 0.1, value: 7 }) }),
    )
    expect(bound.torsoPitch).toMatchObject({ source: 'measured', value: 7, metricId: 'trunkLean' })
  })

  it('uses the tier function it is given', () => {
    const bound = bindRunnerParams(makeHeuristics(), (metric) =>
      metric.metric === 'cadence' ? 'excluded' : 'normal',
    )
    expectNeutral(bound, 'cadence')
    expect(bound.torsoPitch.source).toBe('measured')
  })

  describe('vertical oscillation falls back to centimetres against the model torso', () => {
    it('prefers the torso ratio when both are measured', () => {
      const bound = bindRunnerParams(makeHeuristics())
      expect(bound.pelvisBounce).toMatchObject({ metricId: 'verticalOscillation', value: 0.15 })
    })

    it('uses centimetres ÷ model torso length when the ratio is null', () => {
      const bound = bindRunnerParams(
        makeHeuristics({ verticalOscillation: makeVerticalOscillation({ value: null }) }),
      )
      expect(bound.pelvisBounce).toEqual({
        source: 'measured',
        value: 7.5 / MODEL_TORSO_LENGTH_CM,
        metricId: 'verticalOscillationCm',
        metricValue: 7.5,
        clamped: false,
      })
    })

    it('uses centimetres when the ratio is excluded', () => {
      const bound = bindRunnerParams(
        makeHeuristics({
          verticalOscillation: makeVerticalOscillation({ viewFit: 'unsuitable' }),
          verticalOscillationCm: makeVerticalOscillationCm({ value: 9 }),
        }),
      )
      expect(bound.pelvisBounce).toMatchObject({ metricId: 'verticalOscillationCm', value: 9 / 50 })
    })

    it('is neutral when both are unmeasured', () => {
      const bound = bindRunnerParams(
        makeHeuristics({
          verticalOscillation: makeVerticalOscillation({ value: null }),
          verticalOscillationCm: makeVerticalOscillationCm({ value: null, calibration: null }),
        }),
      )
      expectNeutral(bound, 'pelvisBounce')
    })
  })

  it('clamps an out-of-range value to what the figure can draw, and says so', () => {
    const bound = bindRunnerParams(
      makeHeuristics({
        trunkLean: makeMetric('trunkLean', { value: 50 }),
        stepWidth: makeMetric('stepWidth', { value: -3 }),
      }),
    )
    expect(bound.torsoPitch).toEqual({
      source: 'measured',
      value: 35,
      metricId: 'trunkLean',
      metricValue: 50,
      clamped: true,
    })
    expect(bound.stepWidth).toMatchObject({ value: -1.5, metricValue: -3, clamped: true })
  })

  it('verticalRatio and stepWidthCm never change anything', () => {
    const base = bindRunnerParams(makeHeuristics())
    const changed = bindRunnerParams(
      makeHeuristics({
        verticalRatio: makeMetric('verticalRatio', { value: 0.09 }),
        stepWidthCm: makeMetric('stepWidthCm', { value: 12 }),
      }),
    )
    expect(changed).toEqual(base)
    const stepWidthNull = bindRunnerParams(
      makeHeuristics({ stepWidth: makeMetric('stepWidth', { value: null }) }),
    )
    // No stepWidthCm fallback: a measured centimetre width does not stand in for the ratio.
    expectNeutral(stepWidthNull, 'stepWidth')
  })

  it('runnerParamValues extracts the drawn values', () => {
    const bound = bindRunnerParams(
      makeHeuristics({ cadence: makeMetric('cadence', { value: null }) }),
    )
    const values = runnerParamValues(bound)
    expect(values.cadence).toBe(NEUTRAL_RUNNER_PARAMS.cadence)
    expect(values.torsoPitch).toBe(5)
    expect(Object.keys(values).sort()).toEqual([...PARAM_IDS].sort())
  })
})

describe('one metric per degree of freedom', () => {
  it('no metric is a candidate for two parameters', () => {
    const seen = new Map<string, RunnerParamId>()
    for (const id of PARAM_IDS) {
      for (const { metric } of RUNNER_PARAM_SPECS[id].metrics) {
        expect(seen.has(metric), `${metric} in ${seen.get(metric)} and ${id}`).toBe(false)
        seen.set(metric, id)
      }
    }
    expect(seen.size).toBe(11)
  })

  it('paramForMetric names the parameter each metric drives, or null', () => {
    for (const metric of ALL_METRICS) {
      const expected =
        metric === 'verticalRatio' || metric === 'stepWidthCm'
          ? null
          : metric === 'verticalOscillationCm'
            ? 'pelvisBounce'
            : (PARAM_IDS.find((id) => EXPECTED_BINDING[id] === metric) ?? 'missing')
      expect(paramForMetric(metric), metric).toBe(expected)
    }
  })

  it('there are no per-side or variability parameters', () => {
    for (const id of PARAM_IDS) {
      expect(id).not.toMatch(/left|right|side|asym|variab|spread|sd|ideal|target/i)
    }
  })
})

describe('neutral constants are illustrative, never a target', () => {
  /** Every number a band publishes as a centre: closed-zone midpoints, the envelope's, the mean. */
  function bandCentres(metric: MetricId): number[] {
    const band = METRIC_GUIDANCE[metric].band
    if (band === null) return []
    const centres = band.zones
      .filter((zone) => zone.min !== null && zone.max !== null)
      .map((zone) => ((zone.min as number) + (zone.max as number)) / 2)
    const envelope = referenceBandEnvelope(band)
    if (envelope !== null) centres.push((envelope.min + envelope.max) / 2)
    if (band.centralTendency !== null) centres.push(band.centralTendency.value)
    return centres
  }

  it('each neutral is at least 1% away from every band midpoint and central value of its metrics', () => {
    let checked = 0
    for (const id of PARAM_IDS) {
      const { neutral, metrics } = RUNNER_PARAM_SPECS[id]
      for (const { metric, scale } of metrics) {
        const inMetricUnits = neutral / scale
        for (const centre of bandCentres(metric)) {
          checked += 1
          expect(Math.abs(inMetricUnits - centre) / Math.abs(centre), `${id} vs ${metric}`)
            .toBeGreaterThan(0.01)
        }
      }
    }
    // cadence (3 zones + envelope), VO_cm (zone + envelope + mean), trunkLean, kneeFlexion.
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  it('each neutral differs from the fixture defaults, so a measured bind is distinguishable', () => {
    const heuristics = makeHeuristics()
    for (const id of PARAM_IDS) {
      const { metric, scale } = RUNNER_PARAM_SPECS[id].metrics[0]
      expect(RUNNER_PARAM_SPECS[id].neutral).not.toBe((heuristics[metric] as MetricResult).value! * scale)
    }
  })

  it('each neutral lies inside its own drawable range', () => {
    for (const id of PARAM_IDS) {
      const { neutral, range } = RUNNER_PARAM_SPECS[id]
      expect(neutral).toBeGreaterThanOrEqual(range[0])
      expect(neutral).toBeLessThanOrEqual(range[1])
      expect(NEUTRAL_RUNNER_PARAMS[id]).toBe(neutral)
    }
  })
})

describe('segments', () => {
  const isSkeletonEdge = (edge: SkeletonEdge) =>
    SKELETON_EDGES.some(([a, b]) => (a === edge[0] && b === edge[1]) || (a === edge[1] && b === edge[0]))

  it('every listed segment is a SKELETON_EDGES edge', () => {
    for (const id of PARAM_IDS) {
      for (const edge of RUNNER_PARAM_SEGMENTS[id]) expect(isSkeletonEdge(edge), edge.join('–')).toBe(true)
    }
  })

  it('all measured: every non-head edge is measured, head edges stay neutral', () => {
    const bound = bindRunnerParams(makeHeuristics())
    for (const edge of SKELETON_EDGES) {
      const head = edge.some((name) => name === 'nose' || name.endsWith('_ear'))
      expect(segmentSource(edge, bound), edge.join('–')).toBe(head ? 'neutral' : 'measured')
    }
  })

  it('all neutral: every edge is neutral', () => {
    const neutral = Object.fromEntries(
      PARAM_IDS.map((id) => [id, { source: 'neutral', value: RUNNER_PARAM_SPECS[id].neutral }]),
    ) as BoundRunnerParams
    for (const edge of SKELETON_EDGES) expect(segmentSource(edge, neutral)).toBe('neutral')
  })

  it('a segment is measured if ANY parameter listing it is measured, in either edge orientation', () => {
    const onlyKneeDrive = bindRunnerParams(makeHeuristics(), (metric) =>
      metric.metric === 'kneeDrive' ? 'normal' : 'excluded',
    )
    expect(segmentSource(['left_hip', 'left_knee'], onlyKneeDrive)).toBe('measured')
    expect(segmentSource(['left_knee', 'left_hip'], onlyKneeDrive)).toBe('measured')
    expect(segmentSource(['left_knee', 'left_ankle'], onlyKneeDrive)).toBe('neutral')
    expect(segmentSource(['left_shoulder', 'left_elbow'], onlyKneeDrive)).toBe('neutral')

    const onlyFootStrike = bindRunnerParams(makeHeuristics(), (metric) =>
      metric.metric === 'footStrikePattern' ? 'normal' : 'excluded',
    )
    expect(segmentSource(['right_heel', 'right_foot_index'], onlyFootStrike)).toBe('measured')
    expect(segmentSource(['right_knee', 'right_ankle'], onlyFootStrike)).toBe('measured')
    expect(segmentSource(['right_hip', 'right_knee'], onlyFootStrike)).toBe('neutral')
  })

  it('cadence shapes no segment', () => {
    expect(RUNNER_PARAM_SEGMENTS.cadence).toEqual([])
  })
})
