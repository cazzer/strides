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

- [x] 2.1 **Revised after the live-browser A/B (task group 10) found the original lazy-creation
      approach caused real, measured data loss** (park clip: cadence/vertical-oscillation lost
      entirely, all 3 trials; track clip: 1 of 3 trials collapsed to 0 detected frames, the other
      two lost 12-32% of samples; baseline fine across all 6 trials) — the original text below is
      struck through and superseded by what `src/pose/backends/movenet.ts` actually does now:
      ~~Add a lazy, memoized `MULTIPOSE_LIGHTNING` detector accessor in
      `src/pose/backends/movenet.ts`, created on first acquisition call rather than inside
      `createMoveNetDetector`, mirroring the existing scale-pass detector accessor's
      lazy-create/memoize/no-throw-on-failure pattern.~~ **Now:** create the `MULTIPOSE_LIGHTNING`
      detector EAGERLY, in parallel with the single-pose detector, inside `createMoveNetDetector`
      -- both awaited (`Promise.all`-shaped) before its returned promise resolves, the same
      treatment the single-pose model already gets, which `usePoseDetector.ts` already gates
      auto-analyze on. Skipped entirely when `personOfInterestConfig.enabled` is `false` -- the
      kill-switch kills this cost too. See design.md's "Create the MULTIPOSE_LIGHTNING detector
      eagerly, in parallel with the single-pose detector" for the full rationale and the
      superseded lazy-creation decision it replaces.
- [x] 2.2 Decide and implement the failure behavior when multi-pose detector creation itself
      fails (network/model-load failure): fall back to the existing single-pose full-frame call
      for that run rather than surfacing a hard error, so a multi-pose failure never regresses
      below today's baseline behavior. **Still true, relocated**: with eager creation (task 2.1,
      revised), the failure is now caught locally inside `createMoveNetDetector` at construction
      time, leaving the multi-pose reference `null` permanently for that detector instance (no
      retry -- there is no lazy accessor left to retry from); `estimatePose`'s dispatch logic
      already had to handle "multi-pose unavailable" as a per-call case, and continues to.

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

## 7. Continuity config additions

- [x] 7.1 Add `POST_ACQUISITION_SETTLE_FRAMES` (first-guess default `3`) as a new named constant
      in `personOfInterestConfig.ts`, same convention as `REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE`
      (bare module constant, not part of `PersonOfInterestConfig`, not independently overridable
      via `window.__STRIDES_POSE_BACKEND_OVERRIDE__`), documented as tuned-by-A/B, not final.
- [x] 7.2 Add `REVERIFICATION_INTERVAL_FRAMES` (first-guess default `45`) as a new named constant,
      same convention and same tuned-by-A/B documentation.

## 8. Settle-in window

- [x] 8.1 Add closure state tracking how many of the next calls should be forced into crop mode
      (e.g. `settleFramesRemaining`), reset to `POST_ACQUISITION_SETTLE_FRAMES` whenever a
      multi-pose acquisition selects a usable candidate, or a reacquisition/periodic
      re-verification event selects a usable candidate that is NOT continuous with the last known
      anchor (review F4 -- a continuous match confirms no new identity information exists, so it
      does not (re)start this window); cleared alongside the rest of anchor state by
      `clearAnchor()`/new-run detection.
- [x] 8.2 Extend the crop-vs-full-frame framing decision to
      `usingCrop = !dispatchMultiPose && boxForFraming !== null && (trackingCropConfig.enabled ||
      withinSettleWindow)`, reusing the existing `computeCropRect`/`cropCanvas`/crop-call code
      path as-is — no new crop-geometry logic. Snapshot the settle-window state synchronously
      before any `await`, matching the existing `anchorBoxAtStart` reentrancy-safety pattern (NEW-1/
      NEW-2), so a stale call's framing decision can't be corrupted by a newer call's progress.
