import { createDetector } from './detector'
import type { PoseDetector } from './detector'

/**
 * The background scale pass's dedicated detector (D2) — module-cached for the page lifetime,
 * mirroring `usePoseDetector`'s `getDetector` shape (lazy creation, instance cache, pending
 * promise reset on failure so the next run retries, null-on-failure so callers degrade instead
 * of throwing). Lives at module level rather than in a hook because the scale pass is not a
 * render concern: nothing re-renders on this detector's readiness, and the whole point of the
 * cache is amortizing MediaPipe's WASM/model load across every analysis run on the page — a
 * per-pass create/dispose cycle would pay it every time.
 *
 * Deliberately NEVER reads `resolvePoseDetectorConfig()` (or the
 * `__STRIDES_POSE_BACKEND_OVERRIDE__` global behind it): that override selects the PRIMARY
 * pass's backend only. The scale pass's backend is not configurable — it exists specifically
 * because MediaPipe Pose Landmarker is the one backend that measures a real-world scale, so a
 * "configurable" backend here could only ever be a misconfiguration. The mediapipe-primary
 * override case is handled upstream instead, as the `'primary-scale'` skip in
 * `useVideoAnalysis.ts` (the pass never runs when the primary already carried scale).
 */
let detectorInstance: PoseDetector | null = null
let detectorPromise: Promise<PoseDetector> | null = null

export async function getScalePassDetector(): Promise<PoseDetector | null> {
  if (detectorInstance) return detectorInstance
  if (!detectorPromise) {
    detectorPromise = createDetector({ backend: 'mediapipePoseLandmarker' })
  }
  try {
    const created = await detectorPromise
    detectorInstance = created
    return created
  } catch {
    // Creation failed (e.g. the WASM asset fetch failed). Reset the pending promise so the next
    // analysis run retries instead of awaiting a cached rejection forever; return null so the
    // caller marks its pass 'failed' and moves on — the primary result never depends on this.
    detectorPromise = null
    return null
  }
}

/** Test-only: disposes and forgets the cached detector so unit tests can isolate module state.
 * Production code never disposes it — the cache is page-lifetime by design (see module doc). */
export function __disposeForTests(): void {
  detectorInstance?.dispose()
  detectorInstance = null
  detectorPromise = null
}
