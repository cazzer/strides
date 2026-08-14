import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { FormHeuristicsResult, HeuristicsConfig } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { detectView } from './viewDetection'
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

/**
 * View detection must run before all ten metrics — each one's view-fit gating and confidence
 * depend on the detected `View`. Encoding that ordering dependency here, rather than leaving it
 * to every caller, means the results view makes one call instead of ten that have to be
 * invoked in the right order.
 *
 * `verticalOscillationCm` is appended AFTER `verticalRatio` rather than inserted between
 * `verticalOscillation` and `verticalRatio` — #35's shipped orchestration requirement says
 * `verticalRatio` sits immediately after `verticalOscillation` in `MetricId` and every
 * enumeration of it, and appending keeps that literally true rather than requiring it to be
 * re-verified against a new neighbour (#36, D1).
 *
 * `stepWidth` is appended after `footStrikePattern`, per this file's established append-only
 * convention (#46).
 */
export function computeFormHeuristics(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): FormHeuristicsResult {
  const view = detectView(frames, config)

  return {
    view,
    verticalOscillation: computeVerticalOscillation(frames, view.view, config),
    verticalRatio: computeVerticalRatio(frames, view.view, config),
    verticalOscillationCm: computeVerticalOscillationCmMetric(frames, view.view, config),
    trunkLean: computeTrunkLean(frames, view.view, config),
    overstriding: computeOverstriding(frames, view.view, config),
    cadence: computeCadence(frames, view.view, config),
    kneeFlexion: computeKneeFlexion(frames, view.view, config),
    armSwingSymmetry: computeArmSwingSymmetry(frames, view.view, config),
    footStrikePattern: computeFootStrikePattern(frames, view.view, config),
    stepWidth: computeStepWidth(frames, view.view, config),
  }
}
