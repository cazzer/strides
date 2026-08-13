## 1. OpenSpec change

- [x] 1.1 `openspec new change promote-vo-cm-to-metric`; write `proposal.md`, `design.md` (D1–D8),
      `tasks.md`, three spec deltas (`form-heuristics` ADDED ×4 + MODIFIED ×2, `analysis-diagnostics`
      MODIFIED ×2, `results-view` ADDED ×1).
- [x] 1.2 `openspec validate promote-vo-cm-to-metric --strict` passes. Do NOT archive.

## 2. Types (first — tsc becomes the worklist)

- [x] 2.1 `src/heuristics/types.ts`: move `ScaleCalibratedFitFailureReason`/`ScaleCalibratedFit`/
      `ScaleCalibratedVerticalOscillation` in from `verticalOscillationCm.ts` (D7), add a new
      `observedCycles` (fractional, summed) field to `ScaleCalibratedVerticalOscillation` for D2's
      confidence calc. `MetricId` += `'verticalOscillationCm'` immediately after `'verticalRatio'`.
      `MetricResult.unit` += `'centimeters'` with doc (D4). New `VerticalOscillationCmResult`.
      `FormHeuristicsResult.verticalOscillationCm` added after `verticalRatio`. New
      `viewFitTable.verticalOscillationCm` row + doc (D2). `verticalOscillationMinFitR2` doc gains a
      third-consumer note (D3); `verticalOscillationSignal` doc gains a
      grid-AND-gate-never-signal clause.

## 3. Confidence

- [x] 3.1 `src/heuristics/confidence.ts`: new optional `scaleCoverage` param (default 1, linear
      multiply) + doc bullet in the factor enumeration.
- [x] 3.2 `src/heuristics/confidence.test.ts`: default-1 test, direct-multiply test, compounds-with-
      other-factors test.

## 4. `verticalOscillationCm.ts`

- [x] 4.1 Delete `CM_MIN_FIT_R2` module constant; gate reads `config.verticalOscillationMinFitR2`
      with the n-regime caveat kept as a gate-site comment (D3). Import updates for the D7 type
      move (import from `types.ts`, re-export for back-compat).
- [x] 4.2 New `computeVerticalOscillationCmMetric(frames, view, config)` policy layer,
      section-commented (D8): backend gate, reason-mapped caveats, D2's confidence recipe,
      degraded-but-non-null caveats.
- [x] 4.3 `src/heuristics/verticalOscillationCm.test.ts`: existing 12 tests unchanged and green.
      New config-gate proof (raised gate rejects an otherwise-clean fit; lowered gate admits a
      marginal one). New `describe('computeVerticalOscillationCmMetric', ...)`: backend gate (both
      all-null-scale and empty-list cases); one case per `ScaleCalibratedFitFailureReason` union
      member with calibration asserted non-null; single-compute passthrough; confidence exact
      product; scaleCoverage monotonicity; view-fit cases including the null-calibration case.

## 5. Orchestration

- [x] 5.1 `src/heuristics/index.ts`: one new line, `verticalOscillationCm:
      computeVerticalOscillationCmMetric(frames, view.view, config)`, appended after
      `verticalRatio`. Module doc updated to nine metrics and the append-not-insert rationale.
- [x] 5.2 `src/heuristics/index.test.ts`: fully-populated test gains `verticalOscillationCm`
      assertions (metric id, unscaled-null-with-caveat, viewFit). New scaled-vs-unscaled test. New
      D6 family-coherence headline test (constant `pixelsPerMeter`, exact frequency equality, close
      R², exact sample count, derived amplitude). Ambiguous-view test gains the `'tolerated'`
      assertion. Empty-frames test gains null/0/null-calibration assertions.

## 6. Diagnostics

- [x] 6.1 `src/results/analysisDiagnostics.ts`: `computeAnalysisDiagnostics` drops its optional 4th
      parameter; `scaleCalibration` derived via conditional spread from
      `heuristics.verticalOscillationCm.calibration` (D1b). Field doc updated (reference-identity
      invariant, not just "no second call").
