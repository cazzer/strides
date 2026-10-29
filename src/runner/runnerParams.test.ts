import { describe, expect, it } from 'vitest'
import { METRIC_GUIDANCE } from '../guidance/metricGuidance'
import { referenceBandEnvelope } from '../guidance/types'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillation,
  makeVerticalOscillationCm,
} from '../results/__fixtures__/metricResult'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { CONTACT_PARAMS, MODEL_TORSO_LENGTH_CM } from './gaitModel'
import { MEASURE_PARAM } from './__fixtures__/measureModel'
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
  strideLength: 'verticalRatio',
}

/**
 * What a measured parameter draws when nothing clamps it: metric × scale, or for the stride, the
 * stride vertical ratio was computed over (relative bounce ÷ vertical ratio).
 */
function unclampedValue(heuristics: FormHeuristicsResult, id: RunnerParamId, metricId: RunnerMetricId): number {
  const candidate = RUNNER_PARAM_SPECS[id].metrics.find((m) => m.metric === metricId)!
  const value = heuristics[metricId].value!
  return 'stride' in candidate ? heuristics.verticalOscillation.value! / value : value * candidate.scale
}

function expectNeutral(bound: BoundRunnerParams, id: RunnerParamId): void {
  expect(bound[id]).toEqual({ source: 'neutral', value: RUNNER_PARAM_SPECS[id].neutral })
}

/**
 * Neutral, and at its constant unless it is a contact parameter that a measured partner made give
 * way (the fixture's 0.08 overstriding cannot be drawn with the 0.08 neutral shank offset).
 */
