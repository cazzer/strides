/**
 * Binding measured metrics to the model runner's degrees of freedom.
 *
 * The honesty rules (docs/prd/runner-led-results.md, "Honesty rules for the model"):
 * - Every parameter is bound to exactly one measured value, or held at a documented neutral
 *   constant. A metric never drives two parameters. `verticalOscillationCm` is a fallback for the
 *   same parameter as `verticalOscillation`, used only when the ratio is unmeasured, so it is still
 *   one value per parameter.
 * - **The neutral constants are illustrative, never targets.** None is a reference-band midpoint or
 *   a published central value (pinned by `runnerParams.test.ts` against `METRIC_GUIDANCE`). They
 *   only keep an unmeasured part of the figure drawable, and the renderer draws such parts dashed.
 * - Each parameter is stored in its metric's own unit, so binding is the identity (plus a clamp to
 *   what the figure can draw). The one conversion is `verticalOscillationCm`, divided by
 *   `MODEL_TORSO_LENGTH_CM`.
 * - There are no per-side or variability parameters, because no metric reports either.
 */
import { metricTier, type MetricTier } from '../results/metricConfidence'
import type { FormHeuristicsResult, MetricResult } from '../heuristics/types'
import { MODEL_TORSO_LENGTH_CM, realizeParams } from './gaitModel'
import type {
  BoundRunnerParam,
  BoundRunnerParams,
  MetricId,
  RunnerMetricId,
  RunnerParamId,
  RunnerParams,
  SkeletonEdge,
} from './types'

export interface RunnerParamSpec {
  /** Candidate metrics in priority order; the first measured one binds. `value = metric × scale`. */
  metrics: readonly { metric: RunnerMetricId; scale: number }[]
  /** Illustrative constant used while no candidate is measured. Never a band midpoint. */
  neutral: number
  /**
   * Clamp range for measured values: a drawing limit, not a plausibility judgement. A neutral
   * adjusted by `realizeParams` to fit a measured partner may fall outside it.
   */
  range: readonly [min: number, max: number]
}

export const RUNNER_PARAM_SPECS: Readonly<Record<RunnerParamId, RunnerParamSpec>> = {
  cadence: { metrics: [{ metric: 'cadence', scale: 1 }], neutral: 160, range: [120, 220] },
  pelvisBounce: {
    metrics: [
      { metric: 'verticalOscillation', scale: 1 },
      { metric: 'verticalOscillationCm', scale: 1 / MODEL_TORSO_LENGTH_CM },
    ],
    neutral: 0.14,
    range: [0, 0.5],
  },
  torsoPitch: { metrics: [{ metric: 'trunkLean', scale: 1 }], neutral: 4, range: [-15, 35] },
  armSwing: {
    metrics: [{ metric: 'armSwingAmplitude', scale: 1 }],
    neutral: 0.3,
    range: [0, 0.9],
  },
  peakThighAngle: { metrics: [{ metric: 'kneeDrive', scale: 1 }], neutral: 40, range: [10, 85] },
  peakSwingKneeBend: {
    metrics: [{ metric: 'kneeFlexion', scale: 1 }],
    neutral: 90,
    range: [50, 150],
  },
  landingOffset: {
    metrics: [{ metric: 'overstriding', scale: 1 }],
    neutral: 0.3,
    range: [-0.3, 0.7],
  },
  contactShankOffset: {
    metrics: [{ metric: 'footStrikePattern', scale: 1 }],
    neutral: 0.08,
    range: [-0.3, 0.4],
  },
  stepWidth: { metrics: [{ metric: 'stepWidth', scale: 1 }], neutral: 0.3, range: [-1.5, 1.5] },
  swingFootArc: {
    metrics: [{ metric: 'swingFootLateralExcursion', scale: 1 }],
    neutral: 0.15,
    range: [0, 0.8],
  },
}

const RUNNER_PARAM_IDS = Object.keys(RUNNER_PARAM_SPECS) as RunnerParamId[]

function mapParams<T>(fn: (id: RunnerParamId) => T): Record<RunnerParamId, T> {
  return Object.fromEntries(RUNNER_PARAM_IDS.map((id) => [id, fn(id)])) as Record<
    RunnerParamId,
    T
  >
}

export const NEUTRAL_RUNNER_PARAMS: RunnerParams = mapParams((id) => RUNNER_PARAM_SPECS[id].neutral)

export type RunnerMetrics = Pick<FormHeuristicsResult, RunnerMetricId>

