import { createDetector } from './detector'
import type { PoseDetector } from './detector'
import { IDLE_MODEL_LOAD_STATE } from './modelLoadState'
import type { ModelLoadState } from './modelLoadState'

/**
 * The background scale pass's dedicated detector (D2) — module-cached for the page lifetime,
 * mirroring `usePoseDetector`'s `getDetector` shape (lazy creation, instance cache, pending
 * promise reset on failure so the next run retries, null-on-failure so callers degrade instead
 * of throwing). Lives at module level rather than in a hook because a hook would tie a 9.4 MB
 * model plus a WASM runtime to a COMPONENT's lifetime, and a remount would pay for both again —
 * the whole point of the cache is amortizing that load across every analysis run on the page.
 *
 * It is nonetheless OBSERVABLE, via the plain publish/subscribe channel below (`strides-utn.1`).
 * This module's doc used to say "nothing re-renders on this detector's readiness", and that clause
 * is now false — deliberately. It described the product as it stood, not a property the design
 * requires, and that state of affairs was the bug: the reader waited on an unmentioned 9.4 MB fetch
 * while the UI said the clip was Ready. What has NOT changed is ownership. `getScalePassDetector`
 * is still the only creator and the only cache; subscribers only read, and subscribing does not
 * start a download. The channel touches no rendering library at all — the React adapter lives in
 * `useScalePassDetectorLoad.ts` precisely so this module cannot acquire a component lifetime by
 * accident. Full justification: `openspec/changes/model-load-visibility-and-cache/design.md` D3.
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

/** One object, replaced only on an actual transition — `useSyncExternalStore`'s `getSnapshot`
 * must be referentially stable between changes or it re-renders forever. */
let loadState: ModelLoadState = IDLE_MODEL_LOAD_STATE

export type ScalePassLoadListener = (state: ModelLoadState) => void

const loadListeners = new Set<ScalePassLoadListener>()

function sameLoadState(a: ModelLoadState, b: ModelLoadState): boolean {
  if (a.phase !== b.phase) return false
  if (a.progress === b.progress) return true
  if (!a.progress || !b.progress) return false
  return (
    a.progress.loadedBytes === b.progress.loadedBytes &&
    a.progress.totalBytes === b.progress.totalBytes
  )
}

/**
 * Publishes by VALUE, not by call: an equivalent state is dropped rather than handed out under a
 * fresh identity. Two callers racing one creation both reach the success branch and both announce
 * `'ready'`, and `useSyncExternalStore` compares snapshots with `Object.is` — so without this,
 * every such race costs a redundant re-render, and so would every repeated byte reading once
 * `strides-utn.3` starts publishing progress.
 */
function publishLoadState(next: ModelLoadState): void {
  if (sameLoadState(loadState, next)) return
  loadState = next
  // Iterate a copy: a listener that unsubscribes itself while being notified would otherwise
  // mutate the set mid-iteration.
  for (const listener of [...loadListeners]) listener(loadState)
}

/** The current model-load state of this detector — `'idle'` until something first requests it. */
export function getScalePassDetectorLoadState(): ModelLoadState {
  return loadState
}

/**
 * Observe this detector's model load. Returns an unsubscribe function.
 *
 * Subscribing is a pure read: it never creates a detector and never fetches a model asset. That is
 * the point — an observation channel that triggered the thing it observes would turn this lazy
 * 9.4 MB fetch into an eager one on every page load, which is the cost `strides-utn` explicitly
 * declined to take.
 */
export function subscribeToScalePassDetectorLoad(listener: ScalePassLoadListener): () => void {
  loadListeners.add(listener)
  return () => {
    loadListeners.delete(listener)
  }
}

export async function getScalePassDetector(): Promise<PoseDetector | null> {
  if (detectorInstance) return detectorInstance
  if (!detectorPromise) {
    detectorPromise = createDetector({ backend: 'mediapipePoseLandmarker' })
    // Announced only where an attempt is actually installed, so a second caller joining an
    // in-flight creation does not re-announce a transition that already happened.
    publishLoadState({ phase: 'loading', progress: null })
  }
  const attempted = detectorPromise
  try {
    const created = await attempted
    detectorInstance = created
    publishLoadState({ phase: 'ready', progress: null })
    return created
  } catch {
    // Creation failed (e.g. the WASM asset fetch failed). Reset the pending promise so the next
    // analysis run retries instead of awaiting a cached rejection forever; return null so the
    // caller marks its pass 'failed' and moves on — the primary result never depends on this.
    // Only forget OUR attempt: a concurrent caller may already have installed a fresh one.
    if (detectorPromise === attempted) {
      detectorPromise = null
      // Same guard, same reason: if a fresh attempt is already in flight, this stale rejection
      // must not overwrite its 'loading' with an 'error'.
      publishLoadState({ phase: 'error', progress: null })
    }
    return null
  }
}

/** Test-only: disposes and forgets the cached detector so unit tests can isolate module state.
 * Production code never disposes it — the cache is page-lifetime by design (see module doc).
 *
 * Resets the published load state to `'idle'` too, but deliberately does NOT clear the listener
 * set: listeners are owned by whoever subscribed, and a `renderHook` unmount already removes them.
 */
export function __disposeForTests(): void {
  detectorInstance?.dispose()
  detectorInstance = null
  detectorPromise = null
  publishLoadState(IDLE_MODEL_LOAD_STATE)
}
