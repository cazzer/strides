import '@tensorflow/tfjs-backend-webgl'
import * as tf from '@tensorflow/tfjs-core'
import * as poseDetection from '@tensorflow-models/pose-detection'
import type { PoseDetector, PoseFrameSource } from '../detector'
import type { PoseFrame } from '../types'
import { toPoseFrame } from './common'
import type { RawKeypoint } from './common'
import {
  computeAcquisitionScore,
  computeBoundingBoxIoU,
  computeCropRect,
  boundingBoxCenterDistance,
  deriveBoundingBox,
  isWithinProximityThreshold,
} from './movenetCrop'
import type { BoundingBoxPx, CropRectPx } from './movenetCrop'
import { DEFAULT_TRACKING_CROP_CONFIG } from './trackingCropConfig'
import type { TrackingCropConfig } from './trackingCropConfig'
import {
  DEFAULT_PERSON_OF_INTEREST_CONFIG,
  REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE,
} from './personOfInterestConfig'
import type { PersonOfInterestConfig } from './personOfInterestConfig'

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

interface Candidate {
  frame: PoseFrame
  box: BoundingBoxPx
}

/**
 * Maps a `MULTIPOSE_LIGHTNING` call's raw candidates to usable `{frame, box}` pairs, dropping any
 * candidate whose bounding box can't be derived (too few confident keypoints, same usability gate
 * `deriveBoundingBox` applies to the single-pose path) -- an unusable candidate can't be scored.
 */
function toUsableCandidates(
  poses: poseDetection.Pose[],
  currentTime: number,
  trackingCropConfig: TrackingCropConfig,
): Candidate[] {
  const candidates: Candidate[] = []
  for (const pose of poses) {
    const frame = toPoseFrame(pose.keypoints, currentTime)
    const box = deriveBoundingBox(
      frame.keypoints,
      trackingCropConfig.minKeypointConfidence,
      trackingCropConfig.minConfidentKeypoints,
    )
    if (box !== null) candidates.push({ frame, box })
  }
  return candidates
}

/** Acquisition heuristic (design.md's "Person-of-interest scoring"): highest bbox-area-weighted-
 * by-confidence score wins. `candidates` must be non-empty. */
function selectByAcquisitionHeuristic(candidates: Candidate[]): Candidate {
  return candidates.reduce((best, candidate) =>
    computeAcquisitionScore(candidate.box, candidate.frame.keypoints) >
    computeAcquisitionScore(best.box, best.frame.keypoints)
      ? candidate
      : best,
  )
}

/**
 * Reacquisition heuristic (design.md's "Person-of-interest scoring"): the candidate with the
 * highest nonzero IoU against `lastKnownBox` wins; if every candidate has zero IoU, the closest
 * candidate within `REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE * lastKnownBox`'s own side wins
 * instead; if none qualify there either, this call is treated as a fresh acquisition among the
 * same candidates. `candidates` must be non-empty.
 */
function selectByReacquisitionHeuristic(
  candidates: Candidate[],
  lastKnownBox: BoundingBoxPx,
): Candidate {
  let bestIoU = 0
  let bestIoUCandidate: Candidate | null = null
  for (const candidate of candidates) {
    const iou = computeBoundingBoxIoU(candidate.box, lastKnownBox)
    if (iou > bestIoU) {
      bestIoU = iou
      bestIoUCandidate = candidate
    }
  }
  if (bestIoUCandidate !== null) return bestIoUCandidate

  const withinProximity = candidates.filter((candidate) =>
    isWithinProximityThreshold(
      candidate.box,
      lastKnownBox,
      REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE,
    ),
  )
  if (withinProximity.length > 0) {
    return withinProximity.reduce((closest, candidate) =>
      boundingBoxCenterDistance(candidate.box, lastKnownBox) <
      boundingBoxCenterDistance(closest.box, lastKnownBox)
        ? candidate
        : closest,
    )
  }

  return selectByAcquisitionHeuristic(candidates)
}

/** What `rawDetector` was asked to do on the previous call -- the reset-timing state machine's
 * tri-state generalization of the old crop/full-frame boolean, adding 'none' for a call the
 * acquisition/reacquisition path (below) intercepted before `rawDetector` was ever invoked. */
type RawDetectorUsage = 'crop' | 'fullFrame' | 'none'