- [x] 6.2 `src/results/analysisDiagnostics.test.ts`: fixture `makeHeuristics()` gains
      `verticalOscillationCm` (calibration null by default). Metrics-keys test now expects nine
      sorted ids. The two former 4th-arg tests replaced: (a) omits the key when
      `heuristics.verticalOscillationCm.calibration` is null, (b) surfaces the calibration by
      REFERENCE IDENTITY (`toBe`, not `toEqual`) when present.

## 7. `useVideoAnalysis.ts`

- [x] 7.1 Delete the `computeVerticalOscillationCm` import and its direct call; rewrite the "one
      trim, shared" comment (the second-call risk it guarded against no longer exists); call
      `computeAnalysisDiagnostics(sorted, robustFrames, heuristics)` with three arguments.
- [x] 7.2 `src/results/useVideoAnalysis.test.ts`: `FAKE_HEURISTICS` fixture gains
      `verticalOscillationCm` (calibration null, matching the fixture frames' unmeasured scale).
      `computeAnalysisDiagnostics` is not mocked in this file, so this exercises the real D1b
      derivation against the mocked `computeFormHeuristics` output.

## 8. Results UI

- [x] 8.1 `src/results/metricConfidence.ts`: `METRIC_LABELS` += `'Vertical oscillation (cm)'` after
      `'Vertical ratio'`.
- [x] 8.2 `src/results/MetricsPanel.tsx`: `formatValue`'s `'centimeters'` branch
      (`` `${value.toFixed(1)} cm` ``, no `× 100`, no torso-length suffix). All three family
      `METRIC_DESCRIPTIONS` entries rewritten to state each metric's denominator (or lack of one)
      per design.md D4's verbatim copy. New card for `heuristics.verticalOscillationCm` immediately
      after `verticalRatio`'s. Module doc updated to nine metrics.
      `src/results/LowConfidenceBanner.tsx`: no code change — `METRIC_IDS` already derives from
      `METRIC_LABELS`'s keys.
- [x] 8.3 `src/results/MetricsPanel.test.tsx`: nine labels asserted; `'4.8 cm'` for a `4.79`
      fixture value; both existing high/low-confidence fixtures get a clean
      `verticalOscillationCm` entry so flagged-count/note-count assertions keep their stated
      meaning ("2 of 9" comment updated); new dedicated unavailable-card test (renders "Not
      available" plus the availability caveat as a `role="note"`).
      `src/results/LowConfidenceBanner.test.tsx`: fixture gains a clean `verticalOscillationCm`
      entry (and is skipped, like `verticalOscillation`, in the D9 exhaustiveness loop, since it
      too has a richer required shape); new test asserting the banner names
      `'Vertical oscillation (cm)'` when the metric is unavailable (documents the #37 hand-off,
      no special-casing added).
      `src/results/ResultsView.test.tsx` and `src/results/useVideoAnalysis.test.ts`: fixtures gain
      the new key.

## 9. Verification

- [x] 9.1 `npx tsc -b`, `npx vitest run`, `npx eslint .` all green.
- [x] 9.2 `openspec validate promote-vo-cm-to-metric --strict` passes.
- [x] 9.3 Live verification (Playwright, real GPU) on both demo clips, both `movenet` and
      `mediapipePoseLandmarker` backends, ≥2 trials each: MediaPipe identity check
      (`metrics.verticalOscillationCm.value === scaleCalibration.verticalOscillationCm`), track
      anchor (4.78–4.79 cm, bit-identical to the pre-change baseline), nine-metric count, MoveNet
      null-gating with the exact D2 caveat and an absent `scaleCalibration` key.

## 10. Docs

- [x] 10.1 Repo `CLAUDE.md`: update the "MediaPipe metric calibration" section's now-false
      statements (diagnostics-only → real metric; module-constant gate → config-driven; metric
      count 7/8 → 9), per this project's established per-ticket update pattern.
