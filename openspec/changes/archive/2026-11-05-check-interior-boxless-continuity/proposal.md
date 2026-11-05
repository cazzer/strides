# Check interior boxless frames for position continuity (strides-p1qt.2)

## Why

`restrict-boxless-survival` (#55) narrowed boxless survival to the winner's evidenced interior but
left the interior itself unchecked, by design: a detection with fewer than `minConfidentKeypoints`
confident non-head keypoints between the winner's first and last surviving box rides through by
reference, so a sub-floor intruder there is still nulled at 5 confident keypoints and kept at 3.

That residue is not theoretical. On private clip IMG_9346 (side view) a far spectator's skeleton is
the detection at t=0.8833 s (3 confident keypoints) and t=0.9 s (1), both inside the runner's
evidenced interior. Its hips pull the hip trace by about −475 px, the hip-bounce fit's R² falls to
0.21, and the R² gate withholds cadence and vertical oscillation for the whole clip.

## What Changes

- Inside the winner's evidenced interior, a boxless detection is kept only when the hull of its
  confident keypoints (`deriveBoundingBox(keypoints, minKeypointConfidence, 1)`) touches, overlaps,
  or lies within the existing `maxCenterSpeedSidesPerSecond` bound of the nearest surviving box
  before it or after it. Otherwise its frame is nulled. A boxless detection with no confident
  non-head, non-foot keypoint (a null hull) is still kept.
- New diagnostics field `rejectedDiscontinuousBoxless: number` on `PersonSelectionDiagnostics`,
  separate from the other three rejection buckets; `detectedSamplesOut` subtracts it.
- `src/pose/backends/movenetCrop.ts` exports `isPositionContinuous` (the position half of
  `isBoundingBoxContinuous`, which now calls it; behaviour bit-identical for the online gate and
  the scale-pass agreement check).
- No new tunable. The rule runs after segmentation and scoring, so segments, `bridgedCuts` and
  `separationRatio` cannot change.

## Capabilities

### Modified Capabilities
- `person-selection`: the interior-residue paragraph of "An unverifiable detection survives only
  inside the winner's evidenced interior" is replaced by a new requirement that checks interior
  boxless detections for position continuity.
- `analysis-diagnostics`: the always-reported person-selection block lists the new count.

## Impact

- `src/results/retroactivePersonSelection.ts`, `src/pose/backends/movenetCrop.ts` and their tests;
  diagnostics literals in three result tests; `docs/agent-notes/harness.md`.
- Offline replay (6 probe lines, 3 private clips, both passes): IMG_9346's primary pass nulls 2
  frames and recovers cadence 176.4 spm, VO ratio 0.1678, R² 0.825; the other five lines are
  unchanged with a count of 0.
