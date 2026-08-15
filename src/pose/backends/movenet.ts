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
  POST_ACQUISITION_SETTLE_FRAMES,
  REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE,
  REVERIFICATION_INTERVAL_FRAMES,
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

/**
 * Why a given call dispatches to the multi-pose selection pass instead of the ordinary
 * single-pose call -- `null` means it doesn't. `'acquisition'` and `'reacquisition'` are scored
 * and handled as before; `'reverification'` (design.md's "Periodic re-verification") reuses the
 * exact same `selectByReacquisitionHeuristic`/`pickBestCandidate` call `'reacquisition'` does
 * (both score continuity against the current anchor), but differs on failure: a `'reacquisition'`
 * miss counts toward the give-up budget, a `'reverification'` miss is a strict no-op on every
 * counter except its own interval (see `estimatePose`'s handling of each).
 */
type MultiPoseDispatchReason =
  'acquisition' | 'reacquisition' | 'reverification'

export async function createMoveNetDetector(
  modelType: MoveNetModelType = 'lightning',
  trackingCropConfig: TrackingCropConfig = DEFAULT_TRACKING_CROP_CONFIG,
  personOfInterestConfig: PersonOfInterestConfig = DEFAULT_PERSON_OF_INTEREST_CONFIG,
): Promise<PoseDetector> {
  await tf.setBackend('webgl')
  await tf.ready()

  // The single-pose and multi-pose detectors are created EAGERLY, in parallel, both awaited
  // before this function's returned promise resolves -- `usePoseDetector.ts` already gates
  // auto-analyze on that promise, the same treatment the single-pose model has always gotten.
  // This was previously lazy (create `multiPoseDetector` on first acquisition call) on the theory
  // that its cost should only be paid by a run that actually reaches an acquisition moment. That
  // reasoning was wrong: acquisition ALWAYS runs on the first call of every single run (no prior
  // anchor ever exists yet), so lazy creation was never actually deferring a rare cost -- it was
  // relocating an unavoidable one to the worst possible place, a synchronous stall DURING
  // real-time frame sampling (`sampleClip.ts` samples via `requestVideoFrameCallback` during
  // literal 1x playback; every millisecond the fetch takes is a frame that never gets sampled).
  // Measured on real GPU, 3 trials/clip: the park clip lost cadence/vertical-oscillation entirely
  // (`null`, all 3 trials); the track clip had 1 of 3 trials collapse to 0 detected frames, the
  // other two lost 12-32% of samples. The baseline (`personOfInterest.enabled: false`) was fine
  // across all 6 trials -- this was exactly the risk design.md originally flagged as "a separate,
  // larger question this fix does not attempt", confirmed catastrophic by the live-browser A/B,
  // not theoretical. Eager creation moves this same unavoidable cost to a visible, bounded
  // "loading detector" wait before analysis starts (no data loss) instead of a silent mid-clip
  // stall. Running the two creations in parallel (not sequentially) keeps the total wait at
  // roughly `max(singlePoseTime, multiPoseTime)`, not their sum.
  //
  // Skipped entirely when `personOfInterestConfig.enabled` is `false`: the kill-switch should
  // kill this cost too, not just the runtime dispatch behavior -- there is no reason to pay for
  // (or wait on) a model this detector instance will never invoke.
  //
  // A multi-pose creation failure (e.g. the model asset fetch failed) is caught locally so it
  // degrades to "multi-pose unavailable for this detector instance" rather than rejecting the
  // whole `createMoveNetDetector` promise -- single-pose tracking must keep working even if the
  // multi-pose model never loads (task 2.2's "never regress below baseline" guarantee, now
  // enforced at construction time instead of per-call). Unlike the removed lazy accessor, there
  // is no retry: this detector instance is cached and reused for the whole app lifetime
  // (`usePoseDetector.ts`), and there is no natural "try again" moment once creation has already
  // been paid for (or failed) up front for every run this instance will ever serve.
  const rawDetectorPromise = poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: MOVENET_MODEL_TYPES[modelType] },
  )
  const multiPoseDetectorPromise: Promise<Awaited<
    ReturnType<typeof poseDetection.createDetector>
  > | null> = personOfInterestConfig.enabled
    ? poseDetection
        .createDetector(poseDetection.SupportedModels.MoveNet, {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        })
        .catch(() => null)
    : Promise.resolve(null)

  // Both fetches stay in flight together (still parallel -- `multiPoseDetectorPromise` was
  // already kicked off above, before this `await`), but the SINGLE-pose promise's own rejection
  // is NOT caught: if it fails, this whole function must still reject (there is no baseline to
  // fall back to without a working single-pose detector). The one thing this awaits-in-sequence
  // shape adds over a plain `Promise.all` is disposal: if the multi-pose fetch has ALREADY
  // resolved successfully by the time the single-pose one rejects, that multi-pose detector would
  // otherwise never be reachable by anything (this function is about to throw, so its caller never
  // gets a `PoseDetector` handle to call `dispose()` on) and would leak its WebGL tensors for the
  // page lifetime. `.then((d) => d?.dispose())` is a no-op if the multi-pose fetch itself failed
  // or was skipped (resolves `null`).
  let rawDetector: Awaited<typeof rawDetectorPromise>
  try {
    rawDetector = await rawDetectorPromise
  } catch (err) {
    void multiPoseDetectorPromise.then((created) => created?.dispose())
    throw err
  }
  const multiPoseDetector = await multiPoseDetectorPromise

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

  // How many of the next ordinary (non-multi-pose-dispatch) calls are forced into crop mode
  // around the current anchor, independent of `trackingCropConfig.enabled` -- design.md's "Carry
  // POI identity forward via a bounded settle-in window". Set to `POST_ACQUISITION_SETTLE_FRAMES`
  // by any successful multi-pose dispatch (acquisition, reacquisition, or re-verification);
  // decremented once per ordinary call thereafter (see `estimatePose`'s steady-state branch).
  let settleFramesRemaining = 0

  // How many ordinary steady-state calls have elapsed since the last (re)acquisition or
  // re-verification event -- design.md's "Periodic re-verification". Compared against
  // `REVERIFICATION_INTERVAL_FRAMES` to decide when a confident, non-stale anchor is nonetheless
  // due for a proactive continuity check (catches MoveNet's saliency smoothly drifting onto a
  // different person without ever tripping the confidence-based reacquisition trigger).
  let callsSinceLastVerification = 0

  /** Clears all anchor and multi-pose-episode state -- used both for a genuine "no one is
   * trackable" reset and as the internals of "giving up" (which additionally suspends
   * multi-pose dispatch, see call sites). */
  function clearAnchor(): void {
    lastBoundingBox = null
    consecutiveLowConfidence = 0
    anchorWasReacquired = false
    consecutiveEmptyReacquisitions = 0
    settleFramesRemaining = 0
    callsSinceLastVerification = 0
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

  /**
   * Advances the settle-in-window and periodic-re-verification counters for one ordinary
   * (non-multi-pose-dispatch) call, regardless of whether it found a usable detection --
   * design.md's "Carry POI identity forward via a bounded settle-in window" and "Periodic
   * re-verification" both count elapsed CALLS, not just successful ones.
   *
   * `incrementVerificationCounter: false` skips the `callsSinceLastVerification` bump only --
   * used when this ordinary call is itself the fall-through continuation of a periodic
   * re-verification check that just reset that counter to `0` moments ago (review F2); bumping it
   * again in the same call would just be off-by-one noise. The settle-in countdown still
   * decrements regardless, since this call is a real framing decision either way.
   */
  function advanceContinuityCounters(
    incrementVerificationCounter: boolean,
  ): void {
    if (settleFramesRemaining > 0) settleFramesRemaining -= 1
    if (incrementVerificationCounter) callsSinceLastVerification += 1
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
        previousRawDetectorUsage = 'fullFrame'
        rawDetector.reset()
      }

      // Captured synchronously, before any `await` below: `anchorBoxAtStart` (the reacquisition
      // heuristic's scoring target), `settleFramesRemainingAtStart` (the settle-in window's crop
      // trigger), and the crop-vs-full-frame framing decision for THIS call are all derived from
      // this snapshot, not from live state re-read after an `await` -- a newer overlapping call
      // (`sampleClip.ts`'s per-frame timeout lets calls overlap, see the reentrancy guard below)
      // could otherwise mutate the live values in between, corrupting a stale call's own
      // framing/scoring or, worse, letting a stale call's late failure clobber a newer call's
      // progress.
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

      // Snapshotted AFTER the give-up block, not before it (review F5): give-up can call
      // `clearAnchor()`, which zeroes `settleFramesRemaining` -- reading this earlier would be an
      // ordering landmine for any future give-up variant that preserves the box while still
      // clearing the settle window (today it's harmless only because give-up always also nulls
      // the box, and `usingCrop` below requires a non-null box regardless of this value).
      const settleFramesRemainingAtStart = settleFramesRemaining

      const effectiveAnchorMissing = giveUpBoxAtStart === null
      const effectiveAnchorStale =
        !effectiveAnchorMissing &&
        consecutiveLowConfidence >=
          trackingCropConfig.reacquisitionLossThreshold
      // Periodic re-verification (design.md): only due for a confident, non-stale anchor -- an
      // anchor already being acquired or reacquired this call has no "steady state" to verify.
      const dueForReverification =
        !effectiveAnchorMissing &&
        !effectiveAnchorStale &&
        callsSinceLastVerification >= REVERIFICATION_INTERVAL_FRAMES

      const dispatchReason: MultiPoseDispatchReason | null =
        effectiveAnchorMissing
          ? 'acquisition'
          : effectiveAnchorStale
            ? 'reacquisition'
            : dueForReverification
              ? 'reverification'
              : null

      let dispatchMultiPose =
        personOfInterestConfig.enabled &&
        !personOfInterestSuspended &&
        dispatchReason !== null

      // `multiPoseDetector` is a fixed, resolved reference set once at `createMoveNetDetector`
      // construction time (eager, parallel creation -- see the doc comment there) -- reading it
      // here is a synchronous property lookup, not an `await`, so unlike the rest of this
      // function's `await`-adjacent state there is no reentrancy concern for this specific read:
      // no other call could have started since `myGeneration = ++generation` above, because
      // nothing has yielded control yet.
      const multiPoseDet = dispatchMultiPose ? multiPoseDetector : null

      // From here on, `boxForFraming` -- not live `lastBoundingBox` -- decides crop-vs-full-frame
      // for THIS call, so a call that started with one anchor snapshot never crops against a
      // *different*, newer anchor a concurrent call may have installed before this call's own
      // later `await`s resolve (review item #3).
      let boxForFraming = giveUpBoxAtStart
      if (dispatchMultiPose && multiPoseDet === null) {
        // The multi-pose detector was never successfully created for this detector instance (its
        // eager, parallel creation at construction time failed -- see `createMoveNetDetector`'s
        // doc comment; this is now a fixed fact for this instance's whole lifetime, not a
        // per-call possibility, since there is no retry). Fall back to the ordinary single-pose
        // path below rather than surfacing a hard error (task 2.2), never regressing below this
        // backend's pre-existing baseline.
        dispatchMultiPose = false
        if (dispatchReason === 'reverification') {
          // A periodic check that couldn't even start must be an equally strict no-op as an
          // empty/unusable one (design.md's "Periodic re-verification"): the existing anchor was
          // working fine (that's why this was a re-verification, not a reacquisition) --
          // `boxForFraming` stays `giveUpBoxAtStart`, unchanged, so ordinary framing below
          // continues exactly as if this call had never attempted a check at all. Only the
          // interval resets, so the next attempt waits a full interval rather than retrying every
          // subsequent call.
          callsSinceLastVerification = 0
        } else {
          // Acquisition/reacquisition: an anchor that was merely stale (not missing) is dropped
          // too -- without a multi-pose pass to re-disambiguate it, cropping around a
          // no-longer-trustworthy box is worse than falling back to full-frame.
          boxForFraming = null
          clearAnchor()
        }
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

      // Set when a periodic re-verification check came back empty/unusable and this call fell
      // through to the ordinary single-pose call below for the SAME frame (review F2) --
      // suppresses the fallen-through call's own `callsSinceLastVerification` increment, since
      // that counter was already reset to `0` by the failed check itself moments ago; incrementing
      // it again in the same call would just be off-by-one bookkeeping noise.
      let cameFromFailedReverificationCheck = false

      if (
        dispatchMultiPose &&
        multiPoseDet !== null &&
        dispatchReason !== null
      ) {
        const multiPoses = await multiPoseDet.estimatePoses(
          source.image,
          undefined,
          currentTime * 1000,
        )
        const isCurrent = myGeneration === generation

        if (multiPoses.length === 0) {
          if (isCurrent) {
            if (dispatchReason === 'reverification') {
              // Strict no-op (design.md's "Periodic re-verification"): the existing anchor was
              // working fine, so an empty periodic check must never push it toward staleness or
              // the give-up budget -- only the interval resets, so the next attempt waits a full
              // interval rather than retrying (and paying for a multi-pose call) every subsequent
              // frame.
              callsSinceLastVerification = 0
            } else if (dispatchReason === 'reacquisition') {
              consecutiveEmptyReacquisitions += 1
              if (
                consecutiveEmptyReacquisitions >=
                reacquisitionMissBudget(trackingCropConfig)
              ) {
                clearAnchor()
                personOfInterestSuspended = true
              }
            }
            // 'acquisition': fresh acquisition found no one at all -- nothing was seeded, so the
            // next call is still an ordinary acquisition attempt (spec.md's "No candidates
            // returned").
          }
          if (dispatchReason === 'reverification') {
            // Review F2: an empty periodic check must not drop the sampled frame outright --
            // fall through to the ordinary single-pose call below for this SAME frame instead of
            // resolving `null`, paying the extra model invocation only on this rare failed check,
            // not on every periodic tick. `boxForFraming`/`giveUpBoxAtStart` are untouched, so
            // that ordinary call frames exactly as if this call had never attempted a check.
            dispatchMultiPose = false
            cameFromFailedReverificationCheck = true
          } else {
            if (isCurrent) commitCallProgress(null)
            return null
          }
        } else {
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

          if (usable) {
            if (isCurrent) {
              lastBoundingBox = selected.box
              consecutiveLowConfidence = 0
              consecutiveEmptyReacquisitions = 0
              // A bounded settle-in window only starts (or restarts) when this selection carries
              // NEW identity information -- a fresh acquisition, or a reacquisition/re-verification
              // that switched to a genuinely different (non-continuous) person (review F4). A
              // continuous reacquisition/re-verification confirms `rawDetector` was already
              // tracking the right person; forcing crop-mode calls and (see below) resetting
              // `rawDetector` in that case would just discard working smoothing continuity for no
              // benefit, at real per-event cost every `REVERIFICATION_INTERVAL_FRAMES` calls even
              // when everything was already fine. When it DOES start: force the next few calls
              // into crop mode around the just-selected/reconfirmed anchor, independent of
              // `trackingCropConfig.enabled`, so the single-pose detector's very next calls are
              // actually centered on the right person instead of running full-frame and unbiased
              // (design.md's "Carry POI identity forward via a bounded settle-in window").
              if (dispatchReason === 'acquisition' || !continuous) {
                settleFramesRemaining = POST_ACQUISITION_SETTLE_FRAMES
              }
              if (dispatchReason === 'reverification') {
                callsSinceLastVerification = 0
              }
              // Only a GENUINE reacquisition/re-verification (continuity actually matched via
              // IoU/proximity) counts as "already reacquired once" for the give-up budget (review
              // NEW-2): a selection that fell through to the acquisition-heuristic fallback is,
              // per spec.md's "No candidate matches the last known position" scenario, treated as
              // a fresh acquisition instead -- it shouldn't burn the one-shot budget early.
              anchorWasReacquired =
                dispatchReason !== 'acquisition' && continuous
              // Identity actually switched to a different, non-continuous person during
              // reacquisition or periodic re-verification (review NEW-1): `rawDetector`'s own
              // internal state (its cropRegion, one-euro smoothing, etc. -- see design.md's
              // Context), if it has any, was built tracking the OLD, just-rejected person. Left
              // uncleared, the very next full-frame call would silently resume locked onto them
              // via MoveNet's own saliency continuity -- exactly the bug this capability exists
              // to fix. A continuous match, or a fresh acquisition with no prior anchor to have
              // switched away from, leaves it alone.
              if (dispatchReason !== 'acquisition' && !continuous) {
                rawDetector.reset()
              }
              commitCallProgress(null)
            }
            return selected.frame
          } else if (dispatchReason === 'reverification') {
            // Strict no-op: raw candidates existed but none cleared the usability gate -- the
            // existing (still working) anchor is untouched; only the interval resets. Review F2:
            // fall through to the ordinary single-pose call below rather than returning this
            // unreliable multi-pose fallback frame (or worse, dropping the sample).
            if (isCurrent) {
              callsSinceLastVerification = 0
            }
            dispatchMultiPose = false
            cameFromFailedReverificationCheck = true
          } else {
            // 'acquisition' or 'reacquisition', not usable -- still returns the frame (the
            // "always return a frame" invariant), just doesn't seed a trustworthy anchor.
            if (isCurrent) {
              if (dispatchReason === 'reacquisition') {
                // Raw candidates existed but none cleared the usability gate during
                // reacquisition -- counts toward the same bounded retry budget as a fully-empty
                // result (review item #2 + #5 together).
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
        }
      }

      // `usingCrop`/`rawDetectorUsage`/the transition-reset decision are computed HERE, using the
      // FINAL value of `dispatchMultiPose` -- not just its initial, pre-await value -- so a call
      // that started as a multi-pose dispatch attempt but ended up falling through to the
      // ordinary single-pose path below (multi-pose detector creation failure, or (review F2) a
      // failed periodic re-verification check) gets a framing decision computed as if it had been
      // an ordinary call from the start, not a stale decision frozen from before either `await`
      // resolved.
      const usingCrop =
        !dispatchMultiPose &&
        boxForFraming !== null &&
        (trackingCropConfig.enabled || settleFramesRemainingAtStart > 0)
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
      // continuity for no correctness benefit. A call the acquisition/reacquisition/re-
      // verification path intercepts entirely (`dispatchMultiPose` still `true` here) never
      // invokes `rawDetector` at all, so this comparison is SKIPPED for it entirely, not just
      // evaluated against a placeholder usage -- `rawDetectorUsage` computed for such a call would
      // be a meaningless artifact of `usingCrop`'s `!dispatchMultiPose` guard (always
      // 'fullFrame'), and comparing it against `previousRawDetectorUsage` would fire a spurious
      // reset the instant a reacquisition dispatch interrupts steady-state crop tracking,
      // regardless of whether the eventual selection turns out continuous or not.
      // `previousRawDetectorUsage` is only ever updated by a call that ACTUALLY invoked
      // `rawDetector` (see `commitCallProgress`), so an intervening acquisition/reacquisition
      // "hole" of any length never triggers this transition-based reset on its own, preserving
      // whatever continuity `rawDetector`'s own internal state had going into it -- separate from
      // the identity-switch-specific reset inside the multi-pose branch above (review NEW-1).
      // Guarded by the same reentrancy check as above: a stale call resuming after a slow `await`
      // must not reset `rawDetector` out from under a newer call that has already started using
      // it.
      if (
        !dispatchMultiPose &&
        rawDetectorUsage !== previousRawDetectorUsage &&
        myGeneration === generation
      ) {
        rawDetector.reset()
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
          advanceContinuityCounters(!cameFromFailedReverificationCheck)
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
        advanceContinuityCounters(!cameFromFailedReverificationCheck)
        commitCallProgress(usingCrop ? 'crop' : 'fullFrame')
      }

      return frame
    },
    dispose(): void {
      // Both detectors are fully created (or definitively failed to create) by the time
      // `createMoveNetDetector`'s promise resolves and a caller can get a `PoseDetector` handle
      // to call `dispose()` on at all -- eager, parallel creation (see `createMoveNetDetector`'s
      // doc comment) means there is no longer an "in-flight creation" case for `dispose()` to
      // special-case.
      rawDetector.dispose()
      multiPoseDetector?.dispose()
    },
  }
}
