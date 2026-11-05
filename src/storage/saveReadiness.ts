import type { AggregateAnalysisState } from '../results/types'
import { outlinePassStatus } from '../results/types'
import type { ClipSession } from '../results/multiClipAnalysis'
import type { ScalePassStatus } from '../guidance/types'

/**
 * A session can be saved only once it is FINISHED (design D4): the grafts from the background
 * scale and outline passes can still change `verticalOscillationCm`, `stepWidthCm` and
 * `swingFootLateralExcursion` until then, and a saved number must be the number the runner saw.
 */
export type SaveReadiness = { ready: true } | { ready: false; reason: 'analysing' | 'background' }

const RUNNING: readonly ScalePassStatus[] = ['pending', 'running']

export function saveReadiness(
  aggregate: Pick<AggregateAnalysisState, 'phase' | 'heuristics'>,
  clips: readonly Pick<ClipSession, 'analysis'>[],
): SaveReadiness {
  if (aggregate.phase !== 'ready' || !aggregate.heuristics || clips.length === 0) {
    return { ready: false, reason: 'analysing' }
  }
  for (const clip of clips) {
    if (RUNNING.includes(clip.analysis.scalePass.status) || RUNNING.includes(outlinePassStatus(clip.analysis))) {
      return { ready: false, reason: 'background' }
    }
  }
  return { ready: true }
}
