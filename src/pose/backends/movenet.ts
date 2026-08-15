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
  /** `null` when this candidate failed the usability gate (too few confident keypoints) --
   * still carried through rather than dropped, so a call where every candidate is unusable can
   * still return the best raw one instead of `null` (see `pickBestCandidate`). */
  box: BoundingBoxPx | null
  /** MoveNet's own overall per-pose confidence -- the only ranking signal available for a
   * candidate whose `box` is `null`. */
  poseScore: number
}

/**
 * Maps a `MULTIPOSE_LIGHTNING` call's raw candidates to `{frame, box, poseScore}` triples.
 * Deliberately does NOT drop candidates that fail the usability gate (`box: null`) -- doing so
 * would make "every candidate is unusable" indistinguishable from "no candidates at all", which
 * would violate this backend's "always return a frame, usability only controls tracking state"
 * invariant (the single-pose path already honors this; see `pickBestCandidate`).
 *
 * Reuses `trackingCropConfig.minKeypointConfidence`/`minConfidentKeypoints` as the per-candidate
 * usability gate rather than a separate multi-pose-specific pair: "is this detection usable" is
 * the same question regardless of which detector produced it, and design.md's "one shared
 * threshold, not two" reasoning for `reacquisitionLossThreshold` applies here too -- a second,
 * independently-tunable confidence pair for the multi-pose path would only drift out of sync with
 * the single-pose path's own gate over time.
 */
function toCandidates(
  poses: poseDetection.Pose[],
  currentTime: number,
  trackingCropConfig: TrackingCropConfig,
): Candidate[] {
  return poses.map((pose) => {
    const frame = toPoseFrame(pose.keypoints, currentTime)
    const box = deriveBoundingBox(
      frame.keypoints,
      trackingCropConfig.minKeypointConfidence,
      trackingCropConfig.minConfidentKeypoints,
    )
    return { frame, box, poseScore: pose.score ?? 0 }
  })
}

/** Acquisition heuristic (design.md's "Person-of-interest scoring"): highest bbox-area-weighted-
 * by-confidence score wins. `candidates` must be non-empty and every `box` non-null. */
function selectByAcquisitionHeuristic(
  candidates: (Candidate & { box: BoundingBoxPx })[],
): Candidate {
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
 * same candidates. `candidates` must be non-empty and every `box` non-null.
 *
 * `continuous: false` on the acquisition-heuristic-fallback branch means the selected candidate
 * is NOT the same person as `lastKnownBox` (both the IoU and proximity checks rejected it) --
 * the caller uses this to reset `rawDetector`'s own internal state (which may still be tracking
 * the OLD, rejected person) and to avoid burning the one-shot give-up budget (see estimatePose's
 * `anchorWasReacquired`/`rawDetector.reset()` handling, review items NEW-1/NEW-2).
 */
function selectByReacquisitionHeuristic(
  candidates: (Candidate & { box: BoundingBoxPx })[],
  lastKnownBox: BoundingBoxPx,
): { candidate: Candidate; continuous: boolean } {
  let bestIoU = 0
  let bestIoUCandidate: (Candidate & { box: BoundingBoxPx }) | null = null
  for (const candidate of candidates) {
    const iou = computeBoundingBoxIoU(candidate.box, lastKnownBox)
    if (iou > bestIoU) {
      bestIoU = iou
      bestIoUCandidate = candidate
    }
  }
  if (bestIoUCandidate !== null) {
    return { candidate: bestIoUCandidate, continuous: true }
  }

  const withinProximity = candidates.filter((candidate) =>
    isWithinProximityThreshold(
      candidate.box,
      lastKnownBox,
      REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE,
    ),
  )
  if (withinProximity.length > 0) {
    const closest = withinProximity.reduce((closest, candidate) =>
      boundingBoxCenterDistance(candidate.box, lastKnownBox) <
      boundingBoxCenterDistance(closest.box, lastKnownBox)
        ? candidate
        : closest,
    )
    return { candidate: closest, continuous: true }
  }

  return {
    candidate: selectByAcquisitionHeuristic(candidates),
    continuous: false,
  }
}

