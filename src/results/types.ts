import type { FormHeuristicsResult } from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'

export type AnalysisPhase = 'idle' | 'sampling' | 'processing' | 'ready' | 'error'

export interface VideoAnalysisError {
  kind: 'detector-unavailable' | 'detection-stalled' | 'unknown'
  message: string
}

export interface VideoAnalysisState {
  phase: AnalysisPhase
  /** 0..1, meaningful during 'sampling'. */
  progress: number
  isPausedMidAnalysis: boolean
  /** Set once phase === 'ready'. */
  robustFrames: RobustPoseFrame[] | null
  /** Set once phase === 'ready'. */
  heuristics: FormHeuristicsResult | null
  error: VideoAnalysisError | null
  start: () => void
  reset: () => void
}
