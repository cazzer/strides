## 1. Config plane

- [x] 1.1 Define `TrackingCropConfig` and `DEFAULT_TRACKING_CROP_CONFIG` in
      `src/pose/backends/trackingCropConfig.ts`. No override machinery of its own — see section 5
      (folds into `poseBackendConfig.ts`'s existing, real override surface instead).

## 2. Pure crop-geometry functions

- [x] 2.1 Implement `deriveBoundingBox(keypoints, minKeypointConfidence, minConfidentKeypoints)`
      and `computeCropRect(box, frameWidth, frameHeight, paddingMultiplier, minCropSidePx)` (plus
      `BoundingBoxPx`/`CropRectPx` types) in `src/pose/backends/movenetCrop.ts` — no canvas or
      detector dependency
- [x] 2.2 `src/pose/backends/movenetCrop.test.ts`: `deriveBoundingBox` (all confident → correct
      min/max; boundary count → non-null; one below → null; mixed confidence → box from
      qualifying points only) and `computeCropRect` (centered case; edge-clamped by shifting, not
      shrinking; oversized bbox capped to `min(frameWidth, frameHeight)`; degenerate bbox floored
      to `minCropSidePx`)

## 3. MoveNet backend rewrite

- [x] 3.1 Confirm `estimatePoses`'s real signature, `reset()`'s effect, and
      `MOVENET_SINGLEPOSE_LIGHTNING_RESOLUTION`/`MOVENET_SINGLEPOSE_THUNDER_RESOLUTION` against
      the installed package's actual source (not just its `.d.ts`) — see design.md's Context
- [x] 3.2 Add `MODEL_INPUT_RESOLUTION: Record<MoveNetModelType, number>` (192 lightning / 256
      thunder) local constant and a reusable `cropCanvas`/`cropCtx` pair, sized to the active
      `modelType`, to `createMoveNetDetector`'s closure, created once per detector instance
- [x] 3.3 Rewrite `estimatePose` as the state machine in design.md: `enabled: false` bypass with
      zero state touched; crop-mode vs. full-frame branch selection from `lastBoundingBox`;
      `reset()` only on the mode-transition call, in either direction (revised in code review —
      see section 8; originally fired on every crop-mode call, which wiped MoveNet's own
      smoothing continuously through steady-tracking segments for no correctness benefit); keypoint
      remap from crop-canvas space back to video-pixel space; `deriveBoundingBox` run on every
      usable result to update tracking state; reacquisition-loss counting and threshold fallback
- [x] 3.4 `createMoveNetDetector` gains a new, optional `trackingCropConfig` parameter (default
      `DEFAULT_TRACKING_CROP_CONFIG`) as its **second** parameter, after the existing
      `modelType: MoveNetModelType = 'lightning'` first parameter (MoveNet Lightning/Thunder
      selection — already shipped separately, real in this codebase; not this change's own work)

## 4. MoveNet backend tests

- [x] 4.1 Confirm the existing (now 5, incl. the already-shipped Thunder-selection test)
      `movenet.test.ts` tests pass unmodified in behavior (cold-start call still takes the
      untouched full-frame branch) — add canvas-2D-context stubbing to the file's setup so
      detector construction doesn't throw in jsdom
- [x] 4.2 Cold start: `estimatePoses` called with `video` directly, not a canvas
- [x] 4.3 Engage + steady track: a full-confidence detection engages tracking; the next call
      asserts `estimatePoses` called with the crop canvas and `drawImage` called with the
      hand-computed expected source rect
- [x] 4.4 Coordinate round-trip: known crop rect + known canvas-space mock keypoint → returned
      `PoseFrame` keypoint x/y equals the hand-computed full-frame value
- [x] 4.5 Reacquisition: exactly `reacquisitionLossThreshold - 1` not-usable crop-mode frames →
      still crop mode; one more → next call uses `video` directly (boundary-tested both sides)
- [x] 4.6 `enabled: false`: `estimatePoses` is always called with `video`, never a canvas, even
      when fed data that would otherwise engage tracking
- [x] 4.7 `reset()` call-timing: fires only on the mode-transition call, in either direction;
      never mid-steady-tracking; never during a run of consecutive full-frame-only calls
- [x] 4.8 Off-screen start/end sequence: empty `poses: []` for several calls → full-confidence
      fixture engages tracking → several steady-tracking calls → degrading-confidence fixtures
      over `reacquisitionLossThreshold` calls falls back → empty `poses: []` again stays in
      full-frame mode without oscillating
- [x] 4.9 Thunder variant: crop canvas/drawImage destination sized to 256, not 192, when
      `modelType: 'thunder'` (crop-rect geometry itself is unaffected — only destination size)

## 5. Config plumbing

**Note:** `src/pose/poseBackendConfig.ts` (with `resolvePoseDetectorConfig()`,
`window.__STRIDES_POSE_BACKEND_OVERRIDE__`) and `detector.ts`'s multi-backend registry with
`movenetModelType` are real, already-shipped code in this codebase (not built as part of this
change) — confirmed after an initial pass mistakenly targeted a stale baseline where they didn't
exist yet; reconciled onto the real state before finishing this change.

- [x] 5.1 `PoseDetectorConfig` (`src/pose/detector.ts`) gains `trackingCrop?: TrackingCropConfig`
      alongside the existing `movenetModelType?`; registry line passes both through:
      `createMoveNetDetector(config.movenetModelType, config.trackingCrop)`
- [x] 5.2 `poseBackendConfig.ts`: `DEFAULT_POSE_DETECTOR_CONFIG` gains
      `trackingCrop: DEFAULT_TRACKING_CROP_CONFIG`; `resolvePoseDetectorConfig()` shallow-merges
      `trackingCrop` one level deep (mirroring `resolveSamplingRobustnessConfig`'s nested
      `robustness` merge); the window override's type gains a nested `trackingCrop?:
      Partial<TrackingCropConfig>` field. `usePoseDetector.ts` needs no changes — it already calls
      `createDetector(resolvePoseDetectorConfig())`.
- [x] 5.3 `poseBackendConfig.test.ts`: update `DEFAULT_POSE_DETECTOR_CONFIG` and the
      override-in-a-dev-build assertions to include `trackingCrop`; add tests for the
      `trackingCrop` override's shallow merge and its DEV-gating
- [x] 5.4 `detector.test.ts`: fix the existing `movenetModelType`-pass-through assertion for the
      registry's new second argument; add tests asserting `trackingCrop` (and both fields
      together) are passed through to `createMoveNetDetector`

## 6. Test infra

- [x] 6.1 Add `drawImage: ReturnType<typeof vi.fn>` to `FakeCanvasRenderingContext2D`
      (`src/test/canvasTestUtils.ts`) so crop-mode tests can assert exact source-rect arguments

## 7. Docs

- [x] 7.1 Update CLAUDE.md: extend the existing `window.__STRIDES_POSE_BACKEND_OVERRIDE__` bullet
      to document its new `trackingCrop` field (not a separate override global); update the
      Backlog paragraph to note input preprocessing now has a pluggable stage (leave
      live-verification numbers as a TODO — not run as part of this implementation pass)

## 8. Code review fixes (post-implementation)

**Note:** all three caught in review, none part of the original design; see design.md's
Decisions and Risks/Trade-offs for the reasoning. All self-contained to `movenet.ts` — no
`PoseDetector` interface change, no `usePoseDetector.ts`/`useVideoAnalysis.ts` change.

- [x] 8.1 🔴 Cross-run state leak: `usePoseDetector.ts` caches one detector instance for the app's
      whole lifetime, so `lastBoundingBox` tracked near the end of clip A was leaking into clip
      B's opening frames. Fixed via `lastSeenTime` monotonicity — a call whose `video.currentTime`
      drops more than `NEW_RUN_TIME_DROP_SEC` (0.5s) below the highest value seen so far clears
      all tracking state and calls `rawDetector.reset()` before proceeding. Test: two sequential
      simulated runs through the same detector instance; the second run's first call does not use
      a crop derived from the first run's tracked bbox. Boundary test: ordinary small backward
      jitter within one run does not falsely trigger it.
- [x] 8.2 🟡 `reset()` on every crop-mode call wiped MoveNet's own one-euro smoothing filter
      continuously through steady-tracking segments (confirmed via `resetFilters()` in the
      installed package) for no correctness benefit (a same-size square canvas makes
      `initCropRegion` resolve to full coverage regardless of stale `cropRegion` state). Fixed:
      `reset()` now fires only on the actual mode-transition call, symmetric with how the
      crop→full-frame direction already worked. `reset()` call-timing tests (4.7) rewritten for
      the new, more restrictive pattern.
- [x] 8.3 🟡 Reentrancy: `sampleClip.ts`'s per-call timeout doesn't cancel the underlying detector
      call on expiry, so a stalled crop-mode call can still be pending when a newer call starts on
      the same detector instance, sharing `cropCanvas`/`cropCtx` and the tracking-state closure
      with no guard. Fixed via a generation counter: every call captures `myGeneration` at start;
      after its `await` resolves, shared-state writes (`lastBoundingBox`,
      `consecutiveLowConfidence`, `previousCallUsedCrop`, `lastSeenTime`) are gated on
      `myGeneration === generation`, applied on *every* current call (including
      `poses.length === 0` ones — an intermediate regression caught while implementing this fix,
      not pre-existing, since `previousCallUsedCrop`/`lastSeenTime` need to advance regardless of
      detection success). A stale call still returns whatever it detected. Test: a stale call's
      late-arriving low-confidence result must not clobber a newer call's already-established
      tracking (uses `reacquisitionLossThreshold: 1` so an unguarded clobber would be immediately
      observable as a fallback to full-frame).
- [x] 8.4 Updated design.md (Decisions, Risks/Trade-offs) and added a new spec.md requirement
      ("Tracking state does not leak across separate analysis runs") for 9.1's user-facing
      behavior change; 9.2/9.3 are internal call-timing/robustness details covered by design.md
      and unit tests, not separate spec requirements.

## 9. Verification

- [x] 9.1 `npx tsc -b` passes
- [x] 9.2 `npx vitest run` passes
- [x] 9.3 `npx eslint .` passes
- [x] 9.4 `openspec validate movenet-tracking-crop --strict` passes
