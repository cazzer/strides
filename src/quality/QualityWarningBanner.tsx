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
    return (
      <p role="status">
        Checking video quality… (the preview will jump briefly while we sample
        frames)
      </p>
    )
  }

  if (status === 'error') {
    return (
      <p role="status">Couldn't check video quality — you can still proceed.</p>
    )
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
    <div
      role="alert"
      className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 p-4 space-y-3"
    >
      <p>This video may produce unreliable results:</p>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        {failedChecks.map((check) => (
          <li key={check.id}>{check.message}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={proceedAnyway}
        className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Proceed anyway
      </button>
    </div>
  )
}