function bindOne(
  spec: RunnerParamSpec,
  metrics: RunnerMetrics,
  tierOf: (metric: MetricResult) => MetricTier,
): BoundRunnerParam {
  for (const { metric, scale } of spec.metrics) {
    const result = metrics[metric]
    if (result.value === null || tierOf(result) === 'excluded') continue
    const [min, max] = spec.range
    const scaled = result.value * scale
    const value = Math.min(max, Math.max(min, scaled))
    return {
      source: 'measured',
      value,
      metricId: metric,
      metricValue: result.value,
      clamped: value !== scaled,
    }
  }
  return { source: 'neutral', value: spec.neutral }
}

/**
 * Binds every parameter to its first measured candidate metric, or to its neutral constant when
 * every candidate is null or tiered `'excluded'`. A `'caveated'` metric binds: low confidence is
 * still a measurement.
 *
 * Every bound `value` is what the model draws. The contact parameters are passed through
 * `realizeParams`, so where they conflict the weaker one is redrawn: a measured one then carries
 * the drawn `value` with `clamped: true` (its `metricValue` stays the truth), and a neutral one
 * carries its constant adjusted to fit.
 */
export function bindRunnerParams(
  metrics: RunnerMetrics,
  tierOf: (metric: MetricResult) => MetricTier = metricTier,
): BoundRunnerParams {
  const bound = mapParams((id) => bindOne(RUNNER_PARAM_SPECS[id], metrics, tierOf))
  const measured = new Set(RUNNER_PARAM_IDS.filter((id) => bound[id].source === 'measured'))
  const drawn = realizeParams(runnerParamValues(bound), measured)
  return mapParams((id): BoundRunnerParam => {
    const param = bound[id]
    if (drawn[id] === param.value) return param
    return param.source === 'measured'
      ? { ...param, value: drawn[id], clamped: true }
      : { source: 'neutral', value: drawn[id] }
  })
}

/** The plain values `poseAt` takes. */
export function runnerParamValues(bound: BoundRunnerParams): RunnerParams {
  return mapParams((id) => bound[id].value)
}

/** The parameter a metric can drive, or null for the two metrics that drive none. */
export function paramForMetric(metric: MetricId): RunnerParamId | null {
  return (
    RUNNER_PARAM_IDS.find((id) =>
      RUNNER_PARAM_SPECS[id].metrics.some((candidate) => candidate.metric === metric),
    ) ?? null
  )
}

const THIGHS: readonly SkeletonEdge[] = [
  ['left_hip', 'left_knee'],
  ['right_hip', 'right_knee'],
]
const SHANKS: readonly SkeletonEdge[] = [
  ['left_knee', 'left_ankle'],
  ['right_knee', 'right_ankle'],
]
const FEET: readonly SkeletonEdge[] = [
  ['left_ankle', 'left_heel'],
  ['left_heel', 'left_foot_index'],
  ['left_ankle', 'left_foot_index'],
  ['right_ankle', 'right_heel'],
  ['right_heel', 'right_foot_index'],
  ['right_ankle', 'right_foot_index'],
]

/**
 * The skeleton edges (a subset of `SKELETON_EDGES`) each parameter shapes. An edge is drawn as
 * measured when ANY parameter listing it is measured. The head edges belong to no parameter and so
 * are always neutral.
 */
export const RUNNER_PARAM_SEGMENTS: Readonly<Record<RunnerParamId, readonly SkeletonEdge[]>> = {
  cadence: [],
  pelvisBounce: [['left_hip', 'right_hip']],
  torsoPitch: [
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_shoulder', 'right_shoulder'],
  ],
  armSwing: [
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
  ],
  peakThighAngle: THIGHS,
  peakSwingKneeBend: SHANKS,
  landingOffset: [...THIGHS, ...SHANKS],
  contactShankOffset: [...SHANKS, ...FEET],
  stepWidth: [...THIGHS, ...SHANKS],
  swingFootArc: [...SHANKS, ...FEET],
}

function sameEdge(a: SkeletonEdge, b: SkeletonEdge): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
}

/** Whether an edge draws as measured (solid) or neutral (dashed grey). */
export function segmentSource(
  edge: SkeletonEdge,
  bound: BoundRunnerParams,
): 'measured' | 'neutral' {
  const measured = RUNNER_PARAM_IDS.some(
    (id) =>
      bound[id].source === 'measured' &&
      RUNNER_PARAM_SEGMENTS[id].some((candidate) => sameEdge(candidate, edge)),
  )
  return measured ? 'measured' : 'neutral'
}
