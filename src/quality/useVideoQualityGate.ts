import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../pose/detector'
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
 * null` fail-open handling covers the case where the detector hasn't finished loading yet or
 * failed to load at all, so this hook doesn't need its own detector lifecycle.
 */
export function useVideoQualityGate(
  videoSource: VideoSource,
  detector: PoseDetector | null,
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
    if (videoStatus !== 'ready' || !metadata || !video) return

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
  }, [videoStatus, metadata, videoRef, detector])

  const proceedAnyway = useCallback(() => {
    setDismissed(true)
  }, [])

  return { status, assessment, dismissed, proceedAnyway }
}
