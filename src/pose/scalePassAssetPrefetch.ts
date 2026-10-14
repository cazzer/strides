import { resolveMediaPipePoseLandmarkerAssetUrls } from './backends/mediapipePoseLandmarker'

/**
 * Fetches the background scale pass's MediaPipe assets (WASM loader + binary, `.task` model —
 * ~12 MB over the wire) into the browser's HTTP cache ahead of time, so the scale pass's own
 * detector creation later reads them from cache instead of starting the download only once a
 * clip is already being analysed.
 *
 * BYTES ONLY. This never creates a detector: creation is main-thread/GPU work that costs the
 * real-time playback sampler frames (strides-gyl), and it stays where `useVideoAnalysis` puts it.
 *
 * The transfer itself can also cost the playback sampler frames on a slow link — measured on the
 * unmerged strides-noo prefetch: 2 of 60 at 8 Mbps — and leaving a body unread does NOT stop it
 * arriving in Chromium, so only aborting the request does. `cancelScalePassAssetPrefetch` is
 * therefore called the moment a playback-path analysis starts. The sequential (WebCodecs) sampler
 * reads every frame regardless of wall-clock, so a transfer overlapping it changes timing only,
 * never a measurement, and is left to finish.
 */

let controller: AbortController | null = null
let started = false

export function prefetchScalePassAssets(): void {
  if (started) return
  started = true
  const own = new AbortController()
  controller = own
  void (async () => {
    try {
      const urls = await resolveMediaPipePoseLandmarkerAssetUrls()
      await Promise.all(
        urls.map(async (url) => {
          if (own.signal.aborted) return
          const response = await fetch(url, { priority: 'low', signal: own.signal })
          // Drain without holding the bytes: the HTTP cache keeps a body only once it completes.
          await response.body?.pipeTo(new WritableStream(), { signal: own.signal })
        }),
      )
    } catch {
      // Best effort: a failed or aborted prefetch leaves detector creation to fetch as before.
    } finally {
      if (controller === own) controller = null
    }
  })()
}

/** Aborts any in-flight prefetch. A completed prefetch has nothing left to abort. */
export function cancelScalePassAssetPrefetch(): void {
  controller?.abort()
  controller = null
}

/** Test-only: forget that a prefetch was started. */
export function resetScalePassAssetPrefetchForTests(): void {
  cancelScalePassAssetPrefetch()
  started = false
}
