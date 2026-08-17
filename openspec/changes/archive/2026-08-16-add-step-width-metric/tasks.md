## 1. Types and config

- [x] 1.1 Add `'stepWidth'` to `MetricId` (appended last); extend `FormHeuristicsResult` with a
      `stepWidth: MetricResult` field; add a `stepWidth` entry to `DEFAULT_VIEW_FIT_TABLE`
      mirroring `armSwingSymmetry`'s row exactly (`front: primary/1.0`, `side: unsuitable/0.1`,
      `ambiguous: unsuitable/0.2`) — `src/heuristics/types.ts`

## 2. Hip-width scale reference

- [x] 2.1 Add `estimateHipWidth(frames)` to `src/heuristics/bodyScale.ts`: median left-right hip
      separation across frames (via `resolveBilateralPair`), mirroring `estimateBodyScale`'s
      median-across-frames pattern but a distinct denominator (hip width, not torso length); does
      NOT touch `viewDetection.ts`'s own inline bilateral-spread calc (different reduction order,
      refactoring to share would change its math)
- [x] 2.2 `src/heuristics/bodyScale.test.ts`: parallel `estimateHipWidth` coverage (median not
      mean, sampleCoverage on partial resolution, null on zero-resolvable/empty input) mirroring
      the existing `estimateBodyScale` suite

## 3. Metric implementation

- [x] 3.1 Implement `computeStepWidth(frames, view, config)`: `detectFootstrikes` → per-candidate
      `resolvePoint`(ankle)/`resolveMidpoint`(hip-mid)/`resolvePoint`(own-side hip) at that frame →
      sign-corrected offset ÷ hip width (see `design.md` for the sign-convention derivation); view
      gating via `config.viewFitTable.stepWidth`; a crossover-gait caveat when the median value is
      negative; never `null`/`NaN`/throw — `src/heuristics/stepWidth.ts`
- [x] 3.2 `src/heuristics/stepWidth.test.ts`: a clean front-view clip (positive value, own-side,
      primary view-fit); a side-view clip (still computed, `viewFit: 'unsuitable'`, confidence
      discounted); an ambiguous-view clip (same, `0.2` multiplier); a crossover-gait case (bespoke
      fixture, not `generateSyntheticGait` — see `design.md` for why that shared fixture cannot
      produce a negative combined value regardless of amplitude — asserting `value < 0` and the
      crossover caveat); no footstrikes → null; no hip-width reference → null with its specific
      caveat; empty frame list does not throw

## 4. Orchestration

- [x] 4.1 Wire `computeStepWidth` into `computeFormHeuristics`, appended after
      `footStrikePattern` per this file's established append-only convention —
      `src/heuristics/index.ts`
- [x] 4.2 Extend `src/heuristics/index.test.ts`'s existing "fully-populated result", "ambiguous
      view gating", and "empty frame list" assertions to also cover `result.stepWidth`

## 5. UI rendering

- [x] 5.1 Add `stepWidth` to `METRIC_LABELS` (`src/results/metricConfidence.ts`) and to
      `METRIC_DESCRIPTIONS` (`src/results/MetricsPanel.tsx`, prose stating both the hip-width
      denominator and the sign convention, since `'percent'` formatting states neither); render a
      tenth `MetricCard` for `heuristics.stepWidth` — `src/results/MetricsPanel.tsx`
- [x] 5.2 Update `src/results/MetricsPanel.test.tsx` fixtures (`FormHeuristicsResult` now requires
      `stepWidth`) and count assertions (label rendering, card/tier counts, summary-line counts,
      declaration-order list) for the tenth card

## 6. Fixture updates in other suites

- [x] 6.1 `src/results/ResultsView.test.tsx`, `src/results/useVideoAnalysis.test.ts`,
      `src/results/analysisDiagnostics.test.ts`, `src/results/scalePassGraft.test.ts`: add
      `stepWidth` to each hand-built `FormHeuristicsResult` fixture literal (this metric is not
      scale-gated, so no special-casing needed beyond the literal addition); update the two
      generic-aggregation files' doc comments (`analysisDiagnostics.ts`, `scalePassGraft.ts`) from
      "nine"/"eight" to "ten"/"nine" — their actual aggregation logic is already generic over
      `FormHeuristicsResult`'s keys and needed no code change

## 7. OpenSpec and verification

- [x] 7.1 `openspec validate add-step-width-metric --strict` passes
- [x] 7.2 `npx vitest run` passes (one pre-existing, unrelated failure in
      `VideoInputPanel.test.tsx` — confirmed present on `main` before this change, a stale
      demo-button-label regex — is not touched by this change and not counted against it)
- [x] 7.3 `npx tsc -b` passes
- [x] 7.4 Live-browser check: dev server, the front-approach demo clip ("Demo 2 (front view)"),
      real GPU (confirmed `ANGLE Metal Renderer: Apple M4 Pro`, not SwiftShader). `view.view`
      detected as `'front'`, `stepWidth` reported `value: 0.0648` (6.5%), `viewFit: 'primary'`,
      `confidence: 1`, `caveat: null` — a positive, own-side, plausible value, per the
      "front-approach demo clip" the ticket's own post-steps flagged as the one to check (the
      side-view track demo compresses this metric's signal toward zero, as documented in
      CLAUDE.md, so front view was used instead). The rendered card shows "Step width" / "6.5%" /
      the full hip-width + sign-convention description / "High confidence".
