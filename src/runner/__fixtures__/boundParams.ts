import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { makeHeuristics } from '../../results/__fixtures__/metricResult'
import { bindRunnerParams } from '../runnerParams'
import type { BoundRunnerParams } from '../types'

/** Every parameter bound from the shared fixture's unremarkable defaults. */
export function bindAll(overrides: Partial<FormHeuristicsResult> = {}): BoundRunnerParams {
  return bindRunnerParams(makeHeuristics(overrides))
}

/** Only `measured` bind; every other metric is tiered `'excluded'`, so its part is neutral. */
export function bindOnly(
  measured: readonly MetricId[],
  overrides: Partial<FormHeuristicsResult> = {},
): BoundRunnerParams {
  return bindRunnerParams(makeHeuristics(overrides), (metric) =>
    measured.includes(metric.metric) ? 'normal' : 'excluded',
  )
}
