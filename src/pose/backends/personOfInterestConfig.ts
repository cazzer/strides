/**
 * The MoveNet multi-pose acquisition/reacquisition plane as one swappable object -- see
 * `movenet.ts`/`movenetCrop.ts` for the algorithm this configures. Same file-per-plane shape as
 * `trackingCropConfig.ts`: just the type + defaults, no override/resolve machinery of its own --
 * `poseBackendConfig.ts`'s `resolvePoseDetectorConfig()` folds this in as
 * `PoseDetectorConfig.personOfInterest`, so `window.__STRIDES_POSE_BACKEND_OVERRIDE__` stays the
 * single override surface.
 */
export interface PersonOfInterestConfig {
  /**
   * Total kill-switch: `false` bypasses the multi-pose acquisition/reacquisition path entirely,
   * reproducing this backend's pre-existing behavior (a plain single-pose call, byte-identical to
   * before this capability existed) regardless of how many people are in frame.
   */
  enabled: boolean
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
