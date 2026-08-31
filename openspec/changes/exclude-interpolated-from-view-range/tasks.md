# Tasks — exclude interpolated samples from view detection's sagittal range

## 1. The estimator

- [x] 1.1 `computeSagittalRange` skips a frame when `ankle.interpolated || hip.interpolated` — the
      same disjunction `stepWidth.ts` uses on the same primitive — and counts what it skipped.
- [x] 1.2 Add `MIN_SAGITTAL_RANGE_SAMPLES = 21` as a module constant, documented as a derivation
      (`percentile` interpolates at `p·(n−1)`; the largest sample influences the p95 iff
      `0.95(n−1) > n−2`, i.e. `n < 21`; at n = 21 the estimator is exactly second-largest minus
      second-smallest), not as a tunable.
- [x] 1.3 Return `{ range, detectedSamples, interpolatedSamples }` instead of `number | null`, with
      `range` null iff `detectedSamples < MIN_SAGITTAL_RANGE_SAMPLES`. Module-private, so no ripple
      outside the file.
- [x] 1.4 Rewrite the docstring: name the detected-only population and why exclusion is safe here,
      and replace the unconditional robustness claim with the n-dependent one the floor makes
      honest.
- [x] 1.5 `detectView` calls the new shape, filters `range !== null` exactly as before, and
      populates the two new diagnostics. No change to vote logic, confidence branches, the coverage
      early return, or the BSR block.

## 2. Types

- [x] 2.1 Add required `sagittalExcursionSampleCount: { left, right }` to
      `ViewDetectionResult.diagnostics`, documented as reported even where the floor rejected that
      side.
- [x] 2.2 Add required `sagittalExcursionInterpolatedFraction: { left, right }`, documented as the
      INVERSE of `MetricResult.interpolatedFraction`'s meaning.

## 3. Fixture literals

- [x] 3.1 Update the eleven hand-built `ViewDetectionResult` literals across ten test files
      (`analysisDiagnostics`, `evidenceFrames`, `ResultsView`, `MetricsPanel` ×2,
      `MultiClipVideoSession`, `multiClipAnalysis`, `runClipAnalysisPipeline`, `fuseHeuristics`,
      `scalePassGraft`, `useVideoAnalysis`). No shared builder — out of scope.

## 4. Tests

- [x] 4.1 Bump `framesWithSignals`'s default count 20 → 22 (must clear the floor; must stay even so
      the two-valued series still splits exactly) and record why in the fixture's doc. Confirmed the
      alternative — lowering the floor — would undo the change: at 20, four existing tests fail.
- [x] 4.2 New test: the defect reproduced and fixed — 34 detections at SER 0.33 plus a 6-frame
      interpolated block at 5× the excursion; the ratio is exactly the detected-only value, not
      dragged to 0.99.
- [x] 4.3 New test: a clip with nothing interpolated is bit-identical to the equivalent all-detected
      clip — the MoveNet no-op proof.
- [x] 4.4 New test: the floor — 20 detected ⇒ null ratio, `'ambiguous'`, all-ambiguous plausibility,
      confidence `0.3 × coverage` (NOT 0, the distinction from the coverage early return); 21 ⇒ a
      real range. The `n < 21` derivation is stated in the test comment.
- [x] 4.5 New test: diagnostics honesty — counts equal the detected count per side, fraction equals
      `discarded / (detected + discarded)`, and a below-floor side still reports its counts.
- [x] 4.6 Existing-behaviour guard: a one-sided dropout still yields a one-legged SER, with
      interpolation present on the other side.
- [x] 4.7 Verified each guard actually fails without the code it guards (removing the skip fails 3;
      lowering the floor to 5 fails 2).

## 5. Docs and gates

- [x] 5.1 `mathUtils.ts`'s `percentile` docstring no longer repeats the unconditional-robustness
      claim about this caller.
- [x] 5.2 `npx tsc -b` clean.
- [x] 5.3 `npm run lint` clean.
- [x] 5.4 `npm test -- --run` green (1372 → 1377).

## 6. Out of this change

- [ ] 6.1 The live three-clip, two-backend A/B that the bead's acceptance criterion requires — run
      separately, against a baseline captured before this change.
