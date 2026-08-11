import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../pose/detector'
import type { PoseDetectorStatus } from '../pose/usePoseDetector'
import type { VideoSource } from '../video/types'
import { assessVideoQuality } from './assessVideoQuality'
import type { VideoQualityAssessment } from './types'

export type QualityGateStatus = 'idle' | 'assessing' | 'ready' | 'error'

export interface QualityGateState {
  status: QualityGateStatus
  assessment: VideoQualityAssessment | null
  dismissed: boolean
  proceedAnyway: () => void
}

/**
 * Runs the whole-clip quality assessment whenever `videoSource` reaches `'ready'` for a newly
 * loaded clip. The `PoseDetector` is owned by the caller (`usePoseDetector()`, shared with
 * `useVideoAnalysis`, #8) rather than created here — `checkConfidence`'s existing `detector:
 * null` fail-open handling covers the case where the detector failed to load at all, so this
 * hook doesn't need its own detector lifecycle. It DOES wait out `detectorStatus === 'loading'`
 * before running at all, though: `detector` alone can't distinguish "still loading" from
 * "failed" (both are `null`), and without this the assessment would fire immediately with
 * `detector: null` on every session (loading is the near-universal first render), showing a
 * spurious "couldn't check confidence" result that self-corrects a moment later once the shared
 * detector actually resolves — a flash of user-visible wrongness with a real, avoidable cause.
 */
export function useVideoQualityGate(
  videoSource: VideoSource,
  detector: PoseDetector | null,
  detectorStatus: PoseDetectorStatus,
): QualityGateState {
  const { status: videoStatus, metadata, videoRef } = videoSource

  const [status, setStatus] = useState<QualityGateStatus>('idle')
  const [assessment, setAssessment] = useState<VideoQualityAssessment | null>(
    null,
  )
  const [dismissed, setDismissed] = useState(false)

  const runIdRef = useRef(0)

  useEffect(() => {
    const video = videoRef.current
    if (
      videoStatus !== 'ready' ||
      !metadata ||
      !video ||
      detectorStatus === 'loading'
    )
      return

    const runId = ++runIdRef.current
    setStatus('assessing')
    setDismissed(false)

    void (async () => {
      try {
        const result = await assessVideoQuality({ video, metadata, detector })
        if (runIdRef.current !== runId) return
        setAssessment(result)
        setStatus('ready')
      } catch {
        if (runIdRef.current !== runId) return
        setStatus('error')
      }
    })()
  }, [videoStatus, metadata, videoRef, detector, detectorStatus])

  const proceedAnyway = useCallback(() => {
    setDismissed(true)
  }, [])

  return { status, assessment, dismissed, proceedAnyway }
}
