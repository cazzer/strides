import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDetector } from './detector'
import type { PoseDetector } from './detector'
import type { ModelLoadPhase, ModelLoadState } from './modelLoadState'
import { resolvePoseDetectorConfig } from './poseBackendConfig'

/**
 * Exactly the union this was before — `'loading' | 'ready' | 'error'` — but derived from the shared
 * phase vocabulary rather than restated beside it, so the two cannot drift. `'idle'` is excluded
 * because this hook creates its detector on mount: there is no moment at which it is mounted and
 * has not started. The scale-pass detector is the lazy one, and it is the reason `'idle'` exists in
 * `ModelLoadPhase` at all.
 */
export type PoseDetectorStatus = Exclude<ModelLoadPhase, 'idle'>

export interface SharedPoseDetector {
  status: PoseDetectorStatus
  /** Non-null iff status === 'ready'. */
  detector: PoseDetector | null
  /**
   * The same `status`, plus an optional determinate byte reading, in the shape the application
   * header consumes for both detector owners (`strides-utn.1`). `progress` is `null` today and
   * `strides-utn.3` is what populates it — this hook builds the channel, not the fill. Identity is
   * stable between phase changes so a consumer can compare it by reference.
   */
  load: ModelLoadState
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

  // `progress` is deliberately a literal `null` rather than a piece of state nothing writes:
  // `strides-utn.1` builds the channel and `strides-utn.3` populates it, and a setter with no
  // caller would read as an oversight rather than as a seam. Memoised so the header sees a stable
  // identity between phase changes.
  const load = useMemo<ModelLoadState>(() => ({ phase: status, progress: null }), [status])

  return { status, detector, load }
}
