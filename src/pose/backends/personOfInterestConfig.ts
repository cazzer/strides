/**
 * The MoveNet multi-pose acquisition/reacquisition plane as one swappable object -- see
 * `movenet.ts`/`movenetCrop.ts` for the algorithm this configures. Same file-per-plane shape as
 * `trackingCropConfig.ts`: just the type + defaults, no override/resolve machinery of its own --
 * `poseBackendConfig.ts`'s `resolvePoseDetectorConfig()` folds this in as
 * `PoseDetectorConfig.personOfInterest`, so `window.__STRIDES_POSE_BACKEND_OVERRIDE__` stays the
 * single override surface.
 */
/**
 * The steady-state anchor continuity gate (`anchor-continuity-gate`). Nested under
 * `PersonOfInterestConfig` rather than sitting as flat sibling fields so the gate can be switched
 * off independently of the multi-pose dispatch it complements -- the two are separable arms in the
 * live A/B this ships behind.
 */
export interface ContinuityGateConfig {
  /**
   * `false` restores the pre-gate behavior of the steady-state path: any usable detection becomes
   * the anchor unconditionally. Multi-pose acquisition/reacquisition/re-verification still run.
   */
  enabled: boolean
  /**
   * Position bound, as multiples of the anchor's own side (`max(width, height)`) per SECOND -- see
   * `isWithinCenterSpeedBound` for why this is a speed and not a flat distance multiple. Only ever
   * consulted for a candidate whose box does not overlap the anchor at all; any non-zero IoU
   * passes on its own.
   */
  maxCenterSpeedSidesPerSecond: number
  /** Scale bound: the candidate/anchor bounding-box area ratio must lie in
   * `[1 / maxAreaRatio, maxAreaRatio]`. */
  maxAreaRatio: number
}

export interface PersonOfInterestConfig {
  /**
   * Total kill-switch: `false` bypasses the multi-pose acquisition/reacquisition path entirely,
   * reproducing this backend's pre-existing behavior (a plain single-pose call, byte-identical to
   * before this capability existed) regardless of how many people are in frame. Disables the
   * continuity gate below along with everything else -- disabling the person-of-interest concept
   * must disable every identity opinion it introduced, or the A/B baseline is not a baseline.
   */
  enabled: boolean
  /** See `ContinuityGateConfig`. */
  continuityGate: ContinuityGateConfig
}

/**
 * `enabled: true` by default, for the same reason `DEFAULT_PERSON_OF_INTEREST_CONFIG` is: this
 * closes a live-confirmed bug (a confidently-detected bystander permanently stealing the anchor,
 * reproduced 2026-08-16 on a side-view park clip), not a speculative optimization.
 *
 * Both thresholds are FIRST-GUESS values in the same sense as `POST_ACQUISITION_SETTLE_FRAMES` --
 * reasoned from clip geometry, to be tuned by the live A/B in
 * `openspec/changes/anchor-continuity-gate/design.md`'s Migration Plan, not fixed here. They are
 * config fields rather than module constants precisely so that A/B can move them without a code
 * edit.
 *
 * `maxCenterSpeedSidesPerSecond: 3` -- a runner crossing a 1920px-wide frame in ~1.5s covers
 * ~1280 px/s; against a ~700px bbox side that is ~1.8 sides/s, so 3 leaves roughly 1.7x headroom
 * over the fastest motion this app is built to measure.
 *
 * `maxAreaRatio: 3` -- bbox area is genuinely noisy here, since `deriveBoundingBox` only spans
 * keypoints clearing `minKeypointConfidence` and an arm or trailing leg dropping below that gate
 * shrinks the box with no real change in the subject. A symmetric factor-of-three band absorbs
 * that while still rejecting the observed steal by a wide margin (the reproduction clip's fence
 * bystanders are roughly a third of the runner's on-screen height -- an area ratio near 1/9).
 */
export const DEFAULT_CONTINUITY_GATE_CONFIG: ContinuityGateConfig = {
  enabled: true,
  maxCenterSpeedSidesPerSecond: 3,
  maxAreaRatio: 3,
}

/**
 * `enabled: true` by default -- unlike tracking-crop (a performance optimization that measured a
 * real regression on one clip and shipped default-off), this is a correctness fix for a
 * live-confirmed bug (see proposal.md's Why): MoveNet's single-pose models have no way to tell
 * people apart, and were observed locking onto a background bystander instead of the runner. The
 * feature stays fully disableable via `window.__STRIDES_POSE_BACKEND_OVERRIDE__ =
 * { personOfInterest: { enabled: false } }` for A/B comparison against the pre-existing baseline.
 */
export const DEFAULT_PERSON_OF_INTEREST_CONFIG: PersonOfInterestConfig = {
  enabled: true,
  continuityGate: DEFAULT_CONTINUITY_GATE_CONFIG,
}

/**
 * Reacquisition continuity: how far a candidate's bbox center may sit from the last known bbox's
 * center -- expressed as a multiple of the last known bbox's own "side" (`max(width, height)`,
 * the same side concept `computeCropRect` uses so it scales with how close/far the subject was
 * from the camera) -- to still count as a plausible match once every candidate has zero IoU with
 * the last known box (design.md's "Person-of-interest scoring" decision). A first-guess value,
 * not yet validated against real multi-person footage -- tuned by the live-browser A/B in
 * design.md's Migration Plan (openspec/changes/multi-person-acquisition/design.md, Open
 * Questions), not fixed here.
 */
export const REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE = 2

/**
 * How many consecutive calls immediately following a successful multi-pose acquisition,
 * reacquisition, or periodic re-verification event are forced into crop mode around the
 * just-selected/reconfirmed bounding box, independent of `TrackingCropConfig.enabled` -- the
 * multi-pose selection pass and the single-pose steady-state detector are separate model
 * instances sharing zero internal state, so without this, nothing carries the selected person
 * forward into the single-pose detector's own saliency for its very next call (design.md's
 * "Carry POI identity forward via a bounded settle-in window"). A first-guess value, not yet
 * validated against real footage -- tuned by the live-browser A/B in design.md's Migration Plan,
 * not fixed here. Bounded and self-correcting (each settle-in call re-derives the tracked box
 * from its own fresh detection), unlike the continuous whole-clip tracking-crop optimization the
 * 2026-08-13 revival A/B measured a regression from -- that finding does not automatically
 * transfer to this much shorter, event-triggered window.
 */
export const POST_ACQUISITION_SETTLE_FRAMES = 3

/**
 * How many steady-state calls elapse, since the last (re)acquisition or re-verification event,
 * before a periodic re-verification check runs -- a proactive multi-pose call scored by
 * continuity against the current anchor, even though confidence hasn't dropped, since MoveNet's
 * own saliency can drift smoothly onto a different person without ever tripping the
 * confidence-based reacquisition trigger (design.md's "Periodic re-verification"). A first-guess
 * value, not yet validated against real footage -- tuned by the live-browser A/B in design.md's
 * Migration Plan, not fixed here.
 */
export const REVERIFICATION_INTERVAL_FRAMES = 45
