import type { FormHeuristicsResult } from '../heuristics/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { AnalysisDiagnostics } from './analysisDiagnostics'
import type { SubjectAgreement } from './scalePassSubjectAgreement'

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
  /** How the pass's own selected subject compared with the primary pass's (#56). Set only when
   * status is 'done' — the check runs at the graft, so no earlier status can carry a verdict. */
  subjectAgreement?: SubjectAgreement
  /** The scale pass's own diagnostics (its `scaleCalibration` is the grafted metric's
   * `calibration` by reference). Set only when status is 'done' — the primary run's
   * `diagnostics` field never reflects the scale pass. */
  diagnostics: AnalysisDiagnostics | null
  /**
   * The scale pass's OWN robust frames, the ones its grafted metrics were measured from
   * (`strides-3a1`). Set only when status is `'done'` — and then always, in the same object
   * literal that commits the graft, so its presence and "a graft happened" are one fact rather
   * than two that could disagree.
   *
   * The evidence planner needs it: an exemplar's timestamp names an instant, but the joint
   * positions an annotation draws there — and the hip ORDER a caliper's polarity is read from —
   * are properties of the FRAME, and the two detectors demonstrably disagree about both while
   * agreeing about which person they are watching. Not stored for display: nothing renders a
   * scale-pass skeleton overlay, and `robustFrames` on the analysis state stays the primary
   * pass's.
   */
  robustFrames?: RobustPoseFrame[]
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
