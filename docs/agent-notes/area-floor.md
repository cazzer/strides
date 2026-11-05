# Person selection: the 4K area floor

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## The 4K area floor cannot be re-derived — measured and closed (2026-08-17, #57)

`minBoundingBoxAreaFraction: 2e-4` (`src/results/retroactivePersonSelection.ts`) resolves to
1,659 px² at 4K and does **not** catch Demo 1's 2,279–8,432 px² phantom detections on
keyframe-confirmed empty frames — the confirming symptom being `rejectedBelowFloor: 0` on both 4K
demo clips. Issue #57 (epic #52 item 4) set out to raise it so it would, and so Demo 1 would reach
`segmentCount === 1` / `rejectedOtherSegment === 0`, epic #52's amended headline gate.
**It failed on a pre-registered margin rule, and the reason kills the whole direction, not just
this attempt.** Do not re-litigate by picking a different number.

**The measurement.** A temporary `[bbox-trace]` probe (`boundingBoxTrace.experimental.ts` + one
dev-only log line + `scripts/bbox-trace-harvest.mjs`, all added-measured-reverted per the cycle
above) dumped every box-yielding detection **with no floor applied**, 3 trials × 3 clips, real
GPU. The extremes were then classified by pulling the keyframe at each timestamp.

```
A_4K = A_1080p×4 = 8,294,400 px²   (Demo 1 is 3840x2160; Demo 2 is 2160x3840 — PORTRAIT 4K,
                                    same frame area, transposed. A resolution "class" cannot
                                    key on width or height, only on frame area.)

G4 =  8,432 px²  Demo 1 t=8.36  keyframe: EMPTY TRACK          -> 1.0166e-3
S4 = 24,473 px²  Demo 1 t=4.32  keyframe: THE RUNNER (collapsed) -> 2.9506e-3   ratio 2.90
```

**Both endpoints come from the same clip and the same scene.** The squeeze is *intra-clip*, so it
is not a resolution problem and **no resolution model can widen it** — not a bigger fraction, not a
per-frame-area table, not a hybrid, not a power law. Phantom boxes and collapsed-subject boxes are
the same size and the same shape because they are the same kind of failure: a hull over too few,
badly-placed keypoints. The pre-registered rule wanted ≥4 (≥2× clear either side); 2.90 is the
generous reading and 1.32 the strict one.

**Two negative results, so nobody re-derives them:**
- **Confidence does not separate them.** Largest phantom: 9 confident keypoints, mean score 0.323.
  Genuine collapsed subject (the t=4.32 wedge): 4 and 0.258. A confidence gate rejects the *real*
  frame first.
- **Aspect ratio does not either.** Phantoms run 3.4:1 to 7.7:1 (h:w), well-detected subjects
  2.5:1 to 3.1:1 — cleanly separated until you notice the wedge is 7.1:1 and the multi-person
  clip's smallest genuine box is 4.6:1.

**The candidate was A/B'd anyway** (4 arms × 3 clips × 3 trials, `scripts/ab-person-selection.mjs`
unmodified, probe already reverted). `f = 1.7e-3` **does** reach the epic gate on Demo 1 —
`segmentCount` 3→1, `rejectedOtherSegment` 7→0, `rejectedBelowFloor` 4, winner still 53 frames from
t=0.08 at `medianAreaPx` 491,133, every metric value identical to baseline, Demo 2 bit-identical.
But the plateau collapses on both sides, which is the same 2.9× window measured behaviourally:

| | base `2e-4` | chosen `1.7e-3` | half `8.5e-4` | double `3.4e-3` |
|---|---|---|---|---|
| demo1 `segmentCount` | 3 [3..4] | **1** | 2 | 1 |
| demo1 `rejectedOtherSegment` | 7 [7..10] | **0** | 3 | 0 |
| demo1 `segments[0].frameCount` | 53 | 53 | 53 | **52** |
| demo1 `bridgedCuts` | 1 | 1 | 1 | **0** |
| demo2 | — | bit-identical | bit-identical | bit-identical |
| multiperson `segments[0].frameCount` | 123 | 119 | 121 | 112 |
| multiperson `medianAreaPx` | 31,670 | +0.84% | +0.7% | **+4.80%** |

`f/2` puts the 8,432 px² phantom back above the floor; `f×2` eats the 24,473 px² wedge and undoes
#54 (`frameCount` 52, `bridgedCuts` 0, `overstriding` 0.215→0.052). A factor-of-two cliff in both
directions, derived from three scenes, on footage nobody has measured.

**Where a next attempt should start**: the phantoms sit at **fixed screen positions with near-zero
motion** — Demo 1's cluster at x≈1710 across t=7.20/7.28/7.44, the multi-person clip's slivers
parked at c≈(492,604) for ~0.5s. Motion/persistence is the one discriminator the data supports and
a per-frame area threshold structurally cannot see. That is the **segmentation** stage's job, not
the floor's. Treat `2e-4` as a coarse degenerate-box filter and leave it alone.

