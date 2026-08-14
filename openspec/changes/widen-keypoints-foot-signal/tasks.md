# Tasks — widen keypoints, foot signal

## 1. Widen the keypoint type surface
- [x] Append `left_heel`, `right_heel`, `left_foot_index`, `right_foot_index` to
      `COMMON_KEYPOINT_NAMES` (`src/pose/types.ts`)
- [x] `npx tsc -b` and fix compile fallout (`syntheticGait.ts`'s exhaustive switch — the only
      fallout, matching #30's finding that every other consumer is name-driven)

## 2. Synthetic-gait foot model (D1)
- [x] `HEEL_BEHIND_ANKLE_PX` (15) / `FOOT_INDEX_AHEAD_ANKLE_PX` (22) constants
- [x] Rigid fore-aft offset from each side's own ankle, at the ankle's own y, scaled by
      `FRONT_VIEW_ANKLE_SWAY_FACTOR` in front view — 4 new `case` arms in the exhaustive switch
- [x] No new `SyntheticGaitParams` field (nothing consumes these points yet — see design.md D1)

## 3. Adapter-boundary test coverage
- [x] `common.test.ts`: `toHaveLength(15)` → `toHaveLength(19)`; pass-through test for the 4 foot
      names (local raw-keypoint literal, since `MOVENET_RAW_KEYPOINTS` never carries foot points);
      zero-default test for a missing foot name
- [x] `movenet.test.ts`: new test asserting heel/foot_index resolve to the zero-score default
      (NOT pass-through, unlike the nose/ear precedent — MoveNet genuinely never produces these)
- [x] `mediapipePoseLandmarker.test.ts`: mirror the existing indices-0/7/8 test at indices
      29/30/31/32
- [x] `blazepose.test.ts`: one new assertion that a foot keypoint now passes through correctly
      (fixture already had the data since #30)
- [x] `blazepose-keypoints.fixture.ts`: doc comment corrected (data unchanged)

## 4. Robustness-layer coverage
- [x] `interpolate.test.ts`: mirror the existing "gap-fills a head channel independently" test for
      a foot channel (`left_heel`)

## 5. Diagnostics coverage
- [x] `analysisDiagnostics.test.ts`: extend the existing "one entry per COMMON_KEYPOINT_NAMES
      name" test with foot-name assertions (all 4 names, mixed detected/interpolated/unrecoverable)

## 6. Skeleton overlay
- [x] `SKELETON_EDGES` gains the foot triangle per ankle (6 entries total)
- [x] `skeletonGeometry.test.ts`: mirror the existing 4-test head-keypoint group — foot points
      drawn; all 6 new edges present when resolvable; edges skipped when heel/foot_index is
      unrecoverable; a foot-less frame produces identical ops to before feet were added

## 7. Tracking-crop bounding-box decision (D2)
- [x] `BBOX_EXCLUDED_KEYPOINT_NAMES` gains the 4 new foot names explicitly (not incidental
      zero-score reliance) — reasoning in design.md D2
- [x] Doc comment split into two paragraphs: existing empirical (A/B-evidence) rationale for head
      keypoints, unchanged; new paragraph for foot points explaining the different (topological +
      defensive) reason
- [x] `movenetCrop.test.ts`: new tests mirroring "excludes head keypoints from the box even when
      confident" / "does not count excluded head keypoints toward minConfidentKeypoints" for the
      4 foot names

## 8. Spec delta
- [x] MODIFIED `Requirement: Pose frame type contract` — "Fixed-length, fixed-order keypoints"
      scenario, 15→19
- [x] MODIFIED `Requirement: Common keypoint subset restricts backend surface` — 15→19 entries,
      updated name list
- [x] MODIFIED `Requirement: MoveNet tracking-crop preprocessing` — incidentally-stale "15" found
      during implementation, not part of the original plan; fixed in the same spirit (see
      design.md's closing note)
- [x] No `pose-robustness` or `form-heuristics` delta — confirmed already fully count-free from
      the prior (#30) widening

## 9. Full local verification
- [x] `npx tsc -b` clean
- [x] `npx vitest run` — full suite green except one pre-existing, unrelated failure
      (`VideoInputPanel.test.tsx`'s demo-button label regex, confirmed failing identically on
      `main` before this change touched anything)
- [x] `npx eslint .` clean
- [x] `openspec validate widen-keypoints-foot-signal --strict`

## 10. Close-out
- [x] Live-browser verification: headless Chromium, real GPU (`ANGLE Metal Renderer: Apple M4
      Pro`, confirmed via `WEBGL_debug_renderer_info`), `mediapipePoseLandmarker` backend via
      `window.__STRIDES_POSE_BACKEND_OVERRIDE__`, track demo clip. `[analysis-diagnostics]`
      confirmed 19 keypoint names with all 4 foot names present and detected (57/57/57/57,
      matching the clip's known ~57 MediaPipe detectedFrames), `scaleCalibration` present, and
      every metric value matching this repo's documented track-clip baseline (cadence 91.2,
      verticalOscillationCm ~4.79, etc. — no regression). Screenshot at the clip's best-coverage
      timestamp shows a clean foot triangle at each ankle (heel behind, toe ahead, tracking the
      visible shoe), no floating-dot artifacts.
- [ ] Commit on `feat/44-widen-foot-keypoints`