export async function createMoveNetDetector(
  modelType: MoveNetModelType = 'lightning',
  trackingCropConfig: TrackingCropConfig = DEFAULT_TRACKING_CROP_CONFIG,
  personOfInterestConfig: PersonOfInterestConfig = DEFAULT_PERSON_OF_INTEREST_CONFIG,
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
    throw new Error(
      'Failed to acquire a 2D canvas context for MoveNet crop-mode tracking',
    )
  }

  // The multi-pose acquisition/reacquisition detector: lazily created on first actual use
  // (`getMultiPoseDetector`, below), not here -- its own model download/init cost should only be
  // paid by a run that actually reaches an acquisition moment, not by every detector's cold
  // start. Memoized for this detector instance's lifetime; same lazy-create/memoize/
  // no-throw-on-failure shape as `scalePassDetector.ts`'s `getScalePassDetector`.
  let multiPoseDetector: Awaited<
    ReturnType<typeof poseDetection.createDetector>
  > | null = null
  let multiPoseDetectorPromise: ReturnType<
    typeof poseDetection.createDetector
  > | null = null

  async function getMultiPoseDetector(): Promise<Awaited<
    ReturnType<typeof poseDetection.createDetector>
  > | null> {
    if (multiPoseDetector) return multiPoseDetector
    if (!multiPoseDetectorPromise) {
      multiPoseDetectorPromise = poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        },
      )
    }
    const attempted = multiPoseDetectorPromise
    try {
      const created = await attempted
      multiPoseDetector = created
      return created
    } catch {
      // Creation failed (e.g. the model asset fetch failed) -- reset the pending promise so the
      // next acquisition attempt retries instead of awaiting a cached rejection forever. The
      // caller falls back to the single-pose path for this call (task 2.2); only forget OUR
      // attempt, a concurrent caller may already have installed a fresh one.
      if (multiPoseDetectorPromise === attempted)
        multiPoseDetectorPromise = null
      return null
    }
  }

  // Per-instance tracking state. `lastBoundingBox` is the seam between calls: non-null means "a
  // person is anchored, and this backend has an opinion about who they are." As of
  // `multi-person-acquisition` this exists unconditionally (design.md's "Unify anchor-tracking
  // state") rather than only while `trackingCropConfig.enabled` -- `trackingCropConfig.enabled`
  // now controls only whether an existing anchor is used to build a cropped inference canvas, not
  // whether an anchor exists at all. This detector instance is created once and cached for the
  // whole app lifetime (`usePoseDetector.ts`), reused across every clip analyzed in a session —
  // so this state outlives any single analysis run and must be guarded against both leaking
  // across runs (`lastSeenTime`, see the new-run check below) and a stale, late-resolving call
  // clobbering a newer one's progress (`generation`, see the reentrancy guard below).
  let lastBoundingBox: BoundingBoxPx | null = null
  let consecutiveLowConfidence = 0
  let previousRawDetectorUsage: RawDetectorUsage = 'fullFrame'
  let lastSeenTime: number | null = null
  let generation = 0

  /**
   * Increments the reacquisition-loss counter for a not-usable steady-state call -- unconditional
   * on crop-vs-full-frame (design.md's "Unify anchor-tracking state": the full-frame path had no
   * loss signal at all before this). When `personOfInterestConfig.enabled` is `false`, crossing
   * the threshold reproduces this backend's pre-existing behavior exactly: drop the anchor and
   * fall back to an ordinary full-frame call next time. When enabled, the anchor is deliberately
   * left in place -- it's the last-known position the reacquisition heuristic (below) scores
   * candidates against, and nulling it here would erase that signal at the exact moment it's
   * needed.
   */
  function registerTrackingLoss(): void {
    consecutiveLowConfidence += 1
    if (
      consecutiveLowConfidence >=
        trackingCropConfig.reacquisitionLossThreshold &&
      !personOfInterestConfig.enabled
    ) {
      lastBoundingBox = null
      consecutiveLowConfidence = 0
    }
  }

  return {
    async estimatePose(source: PoseFrameSource): Promise<PoseFrame | null> {
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
      if (
        lastSeenTime !== null &&
        currentTime < lastSeenTime - NEW_RUN_TIME_DROP_SEC
      ) {
        lastBoundingBox = null
        consecutiveLowConfidence = 0
        previousRawDetectorUsage = 'fullFrame'
        rawDetector.reset()
      }

      // Captured synchronously, before any `await` below, for the same reason `myGeneration`/
      // `currentTime` are: the reacquisition heuristic (below) reads this a second time after two
      // `await`s (detector creation, then detection itself), by which point a newer overlapping
      // call could already have mutated the live `lastBoundingBox` -- scoring against this
      // snapshot instead keeps a stale call's candidate selection self-consistent even if it
      // ultimately loses the reentrancy race below.
      const anchorBoxAtStart = lastBoundingBox
      const anchorMissing = anchorBoxAtStart === null
      const anchorStale =
        !anchorMissing &&
        consecutiveLowConfidence >=
          trackingCropConfig.reacquisitionLossThreshold
      let dispatchMultiPose =
        personOfInterestConfig.enabled && (anchorMissing || anchorStale)

      const multiPoseDet = dispatchMultiPose
        ? await getMultiPoseDetector()
        : null
      if (dispatchMultiPose && multiPoseDet === null) {
        // Multi-pose detector creation failed -- fall back to the ordinary single-pose full-frame
        // call below rather than surfacing a hard error (task 2.2), never regressing below this
        // backend's pre-existing baseline. An anchor that was merely stale (not missing) is
        // dropped too: without a multi-pose pass to re-disambiguate it, cropping around a
        // no-longer-trustworthy box is worse than falling back to full-frame. Guarded by the same
        // reentrancy check the rest of this function uses after an `await`: a newer call that
        // already ran to completion while this one awaited `getMultiPoseDetector()` may have
        // seeded a perfectly good, fresh anchor, which this stale call must not clobber.
        dispatchMultiPose = false
        if (myGeneration === generation) {
          lastBoundingBox = null
          consecutiveLowConfidence = 0
        }
      }

      const usingCrop =
        !dispatchMultiPose &&
        trackingCropConfig.enabled &&
        lastBoundingBox !== null
      const rawDetectorUsage: RawDetectorUsage = dispatchMultiPose
        ? 'none'
        : usingCrop
          ? 'crop'
          : 'fullFrame'

      // `rawDetector` is reused across calls, so its own internal cropRegion/smoothing-filter
      // state (computed relative to whatever canvas -- or absence of a call at all -- we left it
      // with last call) would otherwise fight our externally-computed framing at the moment
      // framing actually changes shape. Only the transition boundary needs it: for a same-size
      // square canvas across consecutive crop-mode calls, `initCropRegion` (see design.md's
      // Context) always resolves to full `[0,1]x[0,1]` coverage regardless of MoveNet's own stale
      // `cropRegion`, so resetting on every steady-tracking call would only cost MoveNet's
      // one-euro smoothing continuity for no correctness benefit. As of
      // `multi-person-acquisition`, the transition set also includes moving into or out of a call
      // the acquisition/reacquisition path intercepts entirely (`'none'`) -- otherwise
      // `rawDetector`'s state survives an acquisition/reacquisition event uncleared, and the next
      // steady-state call inherits it stale.
      if (rawDetectorUsage !== previousRawDetectorUsage) {
        rawDetector.reset()
      }

      // `sampleClip.ts` wraps every call in a timeout that, on expiry, moves on without
      // cancelling the underlying call — so a stalled call can still be pending when a newer one
      // starts on this same cached detector instance, sharing this closure's tracking state and
      // crop canvas. A stale call still returns whatever it detected below (matching this
      // detector's existing "always return what you got" contract) but must not let its
      // late-arriving result clobber a newer call's tracking-state progress.
      //
      // `previousRawDetectorUsage`/`lastSeenTime` must advance for *every* current call, not only
      // ones that found a usable detection -- otherwise a not-usable result would leave the
      // transition-detection state machine and the new-run clock stuck at whatever the last
      // successful call left them, corrupting the transition check for later calls even though
      // the video kept playing forward in the meantime.
      function commitCallProgress(usage: RawDetectorUsage): void {
        previousRawDetectorUsage = usage
        lastSeenTime = currentTime
      }

      if (dispatchMultiPose && multiPoseDet !== null) {
        const multiPoses = await multiPoseDet.estimatePoses(source.image)
        const isCurrent = myGeneration === generation
        const candidates = toUsableCandidates(
          multiPoses,
          currentTime,
          trackingCropConfig,
        )

        if (candidates.length === 0) {
          if (isCurrent) {
            lastBoundingBox = null
            consecutiveLowConfidence = 0
            commitCallProgress('none')
          }
          return null
        }

        const selected = anchorMissing
          ? selectByAcquisitionHeuristic(candidates)
          : selectByReacquisitionHeuristic(
              candidates,
              anchorBoxAtStart as BoundingBoxPx,
            )

        if (isCurrent) {
          lastBoundingBox = selected.box
          consecutiveLowConfidence = 0
          commitCallProgress('none')
        }

        return selected.frame
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
        poses = await rawDetector.estimatePoses(
          cropCanvas,
          undefined,
          currentTime * 1000,
        )
      } else {
        poses = await rawDetector.estimatePoses(source.image)
      }

      const isCurrent = myGeneration === generation

      if (poses.length === 0) {
        if (isCurrent) {
          registerTrackingLoss()
          commitCallProgress(usingCrop ? 'crop' : 'fullFrame')
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
          registerTrackingLoss()
        }
        commitCallProgress(usingCrop ? 'crop' : 'fullFrame')
      }

      return frame
    },
    dispose(): void {
      rawDetector.dispose()
      multiPoseDetector?.dispose()
    },
  }
}
