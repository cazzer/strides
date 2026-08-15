## 1. Config surface

- [x] 1.1 Add a `personOfInterest` config plane (e.g. `{ enabled: boolean }`, defaulting to
      `enabled: true`) alongside `TrackingCropConfig`, folded into `PoseDetectorConfig` the same
      way `trackingCrop` already is, so `window.__STRIDES_POSE_BACKEND_OVERRIDE__` covers it too.
- [x] 1.2 Add the reacquisition-continuity constants (proximity-fallback distance multiple, any
      minimum IoU floor) as named constants near the existing `DEFAULT_TRACKING_CROP_CONFIG`,
      documented as tuned-by-A/B per design.md's Open Questions, not fixed by first-guess values.
      (`REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE` only — no minimum-IoU-floor constant was added;
      design.md's own decision text branches on "every candidate has zero IoU", not "below a
      floor", so a separate floor would be an unspecified extra knob, not something the design
      calls for.)

## 2. Multi-pose detector lifecycle

- [x] 2.1 Add a lazy, memoized `MULTIPOSE_LIGHTNING` detector accessor in
      `src/pose/backends/movenet.ts`, created on first acquisition call rather than inside
      `createMoveNetDetector`, mirroring the existing scale-pass detector accessor's
      lazy-create/memoize/no-throw-on-failure pattern.
- [x] 2.2 Decide and implement the failure behavior when multi-pose detector creation itself
      fails (network/model-load failure): fall back to the existing single-pose full-frame call
      for that run rather than surfacing a hard error, so a multi-pose failure never regresses
      below today's baseline behavior.

## 3. Unify anchor-tracking state

- [x] 3.1 Lift `lastBoundingBox` and a consecutive-low-confidence counter out of being
      conditionally-scoped to `trackingCropConfig.enabled`, into state the `estimatePose` closure
      always maintains, per design.md's "Unify anchor-tracking state" decision.
- [x] 3.2 Update `registerTrackingLoss` (or its replacement) so it counts loss regardless of
      `usingCrop`/`trackingCropConfig.enabled`, using the shared `reacquisitionLossThreshold`.
- [x] 3.3 Confirm the crop-vs-full-frame framing decision (whether a given call builds a cropped
      canvas) still reads `trackingCropConfig.enabled` exactly as before — only the existence of
      anchor state changes, not what it's used for when crop is disabled.

## 4. Acquisition path

- [x] 4.1 Detect "no prior anchor for this run" (reusing/extending the existing new-run reset
      logic keyed on `video.currentTime` dropping) and route that call to the multi-pose
      acquisition path instead of the ordinary single-pose call.
- [x] 4.2 Implement the acquisition scoring heuristic (bbox area via `deriveBoundingBox`,
      weighted by mean keypoint confidence over the same non-excluded keypoint set) and select
      the top-scoring candidate.
- [x] 4.3 Map the selected candidate's keypoints to a `PoseFrame` via the existing `toPoseFrame`
      helper, and seed anchor state (bounding box, loss counter reset) from it, identical to what
      a usable single-pose detection does today.
- [x] 4.4 Handle the zero-candidates case: resolve `null` for that call, leave anchor state
      unseeded so the next call is still treated as an acquisition attempt.

## 5. Reacquisition path

- [x] 5.1 Wire the shared loss counter (task 3.2) to trigger a multi-pose reacquisition call once
      it reaches `reacquisitionLossThreshold`, in both crop-enabled and crop-disabled
      configurations.
- [x] 5.2 Implement the reacquisition scoring heuristic: IoU against the last known bounding box
      first; on all-zero IoU, fall back to closest-bbox-center-within-threshold; on no candidate
      within threshold, fall back fully to the acquisition heuristic (task 4.2).
- [x] 5.3 On a successful reacquisition, reset the loss counter and update the anchor bounding
      box from the selected candidate, resuming ordinary single-pose (optionally crop-mode)
      tracking on subsequent calls.
- [x] 5.4 Confirm the crop-mode-specific fallback-to-full-frame behavior (existing "Sustained
      tracking loss falls back to full-frame detection" scenario) now composes with this path:
      the first full-frame call after threshold is the multi-pose reacquisition call, not a plain
      single-pose call.

## 6. Kill-switch and equivalence guarantees

- [x] 6.1 Add/adjust unit tests asserting `personOfInterest.enabled: false` fully bypasses this
      change (no multi-pose calls issued, byte-identical to pre-change behavior), mirroring the
      existing tracking-crop kill-switch tests in `movenet.test.ts`.
- [x] 6.2 Add a unit test for the "exactly one person present" acquisition scenario, asserting
      the resulting `PoseFrame` is value-equivalent to what the single-pose path would produce
      for the same person (per the MODIFIED spec's scenario).
- [x] 6.3 Add unit tests for the acquisition heuristic (multiple candidates → highest bbox-area×
      confidence wins) and the reacquisition heuristic (continuity-scored candidate wins over a
      higher-scoring-by-area-alone candidate; zero-IoU proximity fallback; no-match-falls-back-to
      -acquisition).

## 7. Live-browser validation

- [ ] 7.1 Add the reported clip (with permission) as a checked-in test fixture, alongside the two
      existing demo clips, per design.md's Risks/Trade-offs.
- [ ] 7.2 Run this repo's live-browser A/B harness (Playwright + real GPU, 3+ trials per clip) on
      both existing demo clips with `personOfInterest.enabled` on vs off, confirming no meaningful
      regression on these single-person control clips (detected-frame count, view confidence,
      per-metric confidence tiers).
- [ ] 7.3 Run the same harness on the new multi-person fixture, confirming the tracked skeleton no
      longer locks onto a background bystander at acquisition, and correctly reacquires the
      intended subject after the occlusion-driven confidence drop observed in the original report.
- [ ] 7.4 Record the A/B results (same format as this repo's existing MoveNet/tracking-crop A/B
      tables) in this change's design.md or a follow-up note, and make the final default-on/off
      call per design.md's Migration Plan.

## 8. Cleanup

- [ ] 8.1 Update `CLAUDE.md`'s pose-detection/backlog sections to reflect the shipped
      acquisition/reacquisition behavior, following this repo's existing documentation pattern
      for backend changes.
- [ ] 8.2 Run `openspec archive multi-person-acquisition --yes` once shipped and verified, folding
      this delta into `openspec/specs/pose-detection/spec.md`.
