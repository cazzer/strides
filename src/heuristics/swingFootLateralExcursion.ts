import type { RobustPoseFrame } from '../pose/robustness/types'
import { planSwingFootOutline } from './swingFootOutline'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, SwingFootLateralExcursionResult, View } from './types'

/**
 * Sideways foot travel (`strides-uz48`) is an early-swing OUTLINE check on front clips: does
 * anything below the swing knee stick out past the outer edge of that leg's thigh in the person
 * mask? The mask needs a separate MediaPipe pass, so the primary pass only PLANS it — this result
 * carries `outlinePlan` and `value: null` until the background outline pass grafts the reading in
 * (`summarizeSwingFootOutline`, `src/results/swingFootOutlineGraft.ts`). Side and ambiguous views
 * abstain with no plan.
 *
 * Joint positions cannot answer this from the front: a whip-free foot is hidden behind the thigh
 * through most of early swing (`docs/agent-notes/swing-foot-travel.md`).
 */
export function computeSwingFootLateralExcursion(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): SwingFootLateralExcursionResult {
  return planSwingFootOutline(frames, view, config)
}
