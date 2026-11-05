import type { MetricId } from '../heuristics/types'

/**
 * Methodology versions for saved assessments (save-assessments-to-runner-storage, design D5).
 *
 * Two levels:
 *   - `METRIC_DEFINITION_VERSIONS` — one integer per metric. **This is what the progress view
 *     compares on**: two readings of a metric are drawn as one series only when their definition
 *     versions are equal.
 *   - `METHODOLOGY_VERSION` — one app-wide integer, the label in a saved file's name.
 *
 * ## The rule (reviewers: enforce this one by hand)
 *
 * A change that MOVES a metric's readings — its formula, the signal it reads, its unit, how it
 * aggregates, the window it searches — bumps that metric's definition version AND appends an entry
 * to `METHODOLOGY_HISTORY` with the next methodology version. A confidence recalibration or a copy
 * change does not. An analysis-wide change (person selection, say) may append a methodology entry
 * without bumping any metric.
 *
 * `methodology.test.ts` fails when a metric is bumped without a history entry, when history is
 * edited out of order, or when a metric version decreases. It cannot notice a definition change
 * nobody bumped — that is what the rule above is for.
 *
 * Everything starts at 1 on 2026-11-05: earlier re-definitions (`strides-cjl` footstrike timing,
 * `strides-eiil` arm-swing travel, the `strides-2iw` view-confidence rescale) predate storage, so
 * nothing saved before them exists to be compared.
 */

export interface MethodologyHistoryEntry {
  readonly version: number
  /** ISO date the version shipped. */
  readonly date: string
  readonly summary: string
  readonly metricDefinitions: Readonly<Record<MetricId, number>>
}

const INITIAL_DEFINITIONS: Readonly<Record<MetricId, number>> = Object.freeze({
  verticalOscillation: 1,
  verticalRatio: 1,
  verticalOscillationCm: 1,
  trunkLean: 1,
  overstriding: 1,
  cadence: 1,
  kneeFlexion: 1,
  footStrikePattern: 1,
  stepWidth: 1,
  stepWidthCm: 1,
  kneeDrive: 1,
  armSwingAmplitude: 1,
  swingFootLateralExcursion: 1,
})

/** Append-only. Never edit or reorder an entry once it has shipped. */
export const METHODOLOGY_HISTORY: readonly MethodologyHistoryEntry[] = Object.freeze([
  Object.freeze({
    version: 1,
    date: '2026-11-05',
    summary: 'First saved methodology: every metric as defined when runner storage shipped.',
    metricDefinitions: INITIAL_DEFINITIONS,
  }),
])

export const METRIC_DEFINITION_VERSIONS: Readonly<Record<MetricId, number>> = INITIAL_DEFINITIONS

export const METHODOLOGY_VERSION = 1

/** The highest definition version this build knows for a metric — anything above it was saved by
 * a newer Strides, and the progress view shows it without plotting it. */
export function knownDefinitionVersion(metric: MetricId): number {
  return METRIC_DEFINITION_VERSIONS[metric]
}
