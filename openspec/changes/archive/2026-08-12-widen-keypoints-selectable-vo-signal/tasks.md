# Tasks — widen keypoints, selectable VO signal

## 1. Widen the keypoint type surface (D1)
- [x] Append `nose`, `left_ear`, `right_ear` to `COMMON_KEYPOINT_NAMES` (`src/pose/types.ts`)
- [x] Count-free docstrings: `PoseFrame.keypoints` (`src/pose/types.ts`),
      `RobustPoseFrame.keypoints` (`src/pose/robustness/types.ts`), `keypoints.ts`'s
      `findKeypoint` error-path comment
- [x] `npx tsc -b` and fix compile fallout (`syntheticGait.ts`'s exhaustive switch)

## 2. Synthetic-gait head model (D-fixture)
- [x] `headBounceDamping` param (default 0.85) on `SyntheticGaitParams`
- [x] Head (nose + ears) as a rigid unit above the shoulder baseline, phase-locked to hip bounce,
      independently-scaled amplitude
- [x] T8: head bounce amplitude = hip amplitude × `headBounceDamping`, phase-locked (covered by
      T9's `earMid` tests reading the fixture's hand-computable expected value)

## 3. Adapter-boundary test coverage (T1–T4)
- [x] T1 `common.test.ts`: 15 names in order; only `left_eye`/`right_eye` remain dropped;
      nose/ears pass through x/y/score; zero-score default extended to a head name
- [x] T2 `movenet.test.ts`: ears/nose reach the frame from `MOVENET_RAW_KEYPOINTS`
- [x] T3 `mediapipePoseLandmarker.test.ts`: landmark index 0→nose, 7→left_ear, 8→right_ear,
      denormalized like every other point; `pixelsPerMeter` tests unchanged
- [x] T4 `blazepose.test.ts`/`posenet.test.ts` still pass (compile-only, both backends stay
      broken/unfixed); `left_ear`/`right_ear` added to the BlazePose fixture for compile-exercise

## 4. Robustness-layer coverage (T5)
- [x] `confidenceFilter.test.ts`/`interpolate.test.ts`: 12→`COMMON_KEYPOINT_NAMES.length` count
      assertions
- [x] T5: new head channel (`nose`) gap-fills independently of a limb channel, same mechanism as
      the existing "one keypoint's gap doesn't affect another's" test

## 5. Diagnostics coverage (T6)
- [x] T6: `analysisDiagnostics`'s `keypoints` record has one entry per `COMMON_KEYPOINT_NAMES`
      name; head counts (`nose`/`left_ear`/`right_ear`) aggregate identically to any limb name

## 6. Skeleton overlay (D2, T7)
- [x] `SKELETON_EDGES` gains the head triangle + two neck anchors
- [x] T7: head points drawn; all 4 new edges present when resolvable; edges skipped when an ear is
      unrecoverable; a head-less frame (nose/ears unrecoverable) produces identical ops to the
      pre-head skeleton

## 7. Signal selection (D3)
- [x] `VerticalOscillationSignal` type + `HeuristicsConfig.verticalOscillationSignal` (default
      `'hipMid'`) in `src/heuristics/types.ts`
- [x] `hipBounce.ts`: generalize to `analyzeBounceSignal(frames, config, pair)`; keep
      `analyzeHipBounce` as a hip-pinned wrapper so `cadence.ts` is unchanged
- [x] `verticalOscillation.ts`: `SIGNAL_KEYPOINTS`/`SIGNAL_LABEL` maps; resolve the configured pair
      once per call; no cross-signal fallback on an unresolvable frame; caveats name the signal
- [x] T9: all existing default-config (`hipMid`) expectations pass UNTOUCHED (proof the default is
      preserved); `earMid` recovers `verticalBouncePx * headBounceDamping / TORSO_LENGTH_PX`;
      `earMid` with ears unrecoverable → null + head-named caveat WHILE `hipMid` on the identical
      frames still reports (pins no-fallback); single-ear frames → value with
      `interpolatedFraction > 0`; caveats name the configured signal

## 8. Verified no-op pins (D6, D7)
- [x] T10 `viewDetection.test.ts`: identical output whether head keypoints are wildly placed or
      fully unrecoverable
- [x] T11 `verticalOscillationCm.test.ts`: identical output regardless of head-keypoint bounce
      amplitude (function takes no config, stays hip-based unconditionally)

## 9. Full local verification
- [x] `npx tsc -b` clean
- [x] `npx vitest run` — full suite green
- [x] `npx eslint .` clean

## 10. Live A/B (pre-registered rule already written in design.md D4)
- [x] Probe: `useVideoAnalysis.ts`'s `start()`, right after `computeFormHeuristics(metricFrames)`,
      dev-only, logs `[vo-signal-ab]` with both signals' `{value, confidence, frameCoverage,
      interpolatedFraction, sampleSize, caveatPresent, fit}`
- [x] Run: 2 clips (track, park) × 5 trials each, real GPU MoveNet, paired (both signals per run)
- [x] Discard/re-run any trial where `sampling.totalSamples === 1` (known collapse mode) — none
      occurred, no re-runs needed
- [x] Apply the D4 rule AS WRITTEN; paste the numbers + gate-by-gate evaluation into design.md's
      "Live A/B results" section — gate (a) fails on both clips, gate (c) fails on track;
      **decision: `hipMid` stays default**
- [x] Revert the probe (`git checkout -- src/results/useVideoAnalysis.ts`)
- [x] Default stays `hipMid`: no further code change; outcome (with numbers) noted in CLAUDE.md

## 11. MediaPipe confirmation + close-out
- [x] 1 MediaPipe PoseLandmarker trial per clip (`window.__STRIDES_POSE_BACKEND_OVERRIDE__` via
      `addInitScript`) — confirmed the widened 15-entry keypoints record with nonzero detected
      nose/ear counts on both clips, and `scaleCalibration.verticalOscillationCm` on the track
      clip is undisturbed (6.075cm, `torsoMeters` 0.505) — proves #32's calibration path is
      unaffected
- [x] `openspec validate widen-keypoints-selectable-vo-signal --strict`
- [x] Final `npx tsc -b && npx vitest run && npx eslint .`
- [ ] Commit on `feat/30-head-keypoints`
