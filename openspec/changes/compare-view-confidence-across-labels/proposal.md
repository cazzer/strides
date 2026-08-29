# Compare view confidence across labels

## Why

`ViewDetectionResult.confidence` is a MARGIN: how far each of the two view-detection signals sits
past the threshold its committed label required, averaged and scaled by body-scale coverage. Four
such margins exist — one per (view, signal) pair — and three of them ramp toward a value the signal
can actually reach. The fourth does not.

`marginAwayFromZero(value, threshold) = clamp01((value - threshold) / threshold)` reaches 1 only at
`2 * threshold`. For the front view's Bilateral Spread Ratio that point is **BSR 1.10**, and BSR is
anatomically bounded: its numerator is the pose model's own shoulder and hip-JOINT-CENTRE
separations, its denominator twice the torso length, so a dead-on front view of an adult runner
produces roughly **0.47 (narrow build) to 0.67 (broad), centred near 0.56** — using this repo's own
measured torso figures (`torsoMeters` 0.5041 on Demo 1, ~0.47 on Demo 2, from the MediaPipe
world-landmark scale calibration). The saturation point sits at about **twice the anatomical
maximum**.

Two consequences, both measured live on this repo's three clips (headless Chromium, real GPU
`ANGLE Metal Renderer: Apple M4 Pro`, 3 trials each, body-scale coverage exactly 1 on all nine
runs):

1. **No front-facing clip can be confidently classified, at any camera position.** With
   `frontViewMinBilateralSpreadRatio` at 0.55, the front BSR margin tops out at
   `(0.5612 - 0.55) / 0.55 = 0.020` for a typical build and `(0.6702 - 0.55) / 0.55 = 0.218` for a
   broad one. A PERFECT front view — SER at its exact foreshortening limit, coverage 1 — therefore
   caps at `(0.020..0.218 + 1) / 2 = 0.510 .. 0.609`, structurally below the 0.7 the results view
   calls "High confidence". Demo 2 (`park-approach.mp4`), a visually dead-on front approach,
   measures BSR **0.5507** — right at the central estimate, clearing the bar by 0.13% — and reports
   **`confidence: 0.0771`**. The two side clips read **0.7615** (Demo 1) and **0.7531**
   (multiperson) on the same scale.
2. **The bar is unreachable for some builds.** 0.55 sits between the narrow-build (0.4712) and
   central (0.5612) dead-on values, so a narrow-shouldered runner filmed perfectly square-on cannot
   clear it AT ANY CAMERA ANGLE and is labelled `'ambiguous'` for their build. `strides-2iw`
   observes this and leaves it undecided; the measurement above forces it, because a threshold at
   or above its own signal's ceiling is exactly what makes the margin unreadable.

`propagate-view-confidence-to-metric-gating` moved metric gating onto `ViewDetectionResult`'s
`plausibility`, which has no saturation point, so **no metric's confidence or exclusion depends on
this scalar today** (verified: `view.confidence` is read in exactly two places in `src/` —
`fuseHeuristics.ts`'s cross-clip view pick and the dev-only `[analysis-diagnostics]` line). What is
left is a diagnostic number that reads as if it means the same thing for both labels while it
cannot, plus one live behaviour: `fuseFormHeuristicsResults` picks a multi-clip session's reported
view by highest `view.confidence`, so a mixed-view session systematically reports the SIDE clip's
view whichever classification is better supported.

## What Changes

- Every view-detection margin ramps from its view's decision threshold to the value that signal
  takes with the camera **dead-on for that view**, replacing the pair of one-sided helpers whose
  saturation was implicitly `0` in one direction and `2 * threshold` in the other. Two of the four
  full-support points are exact projection limits (both `0`); two are anatomical measurements, now
  named in config rather than inferred from a threshold.
- `frontViewMinBilateralSpreadRatio` moves **0.55 → 0.45**, below what the narrowest plausible
  build produces dead-on, so no build is structurally unclassifiable as front.
- Two new `HeuristicsConfig` keys carry the two non-zero full-support points:
  `frontViewFullBilateralSpreadRatio: 0.56` (new behaviour) and
  `sideViewFullSagittalExcursionRatio: 1.6` (the value the old `2 * threshold` rule already
  produced for this signal — named, not changed).
- **BREAKING** for anything comparing `view.confidence` against a remembered number: a front label
  now reads on the same 0..1 scale a side label does. Nothing in `src/` compares it against a
  constant; `fuseFormHeuristicsResults` compares it across clips, which is the behaviour being
  repaired.
- Side-view confidence is untouched to the last digit — verified live, both side clips identical
  before and after.

## Impact

- Affected specs: `form-heuristics`
- Affected code: `src/heuristics/viewDetection.ts`, `src/heuristics/types.ts`,
  `src/heuristics/viewPlausibility.ts` (a doc cross-reference to the deleted helper), and the
  view-detection/plausibility/orchestration tests whose fixtures encode the 0.55 bar.
- Not affected: metric gating on this repo's three test clips. `computeViewPlausibility`'s ramp
  endpoints move with the threshold, but every one of the three clips reads BSR either at/below
  `sideViewMaxBilateralSpreadRatio` (Demo 1, multiperson) or at/above both the old and the new
  front bar (Demo 2), so all three stay one-hot and every metric's `viewFit`, confidence and card
  is bit-identical. Confirmed live.
