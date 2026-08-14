import { createMoveNetDetector } from './backends/movenet'
import type { MoveNetModelType } from './backends/movenet'
import type { TrackingCropConfig } from './backends/trackingCropConfig'
import { createBlazePoseDetector } from './backends/blazepose'
import { createPoseNetDetector } from './backends/posenet'
import { createMediaPipePoseLandmarkerDetector } from './backends/mediapipePoseLandmarker'
import type { PoseFrame } from './types'

export type PoseBackendId = 'movenet' | 'blazepose' | 'posenet' | 'mediapipePoseLandmarker'

export interface PoseDetectorConfig {
  backend: PoseBackendId
  /** Only meaningful when backend: 'movenet'. Defaults to 'lightning'. */
  movenetModelType?: MoveNetModelType
  /** Only meaningful when backend: 'movenet'. Defaults to DEFAULT_TRACKING_CROP_CONFIG. */
  trackingCrop?: TrackingCropConfig
}

/**
 * One decoded/presented frame handed to a `PoseDetector`, decoupled from any single concrete
 * source element. `sampleClip.ts`'s `<video>`-playback path and `sampleClipSequential.ts`'s
 * WebCodecs `VideoFrame` path both funnel into this same shape — the latter draws each selected
 * `VideoFrame` onto a reusable offscreen `<canvas>` first, since `VideoFrame` has no common
 * ground with `HTMLVideoElement` that every backend's underlying library accepts (MoveNet's
 * `PixelInput` union has no `VideoFrame` variant at all). `timestampSec`/`width`/`height` are
 * pulled out explicitly rather than read off `image` because a canvas has no notion of "current
 * playback time" and, for the video path, `video.currentTime` and the frame actually presented to
 * `requestVideoFrameCallback` can differ by the time an `await` resolves.
 */
export interface PoseFrameSource {
  image: HTMLVideoElement | HTMLCanvasElement
  timestampSec: number
  width: number
  height: number
}

export interface PoseDetector {
  estimatePose(source: PoseFrameSource): Promise<PoseFrame | null>
  dispose(): void
}

/**
 * Wraps a `<video>` element into a `PoseFrameSource`, pulling `width`/`height` off the element's
 * own decoded dimensions. `timestampSec` defaults to `video.currentTime` but callers sampling off
 * `requestVideoFrameCallback` (`sampleClip.ts`) should pass the callback's own `metadata.mediaTime`
 * instead — the two can drift apart by the time an in-flight detection's `await` resolves.
 */
export function videoFrameSource(
  video: HTMLVideoElement,
  timestampSec: number = video.currentTime,
): PoseFrameSource {
  return { image: video, timestampSec, width: video.videoWidth, height: video.videoHeight }
}

const backends: Record<PoseBackendId, (config: PoseDetectorConfig) => Promise<PoseDetector>> = {
  movenet: (config) => createMoveNetDetector(config.movenetModelType, config.trackingCrop),
  blazepose: () => createBlazePoseDetector(),
  posenet: () => createPoseNetDetector(),
  mediapipePoseLandmarker: () => createMediaPipePoseLandmarkerDetector(),
}

// Intentionally not `async`: an async function can never throw synchronously to its
// caller (the throw would become a rejected Promise instead), and an unknown backend
// should fail fast, synchronously, before any async work begins.
export function createDetector(
  config: PoseDetectorConfig = { backend: 'movenet' },
): Promise<PoseDetector> {
  const createBackendDetector = backends[config.backend]
  if (!createBackendDetector) {
    throw new Error(`Unknown pose detector backend: ${config.backend}`)
  }
  return createBackendDetector(config)
}
