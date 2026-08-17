## Why

Issue #44 (child of epic #43). `COMMON_KEYPOINT_NAMES` (`src/pose/types.ts`, currently 15 entries)
is missing `left_heel`, `right_heel`, `left_foot_index`, `right_foot_index`. MediaPipe Pose
Landmarker's raw output already includes these at indices 29-32
(`MEDIAPIPE_POSE_LANDMARK_NAMES`, `src/pose/backends/mediapipePoseLandmarker.ts:33-40`) — they're
computed by the model and then silently dropped at the `toPoseFrame` adapter boundary before
robustness or heuristics ever see them. Same shape of gap as #30's head-keypoint widening.

MediaPipe-only: MoveNet/PoseNet use COCO-17 topology and structurally cannot produce these — on
those backends every new keypoint defaults to `{x:0,y:0,score:0}` via the existing "missing
subset keypoints default to zero score" contract in `toPoseFrame`, already tested behavior, no
new logic needed there. BlazePose's fixture already includes these 4 points (added in #30's
change in anticipation) — needs no fixture data edit, only its stale doc comment updated.

## What Changes

- **`COMMON_KEYPOINT_NAMES` widens from 15 to 19**: `left_heel`, `right_heel`,
  `left_foot_index`, `right_foot_index` appended (never interleaved, so every existing positional
  assumption stays undisturbed — same append-only reasoning #30 established for the head
  keypoints).
- **Skeleton overlay renders a foot triangle off each ankle**: `SKELETON_EDGES` gains 6 entries —
  `['left_ankle','left_heel']`, `['left_heel','left_foot_index']`,
  `['left_ankle','left_foot_index']`, mirrored for `right_*` — so the two new points per foot read
  as a foot shape instead of floating dots. No new logic needed in `toDrawOps`: the existing
  unrecoverable-endpoint skip rule already covers any name added to `SKELETON_EDGES`.
- **`syntheticGait.ts`'s exhaustive keypoint-name switch gains 4 new case arms**: heel/foot_index
  are modeled as a rigid fore-aft offset from the ankle (heel behind, foot_index ahead, along the
  ankle's own sway direction), at the ankle's own y, scaled by the existing
  `FRONT_VIEW_ANKLE_SWAY_FACTOR` in front view — see design.md D1. No metric consumes these points
  yet, so the bar is geometric plausibility for skeleton-overlay/robustness fixtures, not a
  hand-computable expected value the way the head model was.
- **`movenetCrop.ts`'s `BBOX_EXCLUDED_KEYPOINT_NAMES` gains the 4 new names explicitly** — a
  stated, tested decision rather than incidental reliance on MoveNet always zero-scoring them. See
  design.md D2 for the reasoning.
- **`blazepose-keypoints.fixture.ts`'s doc comment corrected** — it currently claims heel/foot
  index points "fall outside that subset and must be dropped," which was true before this change
  and is no longer true after it; the fixture's data was unchanged (added in #30 in anticipation
  of this widening).

## Impact

- Affected specs: `pose-detection` only (the two count-bearing requirements bump 15→19, plus one
  incidentally-stale "15" found in the tracking-crop requirement while implementing — see
  design.md D2 note). `pose-robustness` and `form-heuristics` need no delta: both are already
  fully count-free from the prior (#30) widening — every consumer there is name-driven off
  `COMMON_KEYPOINT_NAMES`, not a hardcoded count.
- Affected code: `src/pose/types.ts`, `src/results/skeletonGeometry.ts`,
  `src/heuristics/__fixtures__/syntheticGait.ts`, `src/pose/backends/movenetCrop.ts`,
  `src/pose/backends/__fixtures__/blazepose-keypoints.fixture.ts` (doc comment only), plus
  adapter-boundary and consumer test coverage (`common.test.ts`, `movenet.test.ts`,
  `mediapipePoseLandmarker.test.ts`, `skeletonGeometry.test.ts`, `interpolate.test.ts`,
  `analysisDiagnostics.test.ts`, `movenetCrop.test.ts`, `blazepose.test.ts`).
- No change to any metric calculation, `blazepose.ts`/`posenet.ts`'s broken end-to-end status (out
  of scope, unrelated), or `mediapipePoseLandmarker.ts` itself (its raw output already has these
  points at fixed indices — zero code change needed there).
