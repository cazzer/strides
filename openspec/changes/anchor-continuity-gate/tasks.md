# Tasks

## 1. Continuity primitives

- [x] 1.1 Add `isWithinCenterSpeedBound(candidate, reference, sidesPerSecond, elapsedSeconds)` to
  `movenetCrop.ts`, reusing `boundingBoxCenterDistance` and the same
  `max(width, height)` "side" concept `isWithinProximityThreshold`/`computeCropRect` use.
  A non-positive or non-finite `elapsedSeconds` returns `false` (the caller treats the speed term
  as unavailable, not as a rejection — `IoU > 0` still passes on its own).
- [x] 1.2 Add `isBoundingBoxAreaRatioWithin(candidate, reference, maxRatio)` to `movenetCrop.ts`,
  reusing `bboxArea`. Symmetric: passes when the ratio lies in `[1/maxRatio, maxRatio]`. A
  zero-area reference returns `false` rather than dividing by zero.
- [x] 1.3 Unit tests for both in `movenetCrop.test.ts`, including the degenerate inputs above.

## 2. Configuration

- [x] 2.1 Add `ContinuityGateConfig { enabled: boolean; maxCenterSpeedSidesPerSecond: number;
  maxAreaRatio: number }` and a `continuityGate` field on `PersonOfInterestConfig`
  (`personOfInterestConfig.ts`), defaulting to
  `{ enabled: true, maxCenterSpeedSidesPerSecond: 3, maxAreaRatio: 3 }`. Document the derivation
  of both numbers (design.md's "Defaults") and that they are first-guess values to be tuned by
  the live A/B, matching the existing tone of `POST_ACQUISITION_SETTLE_FRAMES`.
- [x] 2.2 Extend `resolvePoseDetectorConfig()` (`poseBackendConfig.ts`) to merge the nested
  `continuityGate` one level deeper, so a partial override of one field preserves the others.
  Mirror how `trackingCrop` is merged.
- [x] 2.3 Unit tests in `poseBackendConfig.test.ts`: full override, partial `continuityGate`
  override preserving siblings, no override.

## 3. The gate itself

- [x] 3.1 In `movenet.ts`'s steady-state acceptance block, gate the `derived !== null` branch on
  continuity: skip the gate when `continuityGate.enabled` is false, when `lastBoundingBox` is
  null, or when `personOfInterestSuspended`; otherwise require position continuity
  (`computeBoundingBoxIoU > 0` OR `isWithinCenterSpeedBound`) AND scale continuity
  (`isBoundingBoxAreaRatioWithin`).
- [x] 3.2 On rejection: leave `lastBoundingBox` and every multi-pose episode counter untouched,
  call `registerTrackingLoss()`, and still return the detected `PoseFrame`.
- [x] 3.3 Compute elapsed time as `currentTime - lastSeenTime` read inside the existing
  `isCurrent` reentrancy guard, before `commitCallProgress` advances `lastSeenTime`.
- [x] 3.4 Unit tests in `movenet.test.ts`: bystander steal rejected; ordinary motion accepted;
  sustained rejection reaches `reacquisitionLossThreshold` and dispatches reacquisition; gate
  skipped with no anchor / POI disabled / suspended; settle-in call gated; rejected call still
  returns its frame; gate disabled via config reproduces pre-gate acceptance.

## 4. Restore full-frame keypoint smoothing

- [x] 4.1 Pass `currentTime * 1000` as the third argument to the steady-state full-frame
  `rawDetector.estimatePoses` call, sharing one expression with the crop-mode call site so the two
  cannot drift in units.
- [x] 4.2 Leave the combined kill-switch early-return path (`!trackingCrop.enabled &&
  !personOfInterest.enabled`) calling `estimatePoses(source.image)` with no further arguments, and
  document why in place (no new-run reset there — see design.md).
- [x] 4.3 Unit tests in `movenet.test.ts`: the full-frame steady-state call receives the timestamp
  in milliseconds; the kill-switch path still receives exactly one argument.

## 5. Correct the stale library-behavior comment

- [x] 5.1 Rewrite `movenet.ts`'s transition-reset comment: on a successful detection the library
  persists a tight `determineCropRegion`, not `initCropRegion`'s full-frame coverage, so
  reset-vs-no-reset are not equivalent-modulo-smoothing. State that the reset behavior itself is
  deliberately unchanged here and why (design.md's deferred item).

## 7. Second round: periodic re-verification scale check

- [x] 7.1 Apply the gate's scale test to a `'reverification'` selection scored `continuous`,
  treating a failure as the existing "raw candidates but none usable" strict no-op. Leave
  non-continuous selections (intentional identity switches) and `'reacquisition'` untouched.
- [x] 7.2 Unit test in `movenet.test.ts`: an overlapping but far-smaller re-verification match
  does not collapse the anchor; verified discriminating by mutation.
- [x] 7.3 Re-measure the full crop x gate matrix on the reproduction clip and record it in
  design.md, superseding the first round's crop-on figures.

## 6. Verification

- [x] 6.1 `npx tsc -b` clean, `npx eslint` clean on every touched file, `npm test` green.
- [x] 6.2 Live-browser run on the reproduction clip (side-view park pass-by, tracking-crop
  enabled) confirming the anchor no longer transfers to a background bystander.
- [x] 6.3 Live-browser A/B per design.md's Migration Plan: both demo clips, 3 trials per arm,
  real GPU, `continuityGate.enabled` false vs. true with the timestamp fix present in both.
  Record medians and per-metric confidence tiers in design.md.
- [x] 6.4 Evaluate against the pre-registered ship rule and record the outcome in design.md.
