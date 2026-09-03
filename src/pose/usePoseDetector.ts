import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDetector } from './detector'
import type { PoseDetector } from './detector'
import { aggregateModelAssetProgress } from './modelAssetCache'
import type { ModelLoadPhase, ModelLoadProgress, ModelLoadState } from './modelLoadState'
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
   * header consumes for both detector owners (`strides-utn.1`). Identity is stable between
   * transitions so a consumer can compare it by reference.
   *
   * `progress` is populated for whichever model assets this hook's backend routes through
   * `fetchModelAsset` (`strides-utn.3`). On the default MoveNet backend that is none of them yet —
   * `strides-utn.4` routes its weights — so the reading stays `null`, which is the honest value
   * for a download nobody is measuring rather than a placeholder.
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
  const [progress, setProgress] = useState<ModelLoadProgress | null>(null)
  const [detector, setDetector] = useState<PoseDetector | null>(null)

  const detectorRef = useRef<PoseDetector | null>(null)
  const detectorPromiseRef = useRef<Promise<PoseDetector> | null>(null)

  const getDetector = useCallback(async (): Promise<PoseDetector | null> => {
    if (detectorRef.current) return detectorRef.current
    if (!detectorPromiseRef.current) {
      detectorPromiseRef.current = createDetector(resolvePoseDetectorConfig(), {
        onAssetProgress: aggregateModelAssetProgress(setProgress),
      })
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
      // Nothing is in flight any more, so there is no determinate reading to hold: `progress`
      // describes a download that is happening, and keeping the last one would leave a settled
      // state carrying a stale percentage for the header to render.
      setProgress(null)
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

  // Memoised so the header sees a stable identity between transitions, not a fresh object per
  // render — `App` re-renders on every phase change of either owner.
  const load = useMemo<ModelLoadState>(() => ({ phase: status, progress }), [status, progress])

  return { status, detector, load }
}
