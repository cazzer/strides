# Judge shrinkage against the track's recent peak (strides-p1qt.18)

## Why

After strides-p1qt.15, private IMG_9345 tracks the runner from f13, but cadence is still withheld
(GT 190). As she leaves the frame through the left edge (f107–114) her box shrinks 244k → 97k px²
over five frames, each step within the scale bound. At f115 MoveNet's crop is on the background
runner who had been overlapping her (GT: directly behind her head and torso, f104–109), at 45k px².
That is within 3× of her last, already shrunken box. The online continuity gate and retroactive
segmentation both compare against the PREVIOUS box only (`isBoundingBoxContinuous`), so both follow
the hand-over: the winning segment runs to f134. Its hip trace steps ~200 px, and the sinusoid fit
locks onto 1.2 Hz (R² 0.21). Dropping those frames gives cadence 186.

The frame-to-frame scale test is a ratchet: a track can be walked down to any size, a bounded step
at a time, and then handed to whoever is beside it.

## What Changes

- Shared geometry (`movenetCrop.ts`): `isAboveRecentPeakFloor` and `recentPeakAreaPx`. A candidate
  more than `maxAreaRatio` smaller than the largest box the same track produced in the last
  `shrinkReferenceWindowSeconds` (0.5 s) is not continuous. A box the frame edge truncates
  (`isTruncatedByFrameEdge`: hull within 2% of the frame's shorter side of an edge) is exempt,
  because the edge explains why it is small. Growth is still judged frame to frame only.
- Retroactive segmentation: the peak is taken over the current segment's accepted chain;
  `personSelection.shrinkReferenceWindowSeconds` (0 disables).
- Online continuity gate: the same rule, available with the peak taken over the current identity's
  anchor boxes (`personOfInterest.continuityGate.shrinkReferenceWindowSeconds`), but shipped at 0
  (off). Measured: the retroactive window alone fixes IMG_9345. Adding the online one changes
  nothing there, and it moves multiperson's cadence/VO/VR from normal to caveated.
- Both new keys are registered in the A/B driver.
- The area floor is unchanged (closed decision, `area-floor.md`). This is a continuity rule
  between consecutive detections, not a size floor.

## Capabilities

### Modified Capabilities
- `person-selection`: segmentation also cuts on shrinkage below the segment's recent peak.
- `pose-detection`: steady-state anchor acceptance can also refuse shrinkage below the identity's
  recent peak (off by default).

## Impact

`src/pose/backends/movenetCrop.ts`, `movenet.ts`, `personOfInterestConfig.ts`,
`src/results/retroactivePersonSelection.ts`, `scripts/ab-person-selection.mjs`, and their tests.
