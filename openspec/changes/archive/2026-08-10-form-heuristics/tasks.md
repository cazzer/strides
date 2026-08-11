## 1. Type contract and shared primitives

- [x] 1.1 Define `View`, `ViewFit`, `MetricId`, `ViewDetectionResult`, `MetricResult`,
      `FormHeuristicsResult`, `HeuristicsConfig` (incl. `viewFitTable`) and their defaults in
      `src/heuristics/types.ts`
- [x] 1.2 Implement `resolvePoint`, `resolveMidpoint` (tolerant single-side fallback),
      `resolveBilateralPair` (strict both-sides) in `src/heuristics/keypoints.ts`
- [x] 1.3 `src/heuristics/keypoints.test.ts`: detected/interpolated/unrecoverable resolution,
      tolerant single-side fallback (flagged interpolated regardless of the point's own status),
      strict bilateral pair returning null on a single missing side
- [x] 1.4 Implement `estimateBodyScale` (median torso length + sample coverage) in
      `src/heuristics/bodyScale.ts`
- [x] 1.5 `src/heuristics/bodyScale.test.ts`: median-not-mean robustness to an outlier frame,
      sampleCoverage accounting, null on zero resolvable frames
- [x] 1.6 Implement `estimateTravelDirection` (sign of net hip-x displacement, indeterminate below
      half a torso length) in `src/heuristics/travelDirection.ts`
- [x] 1.7 `src/heuristics/travelDirection.test.ts`: positive/negative/indeterminate cases, edges of
      the half-torso-length threshold, first/last-resolvable-frame selection

## 2. Gap-aware extrema finding

- [x] 2.1 Implement `findLocalExtrema`: 3-sample centered moving average within each contiguous
      non-null run only, then a single-pass prominence-thresholded zig-zag scan per run, reporting
      raw (not smoothed) values at each confirmed extremum's index, in `src/heuristics/extrema.ts`
- [x] 2.2 `src/heuristics/extrema.test.ts`: hand-traced monotonic-ramp and down-up-down (through
      the smoothing pass) cases with exact expected extrema; gap handling (two runs never smoothed
      or paired across a null); pure-jitter-below-threshold yields no extrema; single-sample run
      yields no extrema

## 3. Confidence formula

- [x] 3.1 Implement `computeMetricConfidence` (product of view-fit, coverage, interpolation
      penalty, sample-size-capped-at-1, and optional travel-direction-known factors) in
      `src/heuristics/confidence.ts`
- [x] 3.2 `src/heuristics/confidence.test.ts`: each factor's isolated effect, sample-size cap at 1
      (no divide-by-zero when the minimum is 0), travel-direction default/override, compounding of
      multiple moderate penalties, output clamped to `[0, 1]`

## 4. View detection

- [x] 4.1 Implement `detectView`: BSR + SER signals, both-must-agree classification, insufficient-
      coverage short-circuit to ambiguous/confidence-0, margin-based confidence for committed
      labels and flat coverage-scaled confidence for disagreement-ambiguous, in
      `src/heuristics/viewDetection.ts`
- [x] 4.2 `src/heuristics/viewDetection.test.ts`: clean side-view and front-view fixtures
      classified correctly with high confidence; insufficient frame coverage -> ambiguous,
      confidence 0; engineered BSR/SER disagreement -> ambiguous with flat confidence; empty input

## 5. Vertical oscillation (view-tolerant)

- [x] 5.1 Implement `computeVerticalOscillation`: hip-mid-y extrema, half-cycle amplitude pairing
      (skipping same-kind consecutive extrema across a gap), median-of-amplitudes torso-normalized
      value, view-tolerant confidence via `viewFitTable.verticalOscillation`, in
      `src/heuristics/verticalOscillation.ts`
- [x] 5.2 `src/heuristics/verticalOscillation.test.ts`: side-view fixture with known
      `verticalBouncePx` -> value close to the hand-computed torso-normalized ratio, confidence 1;
      front-view fixture -> same value, confidence discounted by the `0.85` multiplier;
      heavily-interpolated/unrecoverable stream (via real `applyRobustness` over gappy
      `PoseSample[]`) -> visibly reduced confidence, non-null value, no crash; fully-unresolvable
      hip position -> null value, confidence 0

## 6. Trunk lean (side-view-primary, hard-gated)

- [x] 6.1 Implement `computeTrunkLean`: rigid torso-vector angle via `atan2(dx, -dy)`,
      travel-direction sign conversion with indeterminate-direction fallback and extra confidence
      penalty, hard view gating via `viewFitTable.trunkLean`, in `src/heuristics/trunkLean.ts`
- [x] 6.2 `src/heuristics/trunkLean.test.ts`: side-view fixture with known `trunkLeanDeg` -> value
      matches exactly, confidence 1, `viewFit: 'primary'`; front-view fixture -> value still
      present, `viewFit: 'unsuitable'`, confidence capped at the `0.1` multiplier; indeterminate
      travel direction (hand-built zero-net-displacement fixture) -> caveat present, confidence
      penalized by the travel-direction factor; no resolvable torso -> null value, confidence 0

## 7. Overstriding (side-view-primary, hard-gated)

- [x] 7.1 Implement `computeOverstriding`: per-side footstrike detection via ankle-y maxima
      (`findLocalExtrema` + minimum-interval filtering), hip-relative horizontal offset at each
      strike converted to torso-normalized ratio via travel direction, event-sampled
      `frameCoverage` (usable/candidate strikes, documented as a different meaning than the
      per-frame ratio elsewhere), hard view gating via `viewFitTable.overstriding`, in
      `src/heuristics/overstriding.ts`
- [x] 7.2 `src/heuristics/overstriding.test.ts`: side-view fixture with known `strideAmplitudePx`
      -> value close to the hand-computed torso-normalized ratio, sane sign, sample size >= 4;
      front-view fixture -> `viewFit: 'unsuitable'`, confidence capped at the `0.1` multiplier;
      no-footstrikes-detected fixture -> null value, confidence 0, sample size 0, no crash

## 8. Orchestration and fixtures

- [x] 8.1 Implement `computeFormHeuristics`: runs `detectView` once, feeds the result into all
      three metrics, in `src/heuristics/index.ts`
- [x] 8.2 `src/heuristics/index.test.ts`: clean side-view clip -> fully-populated result, all three
      metrics' `viewFit` consistent with the same detected view; matches calling `detectView` +
      each metric independently; ambiguous-view clip gates all three consistently; empty input
      never throws and returns a well-formed all-null result
- [x] 8.3 `src/heuristics/__fixtures__/syntheticGait.ts`: parametric sinusoidal-gait generator with
      view-consistent geometry (rigid rotated torso for lean, monotone-in-sway-phase ankle-y so
      footstrikes land at a hand-computable offset, view-appropriate bilateral/sagittal
      scaling), all keypoints `'detected'`
- [x] 8.4 `src/heuristics/__fixtures__/testFrames.ts`: minimal hand-built `RobustPoseFrame`
      constructor for the lower-level unit tests (keypoints/bodyScale/travelDirection/
      viewDetection edge cases) that don't need full synthetic-gait realism

## 9. OpenSpec + verification

- [x] 9.1 `npm run lint` passes
- [x] 9.2 `npm run build` passes (`tsc -b` + `vite build`)
- [x] 9.3 `npm run test` passes
- [x] 9.4 `openspec validate --all` passes clean
- [x] 9.5 `openspec archive form-heuristics` once all of the above are complete
