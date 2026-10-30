import { createMediaPipeOutlineSegmenter } from './backends/mediapipePoseLandmarker'
import type { OutlineSegmenter } from './backends/mediapipePoseLandmarker'

/**
 * The background outline pass's dedicated segmenter (`strides-uz48`) — module-cached for the page
 * lifetime, mirroring `scalePassDetector.ts`: lazy creation, one instance, the pending promise
 * reset on failure so the next run retries, and null on failure so the pass degrades to an
 * "unavailable" caveat instead of throwing. Its own instance, never the scale pass's: that one is
 * VIDEO mode without masks, and sharing would make one pass's timestamps the other's problem.
 *
 * No load-state channel: the `.task` is the scale pass's, already fetched and cached by the time
 * any outline pass runs, so there is no download here for a reader to wait on.
 */
let segmenterInstance: OutlineSegmenter | null = null
let segmenterPromise: Promise<OutlineSegmenter> | null = null

export async function getOutlineSegmenter(): Promise<OutlineSegmenter | null> {
  if (segmenterInstance) return segmenterInstance
  if (!segmenterPromise) segmenterPromise = createMediaPipeOutlineSegmenter()
  const attempted = segmenterPromise
  try {
    segmenterInstance = await attempted
    return segmenterInstance
  } catch {
    if (segmenterPromise === attempted) segmenterPromise = null
    return null
  }
}

/** Test-only: closes and forgets the cached segmenter. */
export function __disposeOutlineSegmenterForTests(): void {
  segmenterInstance?.close()
  segmenterInstance = null
  segmenterPromise = null
}
