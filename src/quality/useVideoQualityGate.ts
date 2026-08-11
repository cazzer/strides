import { useCallback, useEffect, useRef, useState } from 'react'
import { createDetector } from '../pose/detector'
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
 * Runs the whole-clip quality assessment whenever `videoSource` reaches `'ready'` for a
 * newly loaded clip. Lazily creates a single `PoseDetector` and caches it in a ref for
 * the hook's lifetime, reused across re-loaded clips to avoid repeatedly paying the
 * model-load cost; disposed only on unmount. `PoseDetector` has no cancel/abort hook, so
 * a superseded clip's in-flight assessment is left to finish in the background — a
 * monotonic run id is used to discard its result instead of applying it to state.
 */
export function useVideoQualityGate(
  videoSource: VideoSource,
): QualityGateState {
  const { status: videoStatus, metadata, videoRef } = videoSource

  const [status, setStatus] = useState<QualityGateStatus>('idle')
  const [assessment, setAssessment] = useState<VideoQualityAssessment | null>(
    null,
  )
  const [dismissed, setDismissed] = useState(false)

  const detectorRef = useRef<PoseDetector | null>(null)
  const detectorPromiseRef = useRef<Promise<PoseDetector> | null>(null)
  const runIdRef = useRef(0)

  const getDetector = useCallback(async (): Promise<PoseDetector | null> => {
    if (detectorRef.current) return detectorRef.current
    if (!detectorPromiseRef.current) {
      detectorPromiseRef.current = createDetector({ backend: 'movenet' })
    }
    try {
      const detector = await detectorPromiseRef.current
      detectorRef.current = detector
      return detector
    } catch {
      // Detector creation failed (e.g. no WebGL). Fail open: proceed with detector: null,
      // so checkConfidence reports 'error' rather than blocking the rest of the assessment.
      detectorPromiseRef.current = null
      return null
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (videoStatus !== 'ready' || !metadata || !video) return

    const runId = ++runIdRef.current
    setStatus('assessing')
    setDismissed(false)

    void (async () => {
      const detector = await getDetector()
      if (runIdRef.current !== runId) return

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
  }, [videoStatus, metadata, videoRef, getDetector])

  // Dispose the cached detector once, on unmount — not per-clip.
  useEffect(() => {
    return () => {
      detectorRef.current?.dispose()
    }
  }, [])

  const proceedAnyway = useCallback(() => {
    setDismissed(true)
  }, [])

  return { status, assessment, dismissed, proceedAnyway }
}
