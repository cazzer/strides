import '@tensorflow/tfjs-backend-webgl'
import * as tf from '@tensorflow/tfjs-core'
import * as poseDetection from '@tensorflow-models/pose-detection'
import type { PoseDetector, PoseFrameSource } from '../detector'
import type { PoseFrame } from '../types'
import { toPoseFrame } from './common'
import type { RawKeypoint } from './common'
import { computeCropRect, deriveBoundingBox } from './movenetCrop'
import type { BoundingBoxPx, CropRectPx } from './movenetCrop'
import { DEFAULT_TRACKING_CROP_CONFIG } from './trackingCropConfig'
import type { TrackingCropConfig } from './trackingCropConfig'

export type MoveNetModelType = 'lightning' | 'thunder'

const MOVENET_MODEL_TYPES: Record<MoveNetModelType, string> = {
  lightning: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
  thunder: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
}

/**
 * MoveNet's own fixed model-input resolution per variant, read directly from the installed
 * `@tensorflow-models/pose-detection` package's `movenet/constants.js`
 * (`MOVENET_SINGLEPOSE_LIGHTNING_RESOLUTION`/`MOVENET_SINGLEPOSE_THUNDER_RESOLUTION` — not part of
 * its public `.d.ts`). Used only to size the reusable crop canvas so that MoveNet's own internal
 * crop-region tracking degenerates to a full-coverage no-op against it (see `estimatePose`'s
 * crop-mode branch and design.md's Context) — exact value match isn't load-bearing for
 * correctness, only efficiency; any square canvas produces the same no-op.
 */
const MODEL_INPUT_RESOLUTION: Record<MoveNetModelType, number> = {
  lightning: 192,
  thunder: 256,
}

/**
 * How far `video.currentTime` must drop below the highest value this detector instance has seen
 * to count as "a new run started", not just ordinary backward jitter within one run (see
 * `estimatePose`'s new-run check). `usePoseDetector.ts` caches one detector instance for the
 * whole app lifetime, reused across every clip a user analyzes in a session — real clip restarts
 * jump from wherever the previous run's tracking left off back to ~0, a drop far larger than any
 * plausible single-frame timing jitter.
 */
const NEW_RUN_TIME_DROP_SEC = 0.5

/** Remaps keypoint coordinates from crop-canvas pixel space back to source-video pixel space. */
function toVideoSpaceKeypoints(
  keypoints: RawKeypoint[],
  cropRect: CropRectPx,
  targetInputSize: number,
): RawKeypoint[] {
  return keypoints.map((k) => ({
    ...k,
    x: cropRect.x + (k.x / targetInputSize) * cropRect.side,
    y: cropRect.y + (k.y / targetInputSize) * cropRect.side,
  }))
}