- [x] 8.3 Decrement the remaining-settle-frames counter once per ordinary (non-multi-pose-dispatch)
      call, floored at zero, so the window naturally expires after `POST_ACQUISITION_SETTLE_FRAMES`
      calls with no intervening re-trigger; confirm this is a true no-op (no observable behavior
      change) whenever `trackingCropConfig.enabled` is already `true`.

## 9. Periodic re-verification

- [x] 9.1 Add closure state counting calls since the last (re)acquisition or re-verification event
      (e.g. `callsSinceLastVerification`), incremented once per ordinary steady-state call
      (multi-pose-dispatch calls don't count), reset to `0` by any successful multi-pose dispatch
      of any kind and by new-run detection.
- [x] 9.2 Add a third multi-pose dispatch trigger/reason alongside acquisition
      (`effectiveAnchorMissing`) and confidence-triggered reacquisition (`effectiveAnchorStale`):
      periodic re-verification, due when a confident, non-stale anchor's
      `callsSinceLastVerification >= REVERIFICATION_INTERVAL_FRAMES`. Dispatch reuses the exact
      same `selectByReacquisitionHeuristic`/`pickBestCandidate` call already built for
      confidence-triggered reacquisition (scored by continuity against the current anchor) — no
      new selection logic.
- [x] 9.3 On a usable periodic result: reset `callsSinceLastVerification` and update the anchor's
      bounding box in every case; for a NON-continuous result specifically (review F4 -- not a
      continuous one), also start a settle-in window (task 8) and apply the identical NEW-1/NEW-2
      treatment a non-continuous confidence-triggered reacquisition already gets
      (`rawDetector.reset()`, `anchorWasReacquired` treated as a fresh acquisition, not "already
      reacquired once"). A continuous result updates the anchor and the interval only -- no
      settle-in window, no `rawDetector.reset()` (review F4: no new identity information exists to
      act on, so forcing either would only discard working tracking continuity for no benefit).
- [x] 9.4 On an empty or not-usable periodic result: strict no-op on every anchor/give-up-budget
      counter (`consecutiveLowConfidence`, `consecutiveEmptyReacquisitions`, `anchorWasReacquired`,
      `personOfInterestSuspended`, `lastBoundingBox`) — only reset
      `callsSinceLastVerification` (so the next attempt waits a full interval rather than retrying
      every subsequent call, which would silently turn "periodic" into "continuous" multi-pose
      dispatch). The call itself falls through to the ordinary, already-in-progress single-pose
      call for that SAME sampled frame rather than resolving to no detection (review F2 -- the
      sampled frame must not be lost just because a speculative, safe-to-fail check happened to
      land on it); `advanceContinuityCounters`'s verification-counter increment is suppressed for
      that fallen-through call specifically, since the counter was already reset moments earlier
      in the same call. Multi-pose detector creation failure during a periodic attempt must be an
      equally strict no-op (fall through using the EXISTING anchor/framing unchanged, not the
      acquisition/reacquisition creation-failure path's `clearAnchor()`) — a periodic check failing
      to even start must never be allowed to degrade already-working steady-state tracking.
- [x] 9.5 Update/extend the kill-switch and equivalence unit tests: `personOfInterest.enabled:
      false` still issues zero settle-in/re-verification multi-pose calls (already guaranteed by
      the existing kill-switch tests, since `dispatchMultiPose` ANDs with `personOfInterestConfig
      .enabled` regardless of `dispatchReason`); the reset-timing tests account for the settle
      window's crop-mode calls and the new dispatch reason; added unit tests for the settle-in
      window's trigger/duration/no-op-when-crop-already-enabled behavior and for periodic
      re-verification's trigger/continuity-reset/non-continuous-correction/strict-no-op-on-empty/
      strict-no-op-on-not-usable/strict-no-op-on-creation-failure behavior, mirroring this file's
      existing test rigor and style.
- [x] 9.6 Re-review fixes (F1-F5): gated the settle-in window to genuine identity changes only
      (F4, `dispatchReason === 'acquisition' || !continuous`); an empty/unusable periodic check now
      falls through to the ordinary single-pose call for the same frame instead of resolving `null`
      (F2), requiring `usingCrop`/the transition-reset decision to move to AFTER the multi-pose
      dispatch attempt so it's computed from the FINAL `dispatchMultiPose` value rather than a
      stale pre-await one, and `advanceContinuityCounters` to take a flag suppressing the
      already-just-reset verification counter's double-increment on that fall-through call;
      `settleFramesRemainingAtStart` moved to snapshot AFTER the give-up block, not before it (F5);
      design.md's settle-in-window A/B justification rewritten from a self-correction argument
      (does not address the park-clip regression mechanism) to a duty-cycle one (F3); design.md
      Risks gained a periodic-structured-contamination entry for task 10.4's A/B to check
      `fit.sinusoidR2`, not just tier/detected-frame-count (F1). Four new tests added: settle-in
      window under mid-window loss of confidence (expires on schedule, crops around an
      increasingly stale box); two consecutive periodic re-verification cycles; reset-call-count
      on the shipped default (crop-disabled) config specifically; a settle window re-triggered
      mid-window (reacquisition landing inside an already-active window, low
      `reacquisitionLossThreshold`).

## 10. Live-browser validation

- [ ] 10.1 **Blocked — no multi-person clip exists in this repo or environment.** Add the reported
      clip (with permission) as a checked-in test fixture, alongside the two existing demo clips,
      per design.md's Risks/Trade-offs. Needs the user to supply the clip.
- [x] 10.2 Ran this repo's live-browser A/B harness (Playwright + real GPU, 3 trials per clip) on
      both existing demo clips with `personOfInterest.enabled` on vs off. Results in design.md's
      "Live-browser A/B results" section. Confidence tiers hold (no tier degrades) but this is NOT
      zero-cost — detected-frame/sample counts drop ~4-25% depending on clip. Recorded honestly,
      not glossed over; factored into the default-on call in 10.5.
- [ ] 10.3 **Blocked on 10.1.** Run the same harness on the new multi-person fixture, confirming the
      tracked skeleton no longer locks onto a background bystander at acquisition, and correctly
      reacquires the intended subject after the occlusion-driven confidence drop observed in the
      original report. This is the one thing that directly validates the fix against the actual
      reported bug — everything else in this change is regression-safety + mechanism soundness on
      single-person clips, not a demonstration the original bug is fixed.
- [ ] 10.4 **Not done — partial gap, documented, not silently skipped.** The A/B in 10.2 measured
      the COMBINED cost of acquisition/reacquisition + settle-in window + periodic re-verification
      together (that's the number that matters for the ship decision, and it's what's recorded).
      It was NOT decomposed into settle-window-only vs. re-verification-only contributions, since
      `POST_ACQUISITION_SETTLE_FRAMES`/`REVERIFICATION_INTERVAL_FRAMES` have no runtime override
      point (by design — see Migration Plan) and isolating them would need a temporary code patch
      not made this pass. Also still blocked on 10.1 for the multi-person-fixture half of this task.
- [x] 10.5 Recorded the A/B results in design.md's new "Live-browser A/B results" section (2026-08-15).
      Default-on/off call made: ship default-**on** per the Migration Plan's pre-registered rule
      (correctness fix for a live-confirmed bug, confidence tiers hold) — the settle-in
      window/periodic re-verification defaults are not separately called out because 10.4's
      decomposition wasn't run; they ship with the same default-on call as the whole feature.

## 11. Cleanup

- [ ] 11.1 Update `CLAUDE.md`'s pose-detection/backlog sections to reflect the shipped
      acquisition/reacquisition/settle-in-window/periodic-re-verification behavior, following this
      repo's existing documentation pattern for backend changes.
- [ ] 11.2 Run `openspec archive multi-person-acquisition --yes` once shipped and verified, folding
      this delta into `openspec/specs/pose-detection/spec.md`.
