import type { FormHeuristicsResult } from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { AnalysisDiagnostics } from './analysisDiagnostics'

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
  /** Set once phase === 'ready'. Development-only consumption — see useVideoAnalysis.ts's
   * dev-only console auto-log. */
  diagnostics: AnalysisDiagnostics | null
  error: VideoAnalysisError | null
  start: () => void
  reset: () => void
}
