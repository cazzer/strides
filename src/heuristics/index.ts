import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { FormHeuristicsResult, HeuristicsConfig } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { detectView } from './viewDetection'
import { mostPlausibleView, resolveViewFitTable } from './viewPlausibility'
import { computeVerticalOscillation } from './verticalOscillation'
import { computeVerticalRatio } from './verticalRatio'
import { computeVerticalOscillationCmMetric } from './verticalOscillationCm'
import { computeTrunkLean } from './trunkLean'
import { computeOverstriding } from './overstriding'
import { computeCadence } from './cadence'
import { computeKneeFlexion } from './kneeFlexion'
import { computeArmSwingSymmetry } from './armSwingSymmetry'
import { computeFootStrikePattern } from './footStrikePattern'
import { computeStepWidth } from './stepWidth'
import { computeStepWidthCm } from './stepWidthCm'

/**
 * View detection must run before all eleven metrics — each one's view-fit gating and confidence
 * depend on the detected `View`. Encoding that ordering dependency here, rather than leaving it
 * to every caller, means the results view makes one call instead of eleven that have to be
 * invoked in the right order.
 *
 * `verticalOscillationCm` is appended AFTER `verticalRatio` rather than inserted between
 * `verticalOscillation` and `verticalRatio` — #35's shipped orchestration requirement says
 * `verticalRatio` sits immediately after `verticalOscillation` in `MetricId` and every
 * enumeration of it, and appending keeps that literally true rather than requiring it to be
 * re-verified against a new neighbour (#36, D1).
 *
 * `stepWidth` and `stepWidthCm` are both appended after `footStrikePattern`, per this file's
 * established append-only convention (#46, #45) — same order as their `MetricId` declaration
 * (ratio before cm, matching the `verticalOscillation`/`verticalOscillationCm` pairing above).
 *
 * What the metrics are gated by is the view PLAUSIBILITY, not the view label
 * (`propagate-view-confidence-to-metric-gating`). This function resolves the config's view-fit
 * table against `view.plausibility` once and hands every metric the resolved table plus the
 * most-plausible view, so all eleven share one view decision — as they always have — and that
 * decision now carries the classification's own certainty instead of discarding it. Two
 * consequences worth stating explicitly:
 *
 *   - A metric can no longer be hard-excluded as structurally unmeasurable on the strength of a
 *     view the geometry does not actually support: the exclusion (`fit`) and the discount
 *     (`multiplier`) are resolved from the same distribution, so they cannot disagree about how
 *     sure we are.
 *   - `result.view.view` stays the conservative committed label, and can differ from the view the
 *     metrics were gated by when the plausibility leans somewhere the two-vote rule wouldn't
 *     commit. Both are reported; `view.plausibility` is what reconciles them.
 *
 * A clip that commits to a label is unaffected in every particular — `resolveViewFitTable`
 * returns the caller's own table by reference there, so those metrics are called with the
 * identical config object and the identical view label they were before.
 */
export function computeFormHeuristics(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): FormHeuristicsResult {
  const view = detectView(frames, config)

  const gatedView = mostPlausibleView(view.plausibility)
  const resolvedTable = resolveViewFitTable(config.viewFitTable, view.plausibility)
  // Reference identity when nothing was resolved, mirroring `fuseFormHeuristicsResults`'s
  // single-clip identity: on a committed-view clip every metric receives the caller's own config
  // object, which is the no-op proof rather than an optimization.
  const gatedConfig: HeuristicsConfig =
    resolvedTable === config.viewFitTable
      ? config
      : { ...config, viewFitTable: resolvedTable }

  return {
    view,
    verticalOscillation: computeVerticalOscillation(frames, gatedView, gatedConfig),
    verticalRatio: computeVerticalRatio(frames, gatedView, gatedConfig),
    verticalOscillationCm: computeVerticalOscillationCmMetric(frames, gatedView, gatedConfig),
    trunkLean: computeTrunkLean(frames, gatedView, gatedConfig),
    overstriding: computeOverstriding(frames, gatedView, gatedConfig),
    cadence: computeCadence(frames, gatedView, gatedConfig),
    kneeFlexion: computeKneeFlexion(frames, gatedView, gatedConfig),
    armSwingSymmetry: computeArmSwingSymmetry(frames, gatedView, gatedConfig),
    footStrikePattern: computeFootStrikePattern(frames, gatedView, gatedConfig),
    stepWidth: computeStepWidth(frames, gatedView, gatedConfig),
    stepWidthCm: computeStepWidthCm(frames, gatedView, gatedConfig),
  }
}