/**
 * Picks one candidate from a non-empty `MULTIPOSE_LIGHTNING` result, honoring "always return a
 * frame, usability only controls tracking state" (movenet.test.ts's own stated invariant for the
 * single-pose path, item #2 of the multi-person-acquisition review): candidates that clear the
 * usability gate (`box !== null`) are scored by the acquisition/reacquisition heuristics as
 * before; if NONE clear it, the raw candidate with the highest MoveNet-native `poseScore` is
 * returned instead of resolving `null` for the whole call. `usable: false` tells the caller not
 * to treat the result as a trustworthy anchor (same meaning as `derived === null` on the
 * single-pose path). `continuous` is only meaningful for a reacquisition call whose result is
 * `usable` -- `false` in every other case (fresh acquisition, or not usable at all), since
 * "continuous with the previous anchor" isn't a coherent question there.
 */
function pickBestCandidate(
  candidates: Candidate[],
  anchorMissing: boolean,
  lastKnownBox: BoundingBoxPx | null,
): { candidate: Candidate; usable: boolean; continuous: boolean } {
  const boxed = candidates.filter(
    (c): c is Candidate & { box: BoundingBoxPx } => c.box !== null,
  )
  if (boxed.length > 0) {
    if (anchorMissing || lastKnownBox === null) {
      return {
        candidate: selectByAcquisitionHeuristic(boxed),
        usable: true,
        continuous: false,
      }
    }
    const { candidate, continuous } = selectByReacquisitionHeuristic(
      boxed,
      lastKnownBox,
    )
    return { candidate, usable: true, continuous }
  }

  const bestRaw = candidates.reduce((best, c) =>
    c.poseScore > best.poseScore ? c : best,
  )
  return { candidate: bestRaw, usable: false, continuous: false }
}

/**
 * How many consecutive reacquisition-dispatch calls may come up with no usable candidate at all
 * (zero raw poses, or poses but none clearing the usability gate) before giving up on this
 * anchor entirely, rather than retrying forever while the subject is simply absent from frame.
 * Reuses `TrackingCropConfig.reacquisitionLossThreshold` — same magnitude as "how long we wait
 * before first declaring an anchor stale" is a reasonable, already-tuned-by-convention budget for
 * "how long we keep trying to get it back", not a fresh independently-tunable number.
 */
function reacquisitionMissBudget(
  trackingCropConfig: TrackingCropConfig,
): number {
  return trackingCropConfig.reacquisitionLossThreshold
}

/** What `rawDetector` was asked to do on the previous call that actually invoked it. Calls
 * intercepted entirely by the acquisition/reacquisition path never invoke `rawDetector` at all,
 * so they're transparent to this state -- see the reset-timing comment in `estimatePose`. */
