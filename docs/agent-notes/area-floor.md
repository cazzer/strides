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

