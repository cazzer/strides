export type QualityCheckId = 'resolution' | 'frameRate' | 'confidence'

/**
 * 'skipped' — intentionally not evaluated (e.g. frameRate null for uploads). Never warns.
 * 'error'   — the check itself failed to run (e.g. detector unavailable). Never warns — gate fails open.
 */
export type QualityCheckStatus = 'pass' | 'fail' | 'skipped' | 'error'

export interface QualityCheckResult {
  id: QualityCheckId
  status: QualityCheckStatus
  /** Observed value, for UI/debug. */
  value: number | null
  /** Required minimum for pass; null when n/a. */
  threshold: number | null
  /** User-facing, populated for fail/error. */
  message: string | null
}

export interface VideoQualityAssessment {
  /** 'warn' iff at least one check is 'fail'. */
  overall: 'pass' | 'warn'
  checks: {
    resolution: QualityCheckResult
    frameRate: QualityCheckResult
    confidence: QualityCheckResult
  }
}
