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
      same statistic `MetricResult.interpolatedFraction` reports, for samples DISCARDED rather than
      used — explicitly not its complement.

## 3. Fixture literals

- [x] 3.1 Update the eleven hand-built `ViewDetectionResult` literals across ten test files
      (`analysisDiagnostics`, `evidenceFrames`, `ResultsView`, `MetricsPanel` ×2,
      `MultiClipVideoSession`, `multiClipAnalysis`, `runClipAnalysisPipeline`, `fuseHeuristics`,
      `scalePassGraft`, `useVideoAnalysis`). No shared builder — out of scope.

## 4. Tests

- [x] 4.1 Bump `framesWithSignals`'s default count 20 → 22 (it must clear the floor; evenness is a
      convention, not a requirement — the floor test calls it with 21) and record why in the
      fixture's doc. Confirmed the alternative — lowering the floor — would undo the change: at 20,
      four existing tests fail.
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

## 6. Review round 1 — documentation only, no code changes requested

- [x] 6.1 Spec delta no longer writes a SHALL the code does not satisfy: the discounting clause
      claimed BSR tracks an interpolated fraction and discounts confidence for it, which it does
      neither of. Restated to say what BSR actually does and why that is in scope.
- [x] 6.2 The hull-bound argument now carries its qualification (exact only when both channels were
      reconstructed over the same run) plus the safety property that makes the conservative rule
      right anyway — exclusion can only narrow a range, so the worst case is abstention, never a
      confident wrong label. In `computeSagittalRange`'s docstring, `design.md` D1.1, `proposal.md`,
      and softened in the spec delta's normative sentence.
- [x] 6.3 Corrected the test comment that said an SER of 0.99 "abstains": 0.99 ≥ 0.8, so the
      corrupted signal casts an ACTIVE SIDE vote on a front-view clip. Ambiguous by disagreement,
      not by abstention — and the real defect is worse than the comment claimed.
- [x] 6.4 Dropped "the INVERSE of `MetricResult.interpolatedFraction`" everywhere (types.ts,
      viewDetection.ts, design.md D4, the analysis-diagnostics delta): both are
      `interpolated / resolvable`. What differs is the consequence, not the number.
- [x] 6.5 Nits: the fixture doc no longer claims evenness is load-bearing; `mathUtils.ts` no longer
      names a symbol private to another module; `detectView`'s orphaned docstring block (it sat
      above `viewPhrase`'s own, attaching to nothing) moved onto `detectView`.
- [x] 6.6 Folded the live A/B into `design.md` D9, including the result that refutes this change's
      own premise — the MoveNet path is NOT interpolation-free, and 15–20% of the ankle samples
      feeding view detection are synthesized on all three clips.

## 7. Out of this change

- [x] 7.1 The live three-clip, two-backend A/B the bead's acceptance criterion requires — run by
      the coordinator against a pre-change baseline; results in `design.md` D9. All four
      pre-registered ship conditions met.