**Also shipped from #57, independent of the number**: `retroactivePersonSelection.test.ts`'s
test-local `CONFIG` now pins `minBoundingBoxAreaFraction: 2e-4` explicitly instead of inheriting
the default. It had spread the default and overridden only `enabled`, which made a dozen fixtures'
above/below-floor status a live function of a number the suite is not measuring — `ABOVE_FLOOR_SIDE`
flips at 3.01e-4, the 60×60 bystanders at 1.736e-3, the 12-segment alternating fixture at 7.72e-4.
Verified load-bearing: with the default temporarily at 2.5e-3 the suite is green with the pin and
fails in nine places without it. `FLOOR_1080P` is now documented as the *test-local* floor.

Full tables, per-endpoint keyframe verdicts, the pre-registered criteria and the gate-by-gate
adjudication: `openspec/changes/derive-area-floor-from-4k-measurement/design.md`. The change
carries `skip_specs: true` — the sizing requirement drafted for it is **withdrawn**, because the
measurement shows it is unsatisfiable on this repo's own footage and weakening it to fit would be
editing a criterion to match a result.


## Boxless intruders inside the evidenced interior — closed (2026-11-05, strides-p1qt.2)

The "residual inversion" recorded in `restrict-boxless-survival` (a boxless detection between the
winner's first and last box was kept unchecked — "nulled at 5 confident keypoints, kept at 3") hit
a metric for real on private side clip **IMG_9346** (4K60, runner in frame ~1.2 s). At t=0.8833 s
MoveNet returned a far fence-line spectator (hips at y≈1103 vs the runner's ≈1580) with exactly 3
confident box-set keypoints (both hips 0.341, right knee 0.331); t=0.9 had 1. Robustness kept the
two hips, the hip-mid trace took a single −475 px spike, and the hip-bounce partial R² fell from
0.825 to **0.209 < `cadenceMinFitR2` 0.30** — cadence, VO and vertical ratio withheld ("step rhythm
was too irregular"). The MediaPipe scale pass, which never saw that frame, read 184.8 spm.

**Rule** (`check-interior-boxless-continuity`): a boxless interior frame's confident box-set
keypoints are hulled (`deriveBoundingBox(…, 1)`); it is kept only if the hull touches or is
position-continuous (`isPositionContinuous`: IoU or the existing `maxCenterSpeedSidesPerSecond`
bound) with the nearest surviving box before OR after it, else nulled and counted in
`rejectedDiscontinuousBoxless`. No new radius — this reuses the segmentation bound, which is what
D1's objection to a proximity radius was about. Runs after scoring, so segments, `bridgedCuts` and
`separationRatio` cannot move.

**Live gate** (8b1cf0db vs 01c4ef04, fresh process, `--evidence --scale-pass --outline-pass`, gate
lock held, one trial per clip):

| clip | nulled | cadence | VO | other |
|---|---|---|---|---|
| side-landscape / side-portrait / front-approach / multiperson | 0 | unchanged | unchanged | every field identical |
| IMG_9345 / 9347 / 9349 | 0 | unchanged | unchanged | every field identical |
| IMG_9346 | 2 (t=0.8833, 0.9) | null → **176.4** (GT ≈182 ±5) | null → 0.168 | footstrikes now from the fitted phase, so footStrikePattern/overstriding/stepWidth moved |
| IMG_9348 | 0 | unchanged | unchanged | only the outline-pass settle flake (strides-p1qt.4) differed |

`multiperson`'s ~4 interior boxless frames all passed the check (counter 0). Still admitted: an
intruder inside the speed budget of the runner box, a frame whose only confident points are head or
foot points (null hull), a bridged box acting as the neighbour, and sparse sampling widening the
budget with Δt. IMG_9346's residual −5.6 spm vs GT is the MoveNet hip trace over a 1.18 s window
(the scale pass reads 184.8 on the same window), not selection.

## Shrinkage is judged against the segment's recent peak (strides-p1qt.18, 2026-11-05)

Not a floor change: the 4K area floor above stays closed. This is a continuity rule. The
frame-to-frame scale test (`isBoundingBoxContinuous`) was a ratchet. On IMG_9345 the runner leaves
through the left edge at 244k → 97k px² in five bounded steps. The next frame is the background
runner who had been overlapping her, at 45k, within 4× of 97k, and segmentation followed him for 20
frames. The hip trace stepped ~200 px and cadence was withheld. Now
(`personSelection.shrinkReferenceWindowSeconds: 0.5`), a detection more than `maxAreaRatio` below
the segment's largest box in the last 0.5 s cuts. Growth is still frame to frame.

- **Edge-truncated boxes are exempt** (`isTruncatedByFrameEdge`, hull within 2% of the shorter
  frame side). Without it the rule cut runners' own last exit frames on four clips. A hull stops
  short of the edge: runners' last frames end 7–31 px from it, the 9345 intruder is 76 px in.
- **Result:** IMG_9345 cadence 188.4 (GT 190), VO 0.167. All other 9 clips are value-identical;
  extra cuts land only inside losing fence-walker segments.
- **The same rule exists on the online continuity gate but ships OFF**
  (`continuityGate.shrinkReferenceWindowSeconds: 0`). On it added nothing on 9345, and it moved
  multiperson's cadence/VO/VR from normal to caveated (two earlier partial edge-entry frames).
- Offline replica of segmentation for screening rules against saved probe traces:
  `strides-p1qt.18/sim.mjs` in the second-runner baseline under `fixtures-private/` (it matched the
  live driver on every clip).
