import type { PoseDetector } from '../pose/detector'
import type { PoseSample } from '../pose/robustness/types'

export interface SampleClipHandle {
  /**
   * Stops sampling and prevents any further `requestVideoFrameCallback` re-arming — wasted GPU
   * work should stop immediately on unmount or when a clip is superseded, unlike #6's
   * five-sample quality check where letting an in-flight assessment finish in the background was
   * an acceptable trade-off. Also settles the returned `promise` with whatever samples were
   * collected so far, rather than leaving it pending forever; the caller (`useVideoAnalysis`) is
   * expected to discard a resolution it no longer cares about via its own run-staleness check,
   * the same pattern `useVideoQualityGate` already uses for a superseded assessment.
   */
  stop: () => void
}

export interface SampleClipOptions {
  onProgress?: (fraction: number) => void
  onPausedChange?: (paused: boolean) => void
  /** Genuinely broken detector (e.g. lost WebGL context) vs. an isolated missed frame — this is
   * the threshold that distinguishes the two failure classes. Default 30. */
  maxConsecutiveErrors?: number
  /** A single `estimatePose` call that never settles (hangs) would otherwise leave `inFlight`
   * permanently non-null, silently halting all further sampling for the rest of the clip without
   * ever tripping `maxConsecutiveErrors` (which only counts rejections). This bounds any single
   * attempt so a hang degrades into a normal counted error instead of a silent full stop.
   * Default 5000ms. */
  detectionTimeoutMs?: number
}

export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 30
export const DEFAULT_DETECTION_TIMEOUT_MS = 5000

class DetectionTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new DetectionTimeoutError(`Detection timed out after ${ms}ms`)),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Plays `video` once at 1x and samples it via `requestVideoFrameCallback`, self-throttled to
 * whatever the detector can sustain: each callback either kicks off detection for the
 * just-presented frame (if the previous detection has already resolved) or drops the
 * just-presented frame and re-arms (if a detection is still in flight). This gives a sampling
 * density that adapts to detector throughput with zero manual interval math, at the cost of
 * being unable to guarantee any particular frame count — acceptable here since the consumer
 * (robustness + heuristics) already tolerates a gappy, irregularly-sampled `PoseSample[]/
 * RobustPoseFrame[]` by construction (#5).
 *
 * Per-frame detection errors are caught and skipped (recorded as `{ timestamp, frame: null }`)
 * rather than aborting sampling — matching `assessVideoQuality`'s `checkConfidence` precedent
 * (#6) of degrading rather than failing on an isolated miss. Only `maxConsecutiveErrors`
 * consecutive failures abort, since that many in a row indicates a broken detector, a
 * qualitatively different failure than noise on an individual frame.
 *
 * Does not call `video.play()` — that must happen synchronously in the same call chain as the
 * user's click, to satisfy browser autoplay policy, which puts it in the caller's hands
 * (`useVideoAnalysis.start()`), not here.
 */
export function sampleClip(
  video: HTMLVideoElement,
  detector: PoseDetector,
  durationSec: number,
  opts: SampleClipOptions = {},
): { promise: Promise<PoseSample[]>; handle: SampleClipHandle } {
  const {
    onProgress,
    onPausedChange,
    maxConsecutiveErrors = DEFAULT_MAX_CONSECUTIVE_ERRORS,
    detectionTimeoutMs = DEFAULT_DETECTION_TIMEOUT_MS,
  } = opts

  const samples: PoseSample[] = []
  let cancelled = false
  let settled = false
  let inFlight: Promise<void> | null = null
  let consecutiveErrors = 0
  let pendingHandle: number | null = null

  let resolvePromise!: (samples: PoseSample[]) => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<PoseSample[]>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const handlePause = () => onPausedChange?.(true)
  const handlePlay = () => onPausedChange?.(false)
  const handleEnded = () => finish()

  const cleanupListeners = () => {
    video.removeEventListener('pause', handlePause)
    video.removeEventListener('play', handlePlay)
    video.removeEventListener('ended', handleEnded)
  }

  // Cancels whatever `requestVideoFrameCallback` registration is currently outstanding so a
  // stopped/finished/aborted run can't fire one more time — belt-and-suspenders alongside the
  // `cancelled` guard inside `onFrame` itself.
  const cancelPendingCallback = () => {
    if (pendingHandle !== null) {
      video.cancelVideoFrameCallback(pendingHandle)
      pendingHandle = null
    }
  }

  function finish() {
    if (settled) return
    settled = true
    cancelled = true
    cancelPendingCallback()
    cleanupListeners()
    resolvePromise(samples)
  }

  function abort(error: Error) {
    if (settled) return
    settled = true
    cancelled = true
    cancelPendingCallback()
    cleanupListeners()
    rejectPromise(error)
  }

  video.addEventListener('pause', handlePause)
  video.addEventListener('play', handlePlay)
  video.addEventListener('ended', handleEnded, { once: true })

  const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
    pendingHandle = null
    if (cancelled) return

    if (!inFlight) {
      const t = metadata.mediaTime
      inFlight = withTimeout(detector.estimatePose(video), detectionTimeoutMs)
        .then((frame) => {
          // Cancellation can land between this attempt starting and settling (e.g. `stop()`
          // mid-detection) — `finish()`/`abort()` already resolved/rejected the outer promise
          // with a snapshot of `samples`, so a late push here would silently mutate an array
          // the caller may already treat as final.
          if (cancelled) return
          samples.push({ timestamp: t, frame })
          consecutiveErrors = 0
        })
        .catch(() => {
          if (cancelled) return
          samples.push({ timestamp: t, frame: null })
          consecutiveErrors += 1
          if (consecutiveErrors >= maxConsecutiveErrors) {
            abort(
              new Error(
                `Pose detection failed ${consecutiveErrors} times in a row — aborting sampling.`,
              ),
            )
          }
        })
        .finally(() => {
          inFlight = null
          if (!cancelled && durationSec > 0) {
            onProgress?.(Math.min(t / durationSec, 1))
          }
        })
    }

    if (!cancelled) {
      pendingHandle = video.requestVideoFrameCallback(onFrame)
    }
  }

  pendingHandle = video.requestVideoFrameCallback(onFrame)

  const handle: SampleClipHandle = {
    stop: () => {
      cancelled = true
      finish()
    },
  }

  return { promise, handle }
}