type RawDetectorUsage = 'crop' | 'fullFrame'

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
  // start. Memoized for this detector instance's lifetime; same lazy-create/memoize shape as
  // `scalePassDetector.ts`'s `getScalePassDetector`, but with per-RUN (not per-instance) failure
  // caching -- see `multiPoseCreationFailedThisRun` -- since `getScalePassDetector` only ever
  // needs per-instance memoization (it isn't invoked from inside a tight per-frame sampling loop
  // the way this is).
  let multiPoseDetector: Awaited<
    ReturnType<typeof poseDetection.createDetector>
  > | null = null
  let multiPoseDetectorPromise: ReturnType<
    typeof poseDetection.createDetector
  > | null = null

  // Set once creation has failed for the current run, so a whole clip's worth of remaining
  // frames don't each re-attempt (and re-await) the same doomed model fetch -- reset alongside
  // the rest of this run's tracking state on new-run detection, below. NOTE: whether the
  // multi-pose model's cold-start fetch should be kicked off *before* frame sampling begins,
  // rather than on the first acquisition call mid-sampling-loop, is a separate, larger question
  // this fix does not attempt -- see the review discussion this change responds to.
  let multiPoseCreationFailedThisRun = false

  async function getMultiPoseDetector(): Promise<Awaited<
    ReturnType<typeof poseDetection.createDetector>
  > | null> {
    if (multiPoseDetector) return multiPoseDetector
    if (multiPoseCreationFailedThisRun) return null
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
      // Creation failed (e.g. the model asset fetch failed) -- cache the failure for the rest of
      // this run (see `multiPoseCreationFailedThisRun`'s doc) rather than retrying every frame,
      // and forget the pending promise so a *future* run gets a clean retry. Only forget OUR
      // attempt: a concurrent caller may already have installed a fresh one.
      if (multiPoseDetectorPromise === attempted)
        multiPoseDetectorPromise = null
      multiPoseCreationFailedThisRun = true
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

  // Whether the CURRENT anchor has already been through one successful reacquisition since it
  // was last freshly established via acquisition. Gates the "give up" rule below (item #4 of the
  // review this responds to): a fresh anchor gets one reacquisition attempt if it goes stale;
  // if THAT reacquired anchor also goes stale, we stop re-disambiguating and fall back to the
  // plain, undisambiguated single-pose path (`personOfInterestSuspended`) instead of looping
  // reacquisition-succeeds/loses-again forever against a scene the heuristic can't actually
  // resolve (e.g. the real subject is gone and only a bystander remains for the acquisition
  // fallback to repeatedly "successfully" reacquire).
  let anchorWasReacquired = false

  // How many consecutive reacquisition-dispatch calls in the CURRENT reacquisition episode have
  // come up with no usable candidate (zero raw poses, or none clearing the usability gate). See
  // `reacquisitionMissBudget` -- bounded, not unlimited, so a genuinely absent subject doesn't
  // pin the anchor (and keep paying for multi-pose calls) forever.
  let consecutiveEmptyReacquisitions = 0

  // Set when this run has given up on multi-pose disambiguation (see `anchorWasReacquired`'s
  // doc and the exhausted-miss-budget case below) -- suppresses acquisition/reacquisition
  // dispatch entirely until an ordinary single-pose detection re-establishes a confident anchor
  // on its own, at which point normal dynamics (including a fresh acquisition/reacquisition cycle
  // if THAT anchor is later lost) resume.
  let personOfInterestSuspended = false

  /** Clears all anchor and multi-pose-episode state -- used both for a genuine "no one is
   * trackable" reset and as the internals of "giving up" (which additionally suspends
   * multi-pose dispatch, see call sites). */
  function clearAnchor(): void {
    lastBoundingBox = null
    consecutiveLowConfidence = 0
    anchorWasReacquired = false
    consecutiveEmptyReacquisitions = 0
  }

  /**
   * Increments the reacquisition-loss counter for a not-usable steady-state call -- unconditional
   * on crop-vs-full-frame (design.md's "Unify anchor-tracking state": the full-frame path had no
   * loss signal at all before this). When `personOfInterestConfig.enabled` is `false`, crossing
   * the threshold reproduces this backend's pre-existing behavior exactly: drop the anchor and
   * fall back to an ordinary full-frame call next time. When enabled, the anchor is deliberately
   * left in place -- it's the last-known position the reacquisition heuristic (below) scores
   * candidates against, and clearing it here would erase that signal at the exact moment it's
   * needed; the dispatch check at the top of the next call routes to reacquisition instead.
   */
  function registerTrackingLoss(): void {
    consecutiveLowConfidence += 1
    if (
      consecutiveLowConfidence >=
        trackingCropConfig.reacquisitionLossThreshold &&
      !personOfInterestConfig.enabled
    ) {
      clearAnchor()
    }
  }

  return {
    async estimatePose(source: PoseFrameSource): Promise<PoseFrame | null> {
      // True byte-for-byte kill-switch, matching this backend's behavior before
      // `multi-person-acquisition` existed: no generation bookkeeping, no new-run check, no
      // crop-mode tracking state read or written, no `rawDetector.reset()` ever. This is the ONE
      // config combination that had special-cased behavior before this capability existed
      // (`trackingCropConfig.enabled: false` alone) -- personOfInterest didn't exist yet, so its
      // disabled state is the "doesn't exist" state, and both together must reproduce that exact
      // pre-existing path (task 6.1's "byte-identical to pre-change behavior" guarantee).
      if (!trackingCropConfig.enabled && !personOfInterestConfig.enabled) {
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
      if (
        lastSeenTime !== null &&
        currentTime < lastSeenTime - NEW_RUN_TIME_DROP_SEC
      ) {
        clearAnchor()
        personOfInterestSuspended = false
        multiPoseCreationFailedThisRun = false
        previousRawDetectorUsage = 'fullFrame'
        rawDetector.reset()
      }

      // Captured synchronously, before any `await` below: both `anchorBoxAtStart` (the
      // reacquisition heuristic's scoring target) and the crop-vs-full-frame framing decision for
      // THIS call are derived from this snapshot, not from `lastBoundingBox` re-read after an
      // `await` -- a newer overlapping call (`sampleClip.ts`'s per-frame timeout lets calls
      // overlap, see the reentrancy guard below) could otherwise mutate the live value in
      // between, corrupting a stale call's own framing/scoring or, worse, letting a stale call's
      // late failure clobber a newer call's progress.
      const anchorBoxAtStart = lastBoundingBox
      const anchorMissing = anchorBoxAtStart === null
      const anchorStale =
        !anchorMissing &&
        consecutiveLowConfidence >=
          trackingCropConfig.reacquisitionLossThreshold

      // "Give up" (review item #4): an anchor that has ALREADY been through one successful
      // reacquisition, and has now gone stale again, is not worth another reacquisition attempt
      // -- the multi-pose pass had its one shot at re-disambiguating this specific anchor and the
      // scene still isn't resolving cleanly (e.g. reacquisition's own acquisition-heuristic
      // fallback keeps landing on the same bystander). Drop to the plain, undisambiguated
      // single-pose path -- same shape as the original crop-mode fallback -- rather than looping
      // reacquire/lose forever.
      let giveUpBoxAtStart = anchorBoxAtStart
      if (
        anchorStale &&
        personOfInterestConfig.enabled &&
        anchorWasReacquired
      ) {
        clearAnchor()
        personOfInterestSuspended = true
        giveUpBoxAtStart = null
      }

      const effectiveAnchorMissing = giveUpBoxAtStart === null
      const effectiveAnchorStale =
        !effectiveAnchorMissing &&
        consecutiveLowConfidence >=
          trackingCropConfig.reacquisitionLossThreshold

      let dispatchMultiPose =
        personOfInterestConfig.enabled &&
        !personOfInterestSuspended &&
        (effectiveAnchorMissing || effectiveAnchorStale)

      const multiPoseDet = dispatchMultiPose
        ? await getMultiPoseDetector()
        : null

      // From here on, `boxForFraming` -- not live `lastBoundingBox` -- decides crop-vs-full-frame
      // for THIS call, so a call that started with one anchor snapshot never crops against a
      // *different*, newer anchor a concurrent call may have installed while we awaited detector
      // creation above (review item #3).
      let boxForFraming = giveUpBoxAtStart
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
        boxForFraming = null
        if (myGeneration === generation) {
          clearAnchor()
        }
      }

      const usingCrop =
        !dispatchMultiPose &&
        trackingCropConfig.enabled &&
        boxForFraming !== null
      const rawDetectorUsage: RawDetectorUsage = usingCrop
        ? 'crop'
        : 'fullFrame'

      // `rawDetector` is reused across calls, so its own internal cropRegion/smoothing-filter
      // state (computed relative to whatever canvas we fed it on its LAST ACTUAL invocation)
      // would otherwise fight our externally-computed framing at the moment framing actually
      // changes shape. Only that transition boundary needs it: for a same-size square canvas
      // across consecutive crop-mode calls, `initCropRegion` (see design.md's Context) always
      // resolves to full `[0,1]x[0,1]` coverage regardless of MoveNet's own stale `cropRegion`, so
      // resetting on every steady-tracking call would only cost MoveNet's one-euro smoothing
      // continuity for no correctness benefit. A call the acquisition/reacquisition path
      // intercepts entirely (`dispatchMultiPose`) never invokes `rawDetector` at all, so this
      // comparison is SKIPPED for it entirely, not just evaluated against a placeholder usage --
      // `rawDetectorUsage` computed for such a call would be a meaningless artifact of
      // `usingCrop`'s `!dispatchMultiPose` guard (always 'fullFrame'), and comparing it against
      // `previousRawDetectorUsage` would fire a spurious reset the instant a reacquisition
      // dispatch interrupts steady-state crop tracking, regardless of whether the eventual
      // selection turns out continuous or not. `previousRawDetectorUsage` is only ever updated by
      // a call that ACTUALLY invoked `rawDetector` (see `commitCallProgress`), so an intervening
      // acquisition/reacquisition "hole" of any length never triggers this transition-based reset
      // on its own, preserving whatever continuity `rawDetector`'s own internal state had going
      // into it -- separate from the identity-switch-specific reset inside the multi-pose branch
      // below (review NEW-1). Guarded by the same reentrancy check as above: a stale call
      // resuming after a slow `await` must not reset `rawDetector` out from under a newer call
      // that has already started using it.
      if (
        !dispatchMultiPose &&
        rawDetectorUsage !== previousRawDetectorUsage &&
        myGeneration === generation
      ) {
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
      // the video kept playing forward in the meantime. `usage` is `null` for a call the
      // acquisition/reacquisition path intercepted entirely -- it never touched `rawDetector`, so
      // it must not overwrite `previousRawDetectorUsage`.
      function commitCallProgress(usage: RawDetectorUsage | null): void {
        if (usage !== null) previousRawDetectorUsage = usage
        lastSeenTime = currentTime
      }

      if (dispatchMultiPose && multiPoseDet !== null) {
        const multiPoses = await multiPoseDet.estimatePoses(
          source.image,
          undefined,
          currentTime * 1000,
        )
        const isCurrent = myGeneration === generation

        if (multiPoses.length === 0) {
          if (isCurrent) {
            if (effectiveAnchorMissing) {
              // Fresh acquisition found no one at all -- nothing was seeded, so the next call is
              // still an ordinary acquisition attempt (spec.md's "No candidates returned").
            } else {
              consecutiveEmptyReacquisitions += 1
              if (
                consecutiveEmptyReacquisitions >=
                reacquisitionMissBudget(trackingCropConfig)
              ) {
                clearAnchor()
                personOfInterestSuspended = true
              }
            }
            commitCallProgress(null)
          }
          return null
        }

        const candidates = toCandidates(
          multiPoses,
          currentTime,
          trackingCropConfig,
        )
        const {
          candidate: selected,
          usable,
          continuous,
        } = pickBestCandidate(
          candidates,
          effectiveAnchorMissing,
          giveUpBoxAtStart,
        )

        if (isCurrent) {
          if (usable) {
            lastBoundingBox = selected.box
            consecutiveLowConfidence = 0
            consecutiveEmptyReacquisitions = 0
            // Only a GENUINE reacquisition (continuity actually matched via IoU/proximity)
            // counts as "already reacquired once" for the give-up budget (review NEW-2): a
            // reacquisition call that fell through to the acquisition-heuristic fallback is, per
            // spec.md's "No candidate matches the last known position" scenario, treated as a
            // fresh acquisition instead -- it shouldn't burn the one-shot budget early.
            anchorWasReacquired = !effectiveAnchorMissing && continuous
            // Identity actually switched to a different, non-continuous person during
            // reacquisition (review NEW-1): `rawDetector`'s own internal state (its cropRegion,
            // one-euro smoothing, etc. -- see design.md's Context), if it has any, was built
            // tracking the OLD, just-rejected person. Left uncleared, the very next full-frame
            // call would silently resume locked onto them via MoveNet's own saliency continuity
            // -- exactly the bug this capability exists to fix. A continuous match, or a fresh
            // acquisition with no prior anchor to have switched away from, leaves it alone.
            if (!effectiveAnchorMissing && !continuous) {
              rawDetector.reset()
            }
          } else if (!effectiveAnchorMissing) {
            // Raw candidates existed but none cleared the usability gate during reacquisition --
            // counts toward the same bounded retry budget as a fully-empty result (review item
            // #2 + #5 together): still returns a frame (the invariant), but doesn't treat it as
            // a trustworthy anchor.
            consecutiveEmptyReacquisitions += 1
            if (
              consecutiveEmptyReacquisitions >=
              reacquisitionMissBudget(trackingCropConfig)
            ) {
              clearAnchor()
              personOfInterestSuspended = true
            }
          }
          commitCallProgress(null)
        }

        return selected.frame
      }

      let cropRect: CropRectPx | null = null
      let poses: Awaited<ReturnType<typeof rawDetector.estimatePoses>>

      if (usingCrop) {
        cropRect = computeCropRect(
          boxForFraming as BoundingBoxPx,
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
          // An ordinary single-pose detection re-established a confident anchor on its own --
          // whatever multi-pose "give up" state was active no longer applies to this fresh
          // anchor.
          personOfInterestSuspended = false
          anchorWasReacquired = false
          consecutiveEmptyReacquisitions = 0
        } else {
          registerTrackingLoss()
        }
        commitCallProgress(usingCrop ? 'crop' : 'fullFrame')
      }

      return frame
    },
    dispose(): void {
      rawDetector.dispose()
      if (multiPoseDetector) {
        multiPoseDetector.dispose()
      } else if (multiPoseDetectorPromise) {
        multiPoseDetectorPromise
          .then((created) => created.dispose())
          .catch(() => {})
      }
    },
  }
}