function expectNeutralOrAdjusted(bound: BoundRunnerParams, id: RunnerParamId): void {
  expect(bound[id].source).toBe('neutral')
  if (!(CONTACT_PARAMS as readonly RunnerParamId[]).includes(id)) expectNeutral(bound, id)
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
        value: unclampedValue(heuristics, id, metricId),
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
      expectNeutralOrAdjusted(bound, id)
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
      expectNeutralOrAdjusted(bound, id)
    }
  })

  it('a null contact metric with no conflicting partner sits exactly at its neutral constant', () => {
    const bound = bindRunnerParams(
      makeHeuristics({
        footStrikePattern: makeMetric('footStrikePattern', { value: null }),
        overstriding: makeMetric('overstriding', { value: 0.3 }),
      }),
    )
    expectNeutral(bound, 'contactShankOffset')
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

  it('stepWidthCm never changes anything; verticalRatio changes only the stride', () => {
    const base = bindRunnerParams(makeHeuristics())
    const changed = bindRunnerParams(
      makeHeuristics({
        verticalRatio: makeMetric('verticalRatio', { value: 0.05 }),
        stepWidthCm: makeMetric('stepWidthCm', { value: 12 }),
      }),
    )
    expect({ ...changed, strideLength: base.strideLength }).toEqual(base)
    expect(changed.strideLength).toMatchObject({ value: 0.15 / 0.05, metricValue: 0.05 })
    const stepWidthNull = bindRunnerParams(
      makeHeuristics({ stepWidth: makeMetric('stepWidth', { value: null }) }),
    )
    // No stepWidthCm fallback: a measured centimetre width does not stand in for the ratio.
    expectNeutral(stepWidthNull, 'stepWidth')
  })

  describe('the stride binds from vertical ratio as the stride it was computed over', () => {
    it('is relative bounce ÷ vertical ratio, in torso lengths, labelled with vertical ratio', () => {
      const bound = bindRunnerParams(
        makeHeuristics({
          verticalOscillation: makeVerticalOscillation({ value: 0.154 }),
          verticalRatio: makeMetric('verticalRatio', { value: 0.0246 }),
        }),
      )
      expect(bound.strideLength).toEqual({
        source: 'measured',
        value: 0.154 / 0.0246,
        metricId: 'verticalRatio',
        metricValue: 0.0246,
        clamped: false,
      })
      // The drawn ratio is vertical ratio itself.
      expect(bound.pelvisBounce.value / bound.strideLength.value).toBeCloseTo(0.0246, 15)
    })

    it('is neutral when the bounce is only known in centimetres (no stride in torso lengths)', () => {
      const bound = bindRunnerParams(
        makeHeuristics({ verticalOscillation: makeVerticalOscillation({ viewFit: 'unsuitable' }) }),
      )
      expect(bound.pelvisBounce).toMatchObject({ metricId: 'verticalOscillationCm' })
      expectNeutral(bound, 'strideLength')
    })

    it("is neutral when the relative bounce came from another clip than vertical ratio's", () => {
      const sourceIndices = Object.fromEntries(ALL_METRICS.map((id) => [id, 0])) as Record<MetricId, number>
      const other = { ...sourceIndices, verticalOscillation: 1 }
      expect(bindRunnerParams(makeHeuristics(), undefined, sourceIndices).strideLength.source).toBe('measured')
      expectNeutral(bindRunnerParams(makeHeuristics(), undefined, other), 'strideLength')
    })

    it('is clamped to its drawable range, and says so', () => {
      const bound = bindRunnerParams(
        makeHeuristics({ verticalRatio: makeMetric('verticalRatio', { value: 0.01 }) }),
      )
      expect(bound.strideLength).toMatchObject({ value: 10, metricValue: 0.01, clamped: true })
    })

    it('is marked clamped when the bounce it divides was clamped: the drawn ratio is not the measured one', () => {
      const bound = bindRunnerParams(
        makeHeuristics({
          verticalOscillation: makeVerticalOscillation({ value: 0.6 }),
          verticalRatio: makeMetric('verticalRatio', { value: 0.1 }),
        }),
      )
      expect(bound.pelvisBounce).toMatchObject({ value: 0.5, clamped: true })
      expect(bound.strideLength).toMatchObject({ value: 0.6 / 0.1, clamped: true })
    })
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

describe('every bound value is what the model draws', () => {
  const metricOverrides = (values: Partial<Record<RunnerMetricId, number | null>>) =>
    makeHeuristics(
      Object.fromEntries(
        Object.entries(values).map(([metric, value]) => [
          metric,
          makeMetric(metric as RunnerMetricId, { value: value as number | null }),
        ]),
      ),
    )

  const CASES: Record<string, FormHeuristicsResult> = {
    defaults: makeHeuristics(),
    'landing 0.05, foot strike 0.10': metricOverrides({ overstriding: 0.05, footStrikePattern: 0.1 }),
    'landing 0.10, foot strike 0.06': metricOverrides({ overstriding: 0.1, footStrikePattern: 0.06 }),
    'landing −0.10, foot strike 0': metricOverrides({ overstriding: -0.1, footStrikePattern: 0 }),
    'foot strike 0.2, landing neutral': metricOverrides({ footStrikePattern: 0.2, overstriding: null }),
    'knee drive 12°, landing and foot strike neutral': metricOverrides({
      kneeDrive: 12,
      overstriding: null,
      footStrikePattern: null,
    }),
    'knee drive 12°, landing 0.3 measured': metricOverrides({ kneeDrive: 12, overstriding: 0.3 }),
    'crossover, wide arc, deep lean': metricOverrides({
      stepWidth: -0.4,
      swingFootLateralExcursion: 0.5,
      trunkLean: 18,
      kneeFlexion: 130,
    }),
    'everything neutral': metricOverrides(
      Object.fromEntries(
        (Object.keys(EXPECTED_BINDING) as RunnerParamId[]).map((id) => [EXPECTED_BINDING[id], null]),
      ) as Record<RunnerMetricId, null>,
    ),
  }

  for (const [label, heuristics] of Object.entries(CASES)) {
    it(`${label}: measuring the drawn model returns every bound value; a differing one is clamped`, () => {
      const bound = bindRunnerParams(heuristics)
      const drawn = runnerParamValues(bound)
      for (const id of PARAM_IDS) {
        const { measure, tolerance } = MEASURE_PARAM[id]
        expect(Math.abs(measure(drawn) - bound[id].value), id).toBeLessThanOrEqual(tolerance)
        const param = bound[id]
        if (param.source === 'measured') {
          if (param.value !== unclampedValue(heuristics, id, param.metricId)) expect(param.clamped, id).toBe(true)
          else expect(param.clamped, id).toBe(false)
        }
      }
    })
  }

  it('both offsets measured in conflict: landing exact, foot strike drawn lower and clamped', () => {
    const bound = bindRunnerParams(CASES['landing 0.05, foot strike 0.10'])
    expect(bound.landingOffset).toMatchObject({ source: 'measured', value: 0.05, clamped: false })
    expect(bound.contactShankOffset).toMatchObject({
      source: 'measured',
      metricId: 'footStrikePattern',
      metricValue: 0.1,
      clamped: true,
    })
    expect(bound.contactShankOffset.value).toBeCloseTo(0.025, 2)
  })

  it('a measured foot strike is drawn exactly; the neutral landing is adjusted around it', () => {
    const bound = bindRunnerParams(CASES['foot strike 0.2, landing neutral'])
    expect(bound.contactShankOffset).toMatchObject({ value: 0.2, metricValue: 0.2, clamped: false })
    expect(bound.landingOffset.source).toBe('neutral')
    expect(bound.landingOffset.value).not.toBe(RUNNER_PARAM_SPECS.landingOffset.neutral)
  })

  it('a measured knee drive is drawn exactly over a neutral contact leg, and gives way to a measured landing', () => {
    const alone = bindRunnerParams(CASES['knee drive 12°, landing and foot strike neutral'])
    expect(alone.peakThighAngle).toMatchObject({ value: 12, clamped: false })
    const withLanding = bindRunnerParams(CASES['knee drive 12°, landing 0.3 measured'])
    expect(withLanding.landingOffset).toMatchObject({ value: 0.3, clamped: false })
    expect(withLanding.peakThighAngle).toMatchObject({ metricValue: 12, clamped: true })
    expect(withLanding.peakThighAngle.value).toBeGreaterThan(12)
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
    expect(seen.size).toBe(12)
  })

  it('paramForMetric names the parameter each metric drives, or null', () => {
    for (const metric of ALL_METRICS) {
      const expected =
        metric === 'stepWidthCm'
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
      for (const candidate of metrics) {
        const { metric } = candidate
        // The stride's neutral, in vertical ratio's units, is the ratio the neutral figure draws.
        const inMetricUnits =
          'stride' in candidate ? NEUTRAL_RUNNER_PARAMS.pelvisBounce / neutral : neutral / candidate.scale
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
      const { metric } = RUNNER_PARAM_SPECS[id].metrics[0]
      expect(RUNNER_PARAM_SPECS[id].neutral).not.toBe(unclampedValue(heuristics, id, metric))
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
