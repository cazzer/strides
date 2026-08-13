import type { FormHeuristicsResult } from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { AnalysisDiagnostics } from './analysisDiagnostics'

export type AnalysisPhase = 'idle' | 'sampling' | 'processing' | 'ready' | 'error'

export interface VideoAnalysisError {
  kind: 'detector-unavailable' | 'detection-stalled' | 'unknown'
  message: string
}

export type ScalePassStatus = 'idle' | 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type ScalePassSkipReason = 'disabled' | 'primary-scale'

/**
 * The background MediaPipe scale pass's status machine (add-background-scale-pass, D1). One
 * object per transition — `useVideoAnalysis` replaces it wholesale on every status change, so
 * the dev-only console emission can key on its identity and fire exactly once per terminal
 * transition. A failed or skipped pass leaves the primary result untouched by construction: the
 * only state a pass ever writes outside this object is the grafted `heuristics` on `'done'`.
 */
export interface ScalePassState {
  status: ScalePassStatus
  /** Why the pass never ran. Set only when status is 'skipped'. */
  reason?: ScalePassSkipReason
  /** What went wrong. Set only when status is 'failed'. */
  error?: string
  /** The scale pass's own diagnostics (its `scaleCalibration` is the grafted metric's
   * `calibration` by reference). Set only when status is 'done' — the primary run's
   * `diagnostics` field never reflects the scale pass. */
  diagnostics: AnalysisDiagnostics | null
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
   * dev-only console auto-log. Always the PRIMARY pass's diagnostics — the scale pass's live on
   * `scalePass.diagnostics` instead, so this field (and the console line built from it) is
   * byte-identical to what it was before the scale pass existed. */
  diagnostics: AnalysisDiagnostics | null
  /** The background scale pass riding this run — decided ('pending' vs 'skipped') the moment
   * phase reaches 'ready'. */
  scalePass: ScalePassState
  error: VideoAnalysisError | null
  start: () => void
  reset: () => void
}
