## 1. OpenSpec change

- [x] 1.1 `openspec/changes/add-step-width-cm-metric/`: `proposal.md`, `design.md` (D1-D6),
      `tasks.md`, two spec deltas (`form-heuristics` ADDED ×3, `results-view` MODIFIED ×2 +
      ADDED ×1).
- [x] 1.2 `openspec validate add-step-width-cm-metric --strict` passes. Do NOT archive.

## 2. Types

- [x] 2.1 `src/heuristics/types.ts`: `MetricId` += `'stepWidthCm'`, appended last (after
      `'footStrikePattern'`). `MetricResult.unit`'s `'centimeters'` doc comment updates to name
      both producers. `FormHeuristicsResult.stepWidthCm: MetricResult` added last. New
      `viewFitTable.stepWidthCm` row mirroring `armSwingSymmetry`'s exactly (front primary 1.0,
      side unsuitable 0.1, ambiguous unsuitable 0.2) + doc explaining the mediolateral/side-to-side
      reasoning (D3).

## 3. `stepWidthCm.ts`

- [x] 3.1 New `src/heuristics/stepWidthCm.ts`: `computeStepWidthCm(frames, view, config)` —
      overstriding's skeleton (D1), backend-gated first (D2) via
      `frames.some(f => isUsableScale(f.pixelsPerMeter))`, then `detectFootstrikes`, then per
      candidate reads `ankle.x - hipMid.x` and divides by that frame's `pixelsPerMeter` (no
      travel-direction correction — D1), median across usable candidates. No `calibration`/`fit`
      type — plain `MetricResult`. Confidence via `computeMetricConfidence` with no `scaleCoverage`
      factor (D4).
- [x] 3.2 `src/heuristics/stepWidthCm.test.ts`: clean front-view clip with a pinned ankle-hip
      offset (exact expected cm value via the `withAnkleHipOffset` fixture-rewrite technique,
      mirroring `footStrikePattern.test.ts`'s `withKneeAnkleOffset`); signed-offset case; side-view
      unsuitable case; backend-gate availability caveat (verbatim text) on an unscaled clip and on
      an empty frame list; mixed scaled/unscaled footstrikes excludes the unscaled ones without
      moving the value; no-footstrikes case; below-minimum-sample-size caveat; no-resolvable-input
      degenerate case.

## 4. Orchestration

- [x] 4.1 `src/heuristics/index.ts`: one new line, `stepWidthCm: computeStepWidthCm(frames,
      view.view, config)`, appended last. Module doc updated to ten metrics.
- [x] 4.2 `src/heuristics/index.test.ts`: fully-populated test gains `stepWidthCm` assertions
      (metric id, unsuitable-view-on-a-side-clip, unscaled-null-with-caveat). New dedicated
      scaled-vs-unscaled/view-independent gating test. Ambiguous-view test gains the
      `'unsuitable'` assertion. Empty-frames test gains null/0/non-null-caveat assertions.

## 5. Scale-pass graft

- [x] 5.1 `src/results/scalePassGraft.ts`: `graftScalePassResult` extended to graft `stepWidthCm`
      alongside `verticalOscillationCm` (D5) — a small shared `withProvenance<T extends
      MetricResult>` helper removes the duplication between the two identical append-caveat
      blocks. Module doc updated to explain the extension decision and the independent-outcome
      guarantee.
- [x] 5.2 `src/results/scalePassGraft.test.ts`: fixtures (`makeStepWidthCm`, `makeResult`) extended
      with a `stepWidthCm` parameter. Existing "grafts only verticalOscillationCm" test renamed and
      extended to assert both metrics graft with reference-identity/no-mutation guarantees intact.
      New test: the pass measures scale broadly (`verticalOscillationCm` grafts a real value) but
      `stepWidthCm` independently finds no footstrikes (grafts its own null value + caveat),
      without affecting `verticalOscillationCm`'s graft.

## 6. `useVideoAnalysis.ts`

- [x] 6.1 Comment-only touch-up on the pass-decision gate (why checking
      `verticalOscillationCm.calibration` alone still covers `stepWidthCm`) and the graft-failure
      gate (why `stepWidthCm` grafts unconditionally once that same check passes, including its
      own independently-null case) — no functional change; both were already generic.
- [x] 6.2 `src/results/useVideoAnalysis.test.ts`: `FAKE_HEURISTICS` gains a null-valued
      `stepWidthCm` (matching the fixture's unmeasured-scale frames); `FAKE_SCALE_HEURISTICS`
      gains a measured `stepWidthCm`. The "grafts only verticalOscillationCm" test renamed and
      extended to assert `stepWidthCm` also grafts.

## 7. Results UI

- [x] 7.1 `src/results/metricConfidence.ts`: `METRIC_LABELS` += `'Step width (cm)'`.
- [x] 7.2 `src/results/MetricsPanel.tsx`: `METRIC_DESCRIPTIONS.stepWidthCm` added
      (`formatValue`'s existing `'centimeters'` branch needs no new code); new card appended to the
      panel's `metrics` array; the scale-pass-in-progress/failed excluded-entry hint widens from
      `metric.metric === 'verticalOscillationCm'` to match either scale-pass-backed metric. Module
      doc updated to ten metrics.
- [x] 7.3 `src/results/MetricsPanel.test.tsx`: ten labels asserted; `'8.2 cm'` for a fixture value;
      card-count assertions updated (9→10, 7→8); declaration-order assertion gains the new label;
      tier-summary-line count assertions updated; new dedicated unavailable-card and
      measuring-scale-hint tests for `stepWidthCm`, mirroring `verticalOscillationCm`'s existing
      ones.
- [x] 7.4 `src/results/ResultsView.tsx`: `addedMetricCount` derived from
      `[verticalOscillationCm.value !== null, stepWidthCm.value !== null].filter(Boolean).length`
      (D6); status line pluralizes "metric(s)" off that count; in-progress phrasing softens to
      count-agnostic "more metrics."
- [x] 7.5 `src/results/ResultsView.test.tsx`: `makeHeuristics()` gains a `stepWidthCm` entry.
      Status-line tests cover 0/1/2 grafted-metric counts (couldn't-add / singular / plural
      wording).

## 8. Diagnostics fixture

- [x] 8.1 `src/results/analysisDiagnostics.test.ts`: `makeHeuristics()` fixture gains a
      `stepWidthCm` entry; the metrics-keys sorted-list assertion gains `'stepWidthCm'`. The
      aggregation code itself (`computeAnalysisDiagnostics`) is unchanged — already generic over
      `MetricId`.

## 9. Verification

- [x] 9.1 `npx tsc -b` — clean.
- [x] 9.2 `npx vitest run` — full suite green (one pre-existing, unrelated failure in
      `VideoInputPanel.test.tsx` confirmed present on a clean stash of this branch, not touched by
      this change).
- [x] 9.3 `openspec validate add-step-width-cm-metric --strict` passes.
