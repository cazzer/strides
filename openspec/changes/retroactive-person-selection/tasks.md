# Tasks

## 1. Shared continuity predicate

- [x] 1.1 Add `isBoundingBoxContinuous(candidate, reference, elapsedSeconds, bounds)` and its
  `BoundingBoxContinuityBounds` shape to `src/pose/backends/movenetCrop.ts`, composing
  `(computeBoundingBoxIoU > 0 || isWithinCenterSpeedBound) && isBoundingBoxAreaRatioWithin` and
  nothing else — no guard logic.
- [x] 1.2 Have `movenet.ts`'s `isContinuousWithAnchor` delegate to it, keeping its own
  `gate.enabled` / `anchor === null` / `personOfInterestSuspended` early returns. Drop the
  now-unused `isWithinCenterSpeedBound` import.
- [x] 1.3 Prove behaviour-neutrality: every existing test in `src/pose/backends/movenet.test.ts`
  stays green with NO edits to any assertion. (Verified — that file is untouched by this change.)
- [x] 1.4 Cover the extracted predicate in `movenetCrop.test.ts`, including an exhaustive
  truth-table check against the two primitives it composes and a bounds-are-honoured case.

## 2. The selection stage

- [x] 2.1 New `src/results/retroactivePersonSelection.ts`: pure, no `window`, no refs, no mutation
  of input.
- [x] 2.2 `RetroactivePersonSelectionConfig` + `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG`.
- [x] 2.3 `PersonSelectionSegmentDiagnostics` + `PersonSelectionDiagnostics`.
- [x] 2.4 `selectRetroactivePersonOfInterest(samples, frameWidth, frameHeight, config)`:
  derive boxes → apply the frame-fraction area floor → segment at discontinuities (predicate OR
  time gap) → total contiguous index partition → score by integrated area → null everything
  outside the winner.
- [x] 2.5 Fail open with a typed `skipReason` on `disabled`, `unknown-frame-size`,
  `no-detections`, `no-detection-above-floor` — returning the input array by reference.
- [x] 2.6 Reference-identity guarantee: survivors come back `===` their input entries; rejections
  are exactly `{ timestamp, frame: null }`.

## 3. Config plane

- [x] 3.1 Fold `personSelection` into `SamplingRobustnessConfig`, mirroring `sequentialSampling` —
  same nested-partial override type extension, same one-level-deep merge. No new `window` global.
- [x] 3.2 Cover the merge, the kill switch, and the untouched-plane default in
  `samplingRobustnessConfig.test.ts`.

## 4. Diagnostics

- [x] 4.1 `AnalysisDiagnostics` gains an always-present `personSelection` field;
  `computeAnalysisDiagnostics` takes it as a 5th parameter and surfaces it by reference.
- [x] 4.2 Document `sampling.detectedFrames` as post-selection, with
  `personSelection.detectedSamplesIn` as the pre-selection counterpart.
- [x] 4.3 Leave `scaleCalibration`'s conditional spread and its tests untouched.

## 5. Seam

- [x] 5.1 Call the stage in `runClipAnalysisPipeline` immediately after the sort and before
  `applyRobustness`; feed the selected samples to both `applyRobustness` and
  `computeAnalysisDiagnostics`.
- [x] 5.2 Add the `frameSize` parameter and pass `{ width: metadata.width, height: metadata.height }`
  at both `useVideoAnalysis.ts` call sites (primary run and background scale pass).
- [x] 5.3 Pipeline tests: selection runs after the sort; `applyRobustness` gets selected samples;
  `detectedFrames` post- vs `detectedSamplesIn` pre-selection; with the stage disabled the whole
  result deep-equals a baseline computed without it.

## 6. Unit tests for the stage

- [x] 6.1 Single smooth track → one segment, frames reference-identical; 1:1 output length and
  timestamps; input never mutated.
- [x] 6.2 The measured #51 trace modelled → picks the runner, `separationRatio` ≈ 12.
- [x] 6.3 Floor: nulls sub-floor detections, they never start or cut a segment, they are nulled
  even inside the winner, all-below-floor skips unchanged.
- [x] 6.4 Resolution independence: identical geometry at 1080p and 4K decides identically.
- [x] 6.5 Segmentation: an interior null gap does not cut; a gap > `maxContinuityGapSeconds` does;
  a 10x same-position area change cuts; a teleport cuts over a short elapsed time but not a long
  one; boxless frames ride with their segment contributing 0 area (and are nulled with a losing
  one); the partition is total and tiles the clip; a single isolated detection wins and survives.
- [x] 6.6 Never-substitute: every survivor `===` its input, every rejection exactly
  `{ timestamp, frame: null }`.
- [x] 6.7 Fail-open: disabled, bad frame size (5 shapes), empty, all-null, all-boxless.
- [x] 6.8 Diagnostics reporting: segments sorted DESC and capped at 10; no separation ratio for a
  single segment; `detectedSamplesOut` reconciles with both rejection counts.

## 7. Live-browser verification

- [x] 7.1 Arm A — fixture, 3 trials, stage on: selected, `segmentCount >= 3`, winner is the runner,
  `separationRatio >= 3`, `rejectedBelowFloor > 0`, `detectedFrames` materially below
  `detectedSamplesIn`. **PASS** (sep 39–46, winner median 31,905–31,937 px²).
- [x] 7.2 Arm B — same clip, 3 trials, `{ enabled: false }`: skipped/disabled, `detectedFrames ===
  detectedSamplesIn`. **PASS.**
- [x] 7.3 Arm C — both demo buttons, 3 trials each: `segmentCount === 1`, zero rejections, metrics
  within run-to-run noise of arm B. **Demo 2 PASS; Demo 1 FAIL** (segmentCount 5–6, 13–16
  rejections, five genuine runner frames lost).
- [x] 7.4 Root-cause the Demo 1 failure with a temporary `[bbox-trace]` probe + keyframe review;
  revert the probe and prove it with `git diff`. **Done** — a single collapsed detection at t=4.32
  wedges the runner's continuous 55-frame track apart.
- [x] 7.5 Evaluate the pre-registered ship rule and record the outcome in design.md. **Ships
  `enabled: false`.**
- [x] 7.6 Re-verify after flipping the default: default off is a no-op on all three clips, and the
  `{ enabled: true }` override reproduces arm A exactly.

## 8. Documentation

- [x] 8.1 Update CLAUDE.md's "Config overrides" for the `personSelection` key and "Reading results"
  for the `personSelection` diagnostics block and the `sampling.detectedFrames` semantic shift.
- [ ] 8.2 Archive this change once shipped and verified — **after**
  `add-webcodecs-sequential-sampling`, which modifies the same three requirements (see design.md's
  follow-up 4).
