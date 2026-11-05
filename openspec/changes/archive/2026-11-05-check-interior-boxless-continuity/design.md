# Design — check interior boxless frames for position continuity

## Root cause

`selectRetroactivePersonOfInterest` derives a box per detection with `minConfidentKeypoints: 4`. A
detection below that count gets no box, so it never reaches the area floor or the segmentation
continuity test. Since `restrict-boxless-survival` it survives only inside the winner's evidenced
interior, `[winner.evidenceFrom, winner.evidenceTo]`, but inside that span nothing about it is
checked.

On IMG_9346 (side view, primary pass) the two frames at t=0.8833 s and t=0.9 s are a far
spectator's skeleton with 3 and 1 confident keypoints, sitting between the runner's surviving boxes.
They pass through by reference, their hips pull the hip trace by about −475 px, and the hip-bounce
sinusoid fit drops to R² 0.21, below the gate, so cadence and VO are withheld.

## Rule

For each detection inside the winner's evidenced interior that is boxless (frame present, not
below the floor, `surviving[i] === null`):

1. `hull = deriveBoundingBox(keypoints, config.minKeypointConfidence, 1)`. This uses the same
   confidence gate and the same head/foot exclusion as every other box in the stage; only the count
   drops to 1, so a single confident joint is placed.
2. Null hull (zero confident non-head, non-foot keypoints): keep. There is nothing to place.
3. Otherwise keep if, against the nearest surviving box before **or** after it,
   `touches(hull, ref) || isPositionContinuous(hull, ref, |Δt|, config.maxCenterSpeedSidesPerSecond)`.
4. Else null the frame and count it in `rejectedDiscontinuousBoxless`.

`prevSurviving[]` / `nextSurviving[]` are built in two linear passes after the winner is picked, so
the rule is O(n).

The rule runs in the final map, after segmentation and scoring. It nulls only frames that never
contributed to a segment, so `segments`, `segmentCount`, `bridgedCuts` and `separationRatio` cannot
move. The offline replay confirms that on IMG_9346: the winning segment's record is identical before
and after.

## Why no new radius, against restrict-boxless-survival D1

D1 rejected "a distance/time radius around the nearest surviving detection" because it would add a
second, independently tunable bound for the question the segmentation bounds already answer. This
rule adds no bound. It asks the boxless frame the **same** position question segmentation asks of
two consecutive boxes, with the **same** `maxCenterSpeedSidesPerSecond`, against the same
neighbours. Scale is left out on purpose: a hull over 1-3 joints has an area that reflects how many
joints were confident, not how far away the person is, so `maxAreaRatio` would reject the runner's
own sparse frames.

## Point hulls need `touches`

`computeBoundingBoxIoU` is positive only for a positive-area intersection. A 1-point hull, or
several points on one line, has zero area, so its IoU is 0 even when it lies inside the neighbour's
box. A runner frame with 1 confident joint is exactly that case. `touches` is a closed-interval
overlap test, so contact or containment keeps the frame without relying on the speed term, which
measures from box centres and can fail for a joint at the box's edge.

## No time-gap term

The two neighbours of an interior boxless frame are consecutive surviving boxes of the winning
segment. Consecutive surviving boxes in one segment are always within `maxContinuityGapSeconds` of
each other: the adjacent check enforces it directly, and a bridged frame lies between a pair the
bridge checked against the same gap. The boxless frame lies between its neighbours, so its |Δt| to
either one is bounded by that gap too, and the speed budget never grows beyond
`maxCenterSpeedSidesPerSecond × side × maxContinuityGapSeconds`. A test pins the invariant,
including the bridged case.

## Residues it still admits

- **An intruder within the speed budget of a runner box.** The test is position-only and lenient:
  4 sides/s × the reference's side × |Δt|. A bystander whose joints sit next to the runner, or
  overlap the runner's box, is kept. That is the same tolerance segmentation gives box-yielding
  frames.
- **Sparse sampling widens the budget.** The budget scales with |Δt|. Where the sampler leaves long
  gaps (up to `maxContinuityGapSeconds`), the radius grows to as much as 4 sides, and a far intruder
  can pass. At the 30-60 Hz this pipeline usually samples, the budget is a fraction of a side.
- **A neighbour may itself be a bridged box.** The reference is the nearest surviving box, and the
  splice-tolerance bridge keeps a collapsed or displaced box in the segment, so an interior boxless
  frame next to a bridged frame is judged against that box. An intruder near a bad box can pass;
  the runner's own frame next to one can fail on that side and must pass against the other.
- **A boxless frame with no confident non-head, non-foot keypoint is kept.** Its confident head or
  foot points, if any, are not checked, because they are excluded from the hull just as they are
  from every other box.

## Offline replay

Probe lines replayed through selection → robustness → presence trim → heuristics, current defaults:

| line | clip / pass | `rejectedDiscontinuousBoxless` | cadence (spm) | VO ratio | R² |
|---|---|---|---|---|---|
| 0 | IMG_9345 primary | 0 | null | null | 0.249 |
| 1 | IMG_9345 scale | 0 | 76.8 | 0.4258 | 0.412 |
| 2 | IMG_9346 primary | **2** | **176.4** (was null) | **0.1678** (was null) | **0.825** (was 0.209) |
| 3 | IMG_9346 scale | 0 | 184.8 | 0.1297 | 0.903 |
| 4 | IMG_9347 primary | 0 | 175.2 | 0.1623 | 0.781 |
| 5 | IMG_9347 scale | 0 | 168 | 0.1708 | 0.838 |

Lines 0, 1, 3, 4 and 5 report a count of 0, so their output is identical to the code without the
rule. Live-browser verification on the demo clips is a separate task.
