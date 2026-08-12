import { useCallback, useEffect, useRef, useState } from 'react'
import { createDetector } from './detector'
import type { PoseDetector } from './detector'
import { resolvePoseDetectorConfig } from './poseBackendConfig'

export type PoseDetectorStatus = 'loading' | 'ready' | 'error'

export interface SharedPoseDetector {
  status: PoseDetectorStatus
  /** Non-null iff status === 'ready'. */
  detector: PoseDetector | null
}

/**
 * Owns a single `PoseDetector` for the component tree's lifetime — lazily created on mount,
 * cached in a ref, disposed only on unmount. Extracted from `useVideoQualityGate` (#6) so
 * `useVideoAnalysis` (#8) can share the same detector instance instead of each hook paying
 * MoveNet's WebGL/model-load cost separately. Quality-gate-then-analyze happens on every
 * session, so paying that cost twice is a guaranteed, avoidable cost — not a hypothetical one.
 */
export function usePoseDetector(): SharedPoseDetector {
  const [status, setStatus] = useState<PoseDetectorStatus>('loading')
  const [detector, setDetector] = useState<PoseDetector | null>(null)

  const detectorRef = useRef<PoseDetector | null>(null)
  const detectorPromiseRef = useRef<Promise<PoseDetector> | null>(null)

  const getDetector = useCallback(async (): Promise<PoseDetector | null> => {
    if (detectorRef.current) return detectorRef.current
    if (!detectorPromiseRef.current) {
      detectorPromiseRef.current = createDetector(resolvePoseDetectorConfig())
    }
    try {
      const created = await detectorPromiseRef.current
      detectorRef.current = created
      return created
    } catch {
      // Detector creation failed (e.g. no WebGL). Fail open: report status: 'error' and
      // detector: null, so consumers (quality gate, analysis) can each degrade gracefully
      // rather than the whole app blocking on a detector that will never arrive.
      detectorPromiseRef.current = null
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await getDetector()
      if (cancelled) return
      if (result) {
        setDetector(result)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [getDetector])

  // Dispose the cached detector once, on unmount — not per-consumer.
  useEffect(() => {
    return () => {
      detectorRef.current?.dispose()
    }
  }, [])

  return { status, detector }
}
