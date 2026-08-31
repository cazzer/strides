# Exclude interpolated samples from view detection's sagittal range

## Why

`resolvePoint` (`src/heuristics/keypoints.ts`) returns `{ x, y, interpolated }` — the robustness
layer's own statement about whether a coordinate was measured or reconstructed.
`computeSagittalRange` (`src/heuristics/viewDetection.ts`) reads `.x` and throws `.interpolated`
away. `stepWidth.ts` honours the identical flag on the identical primitive. View detection is the
only consumer in the repo that receives that trust signal and ignores it — and it is the one
consumer whose output gates every other metric, through the view-fit table.

Measured on Demo 2 with MediaPipe forced primary, both arms detecting 87 of 99 frames so they
differ only in what happens to the 12 the detector missed:

| arm | SER |
|---|---|
| default (`maxGapSeconds` 0.5) | **1.59113** |
| `{robustness:{maxGapSeconds:0.05}}` | **0.650297** |

A **2.45x** inflation of the signal that decides the view label. The mechanism is specific and it
is not a tuning problem. `interpolateChannel` lerps across any gap within `maxGapSeconds`; at the
clip's opening MediaPipe misses 10 of 12 consecutive frames (0.33 s, inside budget) and **both**
flanking anchors are bad detections, so every filled frame lands in the same extreme zone. The
outlier population grows from ~4 raw frames (4.6%) to ~14 (16%), against a p95-p5 trim that removes
only ~4 values at n = 87. `computeSagittalRange`'s own docstring claims robustness to "a single
wildly-off ankle sample" — true for one, false for fourteen, and the false half of that claim sat
at the defect site and is half the reason it survived review.

**This is not MediaPipe-specific.** MoveNet runs the identical code and simply has no gaps to fill
on this repo's three clips (99/99 on Demo 2). A clip where MoveNet drops frames — occlusion, a
subject leaving frame, a lower-quality recording — hits it too, silently, and corrupts the view
label that gates every metric.

## What Changes

- **The sagittal excursion range's population is DIRECTLY-DETECTED samples only.** A frame where
  either the ankle or its own hip was temporally interpolated is discarded outright rather than
  discounted.
- **The rule that distinguishes this from the rest of the pipeline is stated, not left implicit.**
  A signal reduced by a **median or a mean** keeps interpolated samples and discounts the
  confidence for them; a signal reduced by an **extreme quantile** excludes them. The reason is
  asymmetric and settles it: a lerped sample sits on the straight line between its own flanking
  detections, so where those anchors bound it, it cannot carry a real extreme — all it can add is
  probability mass NEAR one, which is exactly what walks a p95 into an outlier cluster. Excluding
  therefore cannot discard a real extreme that the anchors do not already carry, whereas including
  can invent one.
- **That bound is exact only when both channels were reconstructed together, and the rule is
  deliberately conservative about it.** `interpolateChannel` fills each keypoint independently and
  the measured quantity is `ankle.x − hip.x`, so a lerped hip against a *detected* ankle can be a
  genuine extreme outside both anchors — and it is discarded anyway. The residual error is
  one-directional: exclusion can only NARROW a range, so a mis-excluded sample biases SER downward,
  toward abstention or a front vote. On a genuine side view the worst case is degrade-to-ambiguous,
  never a confident wrong label. See `design.md` D1.1.
- **The range refuses to be computed below 21 detected samples.** `percentile` interpolates at
  index `p·(n−1)`, so the largest sample influences the p95 exactly while `0.95(n−1) > n−2`, i.e.
  while `n < 21`, and symmetrically for the smallest and the p5. Below 21 the estimator is partly a
  min-max and one stray detection sets it outright; at n = 21 it is exactly second-largest minus
  second-smallest. `MIN_SAGITTAL_RANGE_SAMPLES = 21` is therefore a derivation, not a tunable, and
  ships as a module constant for the same reason `SIDE_VIEW_FULL_BILATERAL_SPREAD_RATIO` does.
- **A side that falls below the floor contributes no range, and the signal is unavailable if no
  side clears it.** That reaches the existing "a signal is unavailable" branch — the ordinary
  ambiguous path at `0.3 × coverage` confidence, NOT the insufficient-coverage early return that
  forces confidence to 0.
- **Two diagnostics join `ViewDetectionResult.diagnostics`**, both required and per side:
  `sagittalExcursionSampleCount` (detected-only samples the range was, or would have been, computed
  from — reported even where the floor rejected the side, so "18, just short of 21" is legible
  rather than a bare null) and `sagittalExcursionInterpolatedFraction` (the share of resolvable
  samples DISCARDED — numerically the same statistic as `MetricResult.interpolatedFraction`,
  reported for samples excluded rather than used; not its complement).
- **The Bilateral Spread Ratio is untouched.** It reduces by a median, so it falls on the
  discounting side of the rule above. It keeps its interpolated samples, which is what that side of
  the rule asks; it surfaces no interpolated fraction of its own and discounts no confidence for
  them, because `resolveBilateralPair` does not carry the flag through — and nothing obliges a
  signal inside the classifier to do what a metric does.

## Impact

- Affected specs: `form-heuristics`, `analysis-diagnostics`
- Affected code: `src/heuristics/viewDetection.ts` (the whole change),
  `src/heuristics/types.ts` (two diagnostics fields), `src/heuristics/mathUtils.ts` (one docstring
  clause), `src/heuristics/viewDetection.test.ts`, plus eleven mechanical fixture literals across
  ten test files that construct a `ViewDetectionResult` by hand.
- **No vote logic, confidence branch, plausibility computation or coverage early-return changed.**
  The only new way to reach `sagittalExcursionRatio: null` is the floor, and it lands on the branch
  that already handles an unavailable signal.
- **A clip with nothing interpolated is a no-op**, asserted as a unit test rather than assumed. The
  expectation that the MoveNet path IS such a clip was **wrong**, and the live A/B caught it: Demo 2
  moved 0.328358 → 0.334267 there. `sampling.detectedFrames` counts FRAMES, and a keypoint inside a
  detected frame can still be interpolated — measured at **15–20% of the ankle samples feeding view
  detection, on all three clips, on the default path**. No metric value, confidence or tier moved
  anywhere. Full numbers: `design.md` D9.
- **Not sufficient on its own for Demo 2's front label, and not aimed at it.** At SER 0.650
  MediaPipe still casts no SER vote (front needs ≤ 0.4, side ≥ 0.8), so that clip stays
  `'ambiguous'` by abstention. This is a correctness fix to a corrupted signal, not a label fix.
