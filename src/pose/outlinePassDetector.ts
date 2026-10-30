import { createMediaPipeOutlineSegmenter } from './backends/mediapipePoseLandmarker'
import type { OutlineSegmenter } from './backends/mediapipePoseLandmarker'

/**
 * The background outline pass's dedicated segmenter (`strides-uz48`): lazy creation, one shared
 * instance, the pending promise reset on failure so the next run retries, and null on failure so
 * the pass degrades to an "unavailable" caveat instead of throwing. Its own instance, never the
 * scale pass's: that one is VIDEO mode without masks, and sharing would make one pass's
 * timestamps the other's problem.
 *
 * Unlike the scale pass's detector it is NOT page-lifetime: a second MediaPipe GPU graph is only
 * worth keeping resident while outline passes are running. Each pass acquires it and releases it
 * when done; once nothing holds it for `OUTLINE_SEGMENTER_IDLE_CLOSE_MS` it is closed, and the next
 * pass creates it again (the `.task` bytes come from the model cache, so recreation costs the
 * graph build alone, ~65 ms measured). The idle delay lets a session's back-to-back outline passes
 * share one instance.
 *
 * No load-state channel: the `.task` is the scale pass's, already fetched and cached by the time
 * any outline pass runs, so there is no download here for a reader to wait on.
 */
export const OUTLINE_SEGMENTER_IDLE_CLOSE_MS = 5000

let segmenterInstance: OutlineSegmenter | null = null
let segmenterPromise: Promise<OutlineSegmenter> | null = null
let holders = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null

function cancelIdleClose(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = null
}

function closeSegmenter(): void {
  segmenterInstance?.close()
  segmenterInstance = null
  segmenterPromise = null
}

/** Acquires the segmenter for one outline pass. Every call must be paired with
 * `releaseOutlineSegmenter()`, whether or not it resolved to a segmenter. */
export async function getOutlineSegmenter(): Promise<OutlineSegmenter | null> {
  holders += 1
  cancelIdleClose()
  if (segmenterInstance) return segmenterInstance
  if (!segmenterPromise) segmenterPromise = createMediaPipeOutlineSegmenter()
  const attempted = segmenterPromise
  try {
    const created = await attempted
    // Closed by an idle timer while this creation was in flight cannot happen (a holder cancels
    // it), but a stale attempt replaced by a fresh one must not overwrite the fresh instance.
    if (segmenterPromise === attempted) segmenterInstance = created
    return created
  } catch {
    if (segmenterPromise === attempted) segmenterPromise = null
    return null
  }
}

/** Ends one pass's hold; the last release starts the idle close. */
export function releaseOutlineSegmenter(): void {
  holders = Math.max(0, holders - 1)
  if (holders > 0) return
  cancelIdleClose()
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (holders === 0) closeSegmenter()
  }, OUTLINE_SEGMENTER_IDLE_CLOSE_MS)
}

/** Test-only: closes and forgets the cached segmenter and every hold. */
export function __disposeOutlineSegmenterForTests(): void {
  cancelIdleClose()
  holders = 0
  closeSegmenter()
}
