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
  /**
   * Shrink reference window (`strides-p1qt.18`): a detection is also refused when it is more than
   * `maxAreaRatio` smaller than the largest box the CURRENT identity produced in the last
   * `shrinkReferenceWindowSeconds` -- so an anchor cannot be walked down, frame by frame, from a
   * runner leaving through an edge onto a smaller person beside her. `0` disables, and is the
   * default (see `DEFAULT_CONTINUITY_GATE_CONFIG`). See `isAboveRecentPeakFloor` (movenetCrop.ts).
   */
  shrinkReferenceWindowSeconds: number
}

/**
 * The identity challenge (`strides-p1qt.15`): a periodic, side-effect-free multi-pose look at the
 * whole frame that can move the anchor to a different person. Exists because every other
 * multi-pose trigger either fires only when the anchor is missing or stale, or (re-verification)
 * is scored by continuity and so reconfirms whoever is already anchored. Nothing else ever lets a
 * subject who enters AFTER acquisition, or who lost a near-tie on the acquisition frame, take the
 * anchor from a bystander who is still confidently tracked.
 *
 * Two regimes, by how well the current identity has been established:
 *
 *  - TENTATIVE (fewer than `confirmationsToSettle` checks have re-picked it): one multi-pose frame
 *    is weak evidence of who the subject is -- people below the pose-score floor are invisible to
 *    it, and the runner may not have entered yet. So each check re-runs the acquisition heuristic
 *    over everyone visible. The anchor winning is a confirmation. Anyone else takes the anchor with
 *    a clear scale margin (`tentativeMinAreaRatio`), or at comparable size when the check cannot
 *    see the anchor at all.
 *  - SETTLED: a switch needs a candidate at least `minAreaRatio` times the anchor's tracked box, on
 *    `minConsecutiveWins` consecutive checks, by the same person. Persistence absorbs single-frame
 *    box noise.
 *
 * All scale comparisons are against the anchor's own tracked (single-pose) box; see
 * `decideIdentityChallenge` for why never against its multi-pose match.
 */
export interface IdentityChallengeConfig {
  /** `false` removes the check entirely: no extra model, no extra calls. */
  enabled: boolean
  /** Ordinary calls between checks while the identity is tentative. */
  tentativeIntervalFrames: number
  /** How many checks must re-pick the anchor before it counts as settled. */
  confirmationsToSettle: number
  /**
   * Tentative regime: a candidate other than the anchor needs at least this many times the anchor's
   * bounding-box area to take over -- the same scale test the settled regime applies, at a lower
   * bar; a near-tie in one multi-pose frame is box noise, not evidence, and the incumbent keeps it.
   * When the check cannot see the anchor at all, the winner needs only `1 / tentativeMinAreaRatio`
   * of its area (comparable size): see `decideIdentityChallenge`.
   */
  tentativeMinAreaRatio: number
  /** Ordinary calls between checks once the identity is settled. */
  settledIntervalFrames: number
  /** Settled regime: challenger/anchor bounding-box area ratio needed to win a check. */
  minAreaRatio: number
  /** Settled regime: consecutive winning checks (by the same challenger) needed to switch. */
  minConsecutiveWins: number
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
  /** See `IdentityChallengeConfig`. */
  identityChallenge: IdentityChallengeConfig
  /**
   * Seeded hand-off (`strides-p1qt.15`). When a crop-mode stretch (the settle-in window) ends, the
   * single-pose detector must be reset, and a reset MoveNet restarts its own crop from a
   * centre-square guess and re-picks whoever is most salient there -- often not the anchor (a
   * runner entering at a frame edge sits outside that square). With this on, a hand-off call whose
   * result does not confirm the anchor is retried once, on the same frame, with MoveNet's crop
   * started from the anchor instead (`movenetCropRegionSeed.ts`). A hand-off that already found the
   * anchor is left exactly as it was.
   */
  seedHandOff: boolean
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
  // OFF by default (strides-p1qt.18): the retroactive stage's own window (same rule, same 0.5 s)
  // is what fixes the measured failure. Turned on here too it changed nothing on IMG_9345 but
  // moved multiperson's cadence/VO/VR from normal to caveated, by admitting two partial edge-entry
  // frames earlier. Kept as a measured, overridable option.
  shrinkReferenceWindowSeconds: 0,
}

/**
 * `enabled: true` by default -- unlike tracking-crop (a performance optimization that measured a
 * real regression on one clip and shipped default-off), this is a correctness fix for a
 * live-confirmed bug (see proposal.md's Why): MoveNet's single-pose models have no way to tell
 * people apart, and were observed locking onto a background bystander instead of the runner. The
 * feature stays fully disableable via `window.__STRIDES_POSE_BACKEND_OVERRIDE__ =
 * { personOfInterest: { enabled: false } }` for A/B comparison against the pre-existing baseline.
 */
/**
 * Reasoned defaults, measured in `openspec/changes/challenge-locked-bystanders/design.md`:
 * `minAreaRatio: 3` equals the continuity gate's `maxAreaRatio`, so a settled-regime challenger is
 * by construction someone the steady-state gate would refuse to merge with the anchor. The two
 * intervals trade reaction time against one extra multi-pose call per interval (sequential sampler:
 * wall-clock only, no lost frames).
 */
export const DEFAULT_IDENTITY_CHALLENGE_CONFIG: IdentityChallengeConfig = {
  enabled: true,
  tentativeIntervalFrames: 4,
  confirmationsToSettle: 3,
  tentativeMinAreaRatio: 1.5,
  settledIntervalFrames: 10,
  minAreaRatio: 3,
  minConsecutiveWins: 2,
}

export const DEFAULT_PERSON_OF_INTEREST_CONFIG: PersonOfInterestConfig = {
  enabled: true,
  continuityGate: DEFAULT_CONTINUITY_GATE_CONFIG,
  identityChallenge: DEFAULT_IDENTITY_CHALLENGE_CONFIG,
  seedHandOff: true,
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