export async function createMoveNetDetector(
  modelType: MoveNetModelType = 'lightning',
  trackingCropConfig: TrackingCropConfig = DEFAULT_TRACKING_CROP_CONFIG,
): Promise<PoseDetector> {
  await tf.setBackend('webgl')
  await tf.ready()

  const rawDetector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: MOVENET_MODEL_TYPES[modelType] },
  )

  const targetInputSize = MODEL_INPUT_RESOLUTION[modelType]
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = targetInputSize
  cropCanvas.height = targetInputSize
  const cropCtx = cropCanvas.getContext('2d')
  if (!cropCtx) {
    throw new Error('Failed to acquire a 2D canvas context for MoveNet crop-mode tracking')
  }

  // Per-instance tracking state. `lastBoundingBox` is the seam between calls: non-null means
  // "the previous call produced a usable detection, try a crop centered on it next call."
  // This detector instance is created once and cached for the whole app lifetime
  // (`usePoseDetector.ts`), reused across every clip analyzed in a session — so this state
  // outlives any single analysis run and must be guarded against both leaking across runs
  // (`lastSeenTime`, see the new-run check below) and a stale, late-resolving call clobbering a
  // newer one's progress (`generation`, see the reentrancy guard below).
  let lastBoundingBox: BoundingBoxPx | null = null
  let consecutiveLowConfidence = 0
  let previousCallUsedCrop = false
  let lastSeenTime: number | null = null
  let generation = 0

  /** Increments/checks the reacquisition-loss counter; no-op unless the failing call was crop-mode. */
  function registerTrackingLoss(usingCrop: boolean): void {
    if (!usingCrop) return
    consecutiveLowConfidence += 1
    if (consecutiveLowConfidence >= trackingCropConfig.reacquisitionLossThreshold) {
      lastBoundingBox = null
      consecutiveLowConfidence = 0
    }
  }

  return {
    async estimatePose(source: PoseFrameSource): Promise<PoseFrame | null> {
      // Total kill-switch: no tracking state read or written, byte-identical to the pre-existing
      // full-frame-only implementation.
      if (!trackingCropConfig.enabled) {
        const poses = await rawDetector.estimatePoses(source.image)
        if (poses.length === 0) return null
        return toPoseFrame(poses[0].keypoints, source.timestampSec)
      }

      // Every call captures its own generation and reads the source's timestamp once,
      // synchronously, before any `await` — both the new-run check below and the reentrancy guard
      // after the detection call rely on this snapshot being consistent for the lifetime of this
      // call.
      const myGeneration = ++generation
      const currentTime = source.timestampSec

      // A new analysis run (a different clip, or the same clip replayed) always starts playback
      // near 0 — lower than wherever the previous run's tracking left off — since this detector
      // instance is reused across runs. Without this check, a new run's opening frames would
      // crop against a bounding box left over from the *previous* clip until
      // `reacquisitionLossThreshold` more frames happened to fall back correctly.
      if (lastSeenTime !== null && currentTime < lastSeenTime - NEW_RUN_TIME_DROP_SEC) {
        lastBoundingBox = null
        consecutiveLowConfidence = 0
        previousCallUsedCrop = false
        rawDetector.reset()
      }

      const usingCrop = lastBoundingBox !== null
      const isModeTransition = usingCrop !== previousCallUsedCrop

      // `rawDetector` is reused across calls, so its own internal cropRegion/smoothing-filter
      // state (computed relative to whatever canvas we handed it last call) would otherwise
      // fight our externally-computed, differently-framed crop at the moment framing actually
      // changes shape (full-frame video <-> square crop canvas). Only the transition boundary
      // needs it: for a same-size square canvas across consecutive crop-mode calls,
      // `initCropRegion` (see design.md's Context) always resolves to full `[0,1]x[0,1]`
      // coverage regardless of MoveNet's own stale `cropRegion`, so resetting on every
      // steady-tracking call would only cost MoveNet's one-euro smoothing continuity for no
      // correctness benefit.
      if (isModeTransition) {
        rawDetector.reset()
      }

      let cropRect: CropRectPx | null = null
      let poses: Awaited<ReturnType<typeof rawDetector.estimatePoses>>

      if (usingCrop) {
        cropRect = computeCropRect(
          lastBoundingBox as BoundingBoxPx,
          source.width,
          source.height,
          trackingCropConfig.paddingMultiplier,
          trackingCropConfig.minCropSidePx,
        )
        cropCtx.drawImage(
          source.image,
          cropRect.x,
          cropRect.y,
          cropRect.side,
          cropRect.side,
          0,
          0,
          targetInputSize,
          targetInputSize,
        )
        poses = await rawDetector.estimatePoses(cropCanvas, undefined, currentTime * 1000)
      } else {
        poses = await rawDetector.estimatePoses(source.image)
      }

      // `sampleClip.ts` wraps every call in a timeout that, on expiry, moves on without
      // cancelling the underlying call — so a stalled call can still be pending when a newer one
      // starts on this same cached detector instance, sharing this closure's tracking state and
      // crop canvas. A stale call still returns whatever it detected below (matching this
      // detector's existing "always return what you got" contract) but must not let its
      // late-arriving result clobber a newer call's tracking-state progress.
      const isCurrent = myGeneration === generation

      // `previousCallUsedCrop`/`lastSeenTime` must advance for *every* current call, not only
      // ones that found a usable detection -- otherwise a `poses: []` result (or a low-confidence
      // one) would leave the transition-detection state machine and the new-run clock stuck at
      // whatever the last successful call left them, corrupting `isModeTransition` for later
      // calls even though the video kept playing forward in the meantime.
      function commitCallProgress(): void {
        previousCallUsedCrop = usingCrop
        lastSeenTime = currentTime
      }

      if (poses.length === 0) {
        if (isCurrent) {
          registerTrackingLoss(usingCrop)
          commitCallProgress()
        }
        return null
      }

      const rawKeypoints = cropRect
        ? toVideoSpaceKeypoints(poses[0].keypoints, cropRect, targetInputSize)
        : poses[0].keypoints
      const frame = toPoseFrame(rawKeypoints, currentTime)

      if (isCurrent) {
        const derived = deriveBoundingBox(
          frame.keypoints,
          trackingCropConfig.minKeypointConfidence,
          trackingCropConfig.minConfidentKeypoints,
        )
        if (derived !== null) {
          lastBoundingBox = derived
          consecutiveLowConfidence = 0
        } else {
          registerTrackingLoss(usingCrop)
        }
        commitCallProgress()
      }

      return frame
    },
    dispose(): void {
      rawDetector.dispose()
    },
  }
}
