import type { QualityGateStatus } from './useVideoQualityGate'
import type { VideoQualityAssessment } from './types'

export interface QualityWarningBannerProps {
  status: QualityGateStatus
  assessment: VideoQualityAssessment | null
  dismissed: boolean
  proceedAnyway: () => void
}

/**
 * Mirrors `VideoInputPanel`'s role-based rendering pattern: `role="status"` while the
 * check is in progress, `role="alert"` when it surfaces a warning. Renders nothing once
 * the assessment passes or has been dismissed — this is a one-time, per-clip gate, not a
 * persistent status readout.
 */
export function QualityWarningBanner({
  status,
  assessment,
  dismissed,
  proceedAnyway,
}: QualityWarningBannerProps) {
  if (status === 'assessing') {
    return <p role="status">Checking video quality…</p>
  }

  if (
    status !== 'ready' ||
    !assessment ||
    assessment.overall === 'pass' ||
    dismissed
  ) {
    return null
  }

  const failedChecks = Object.values(assessment.checks).filter(
    (check) => check.status === 'fail' && check.message,
  )

  return (
    <div role="alert" className="quality-warning-banner">
      <p>This video may produce unreliable results:</p>
      <ul>
        {failedChecks.map((check) => (
          <li key={check.id}>{check.message}</li>
        ))}
      </ul>
      <button type="button" onClick={proceedAnyway}>
        Proceed anyway
      </button>
    </div>
  )
}
