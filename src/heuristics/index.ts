import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { FormHeuristicsResult, HeuristicsConfig } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { detectView } from './viewDetection'
import { computeVerticalOscillation } from './verticalOscillation'
import { computeTrunkLean } from './trunkLean'
import { computeOverstriding } from './overstriding'
import { computeCadence } from './cadence'
import { computeKneeFlexion } from './kneeFlexion'
import { computeArmSwingSymmetry } from './armSwingSymmetry'
import { computeFootStrikePattern } from './footStrikePattern'

/**
 * View detection must run before all seven metrics — each one's view-fit gating and confidence
 * depend on the detected `View`. Encoding that ordering dependency here, rather than leaving it
 * to every caller, means the results view makes one call instead of eight that have to be
 * invoked in the right order.
 */
export function computeFormHeuristics(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): FormHeuristicsResult {
  const view = detectView(frames, config)

  return {
    view,
    verticalOscillation: computeVerticalOscillation(frames, view.view, config),
    trunkLean: computeTrunkLean(frames, view.view, config),
    overstriding: computeOverstriding(frames, view.view, config),
    cadence: computeCadence(frames, view.view, config),
    kneeFlexion: computeKneeFlexion(frames, view.view, config),
    armSwingSymmetry: computeArmSwingSymmetry(frames, view.view, config),
    footStrikePattern: computeFootStrikePattern(frames, view.view, config),
  }
}
