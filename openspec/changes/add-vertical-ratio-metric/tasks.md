## 1. OpenSpec change

- [x] 1.1 `openspec new change add-vertical-ratio-metric`; write `proposal.md`, `design.md`
      (D1–D9), `tasks.md`, `specs/form-heuristics/spec.md` delta (ADDED-only, five requirements).
- [x] 1.2 `openspec validate add-vertical-ratio-metric --strict` passes. Do NOT archive.

## 2. Types

- [x] 2.1 `src/heuristics/types.ts`: `MetricId` widens with `'verticalRatio'` immediately after
      `'verticalOscillation'`. `FormHeuristicsResult.verticalRatio: MetricResult` added in the same
      position. `DEFAULT_VIEW_FIT_TABLE.verticalRatio` row per design.md D4, with its own doc
      comment (stride-observability argument, not copied numbers). `MetricResult.unit`'s `'percent'`
      doc comment updated to note it's no longer solely `armSwingSymmetry`'s case (D7).
      `MetricResult.sampleSize`'s per-metric doc list gains "stride pairs" for `verticalRatio`. No
      new `HeuristicsConfig` keys.

## 3. Stride length extractor

- [x] 3.1 `src/heuristics/strideLength.ts` (new): `estimateStrideLength(frames, config)` per
      design.md D1 — gate order body-scale → travel-direction → footstrike-count →
      usable-pairs, no re-pairing across a dropped strike, median of signed-positive same-side
      consecutive-pair displacements. Module doc: what a stride is, the doubling-bias direction
      (reads LOW on the ratio, named explicitly), the two rejected gap-tolerance alternatives with
      their triggers.
- [x] 3.2 `src/heuristics/strideLength.test.ts` (new): constants TORSO=150 (fixture default),
      travel 100px/s, 4s/30fps/170spm clip → expected stride period `120/170` s → expected
      `70.588px`; tolerance = one frame of travel = `100/30 = 3.33px`. Clean side clip: ok, value
      within tolerance, `pairCount >= 3`, `candidatePairCount === pairCount`. Parametric
      `travelSpeedPxPerSec: 200` → ~141.2px (proves displacement is actually measured, not a
      fixture artifact). Doubled-interval robustness: blank one side's ankle to unrecoverable
      across one strike window → median still within tolerance. Endpoint drop: hips unrecoverable
      at exactly one strike frame → `pairCount === candidatePairCount - 2` (that frame is an
      endpoint of two candidate pairs), median unchanged, no re-pairing. Failures:
      `travelSpeedPxPerSec: 0` → `'travel-direction-unknown'`; flat-ankle fixture →
      `'too-few-footstrikes'`; `buildFrame({})` → `'no-body-scale'`; `[]` → not-ok, no throw.

## 4. Vertical ratio metric

- [x] 4.1 `src/heuristics/verticalRatio.ts` (new): `computeVerticalRatio(frames, view, config)` per
      design.md D2. `MIN_STRIDE_PAIRS = 3` module constant (D3). Hip-pinned via `analyzeHipBounce`
      (never the configured `verticalOscillationSignal` pair). Gate order: bounce fit (resolved
      count, fit success, `verticalOscillationMinFitR2`) before stride length, so a degenerate
      bounce is reported as a bounce-shaped caveat even when stride length would also fail.
      `value = fit.peakToPeakAmplitude / stride.strideLengthPx` exactly. `travelDirectionKnown` NOT
      passed to `computeMetricConfidence` (hard gate already makes the 0.5 factor unreachable).
      Exact travel-direction-unknown caveat text per design.md D2/D8. Module doc: family
      relationship to `verticalOscillation`/`verticalOscillationCm`, hip-pinning rationale, D6's
      gate-reuse invariant, D7's fraction-vs-percent note, D8's PENDING watch-comparability note,
      the diagnostics-recoverability trick (no new diagnostics field needed).
- [x] 4.2 `src/heuristics/verticalRatio.test.ts` (new): clean case (`verticalBouncePx: 6` against
      the same stride-length fixture as 3.2) → `value` within the one-frame-quantization bounds
      `(6/73.92, 6/67.25)` [expected stride ± one frame of travel: `70.588 ± 3.33`], `unit`
      `'percent'`, `viewFit` `'primary'`, `confidence > 0.9`. Gate: `travelSpeedPxPerSec: 0` →
      `value: null`, `confidence: 0`, caveat contains the exact prefix "Direction of travel could
      not be determined (no net horizontal displacement)". Front-view-that-travels (engineered per
      design.md D4's narrower case) → non-null value, `viewFit: 'unsuitable'`, `confidence < 0.15`,
      view-unsuitable caveat present. `verticalBouncePx: 0` → `null` with a degenerate-bounce
      caveat (numerator gate evaluated first, per spec's "ahead of the stride-length check"
      scenario). Never-NaN/Infinity sweep across `[]`, a clean clip, `verticalBouncePx: 0`, a
      front-view clip, a noisy hip trace (via `framesFromHipTrace` + `seededNormals`), a 5-sample
      ramp, and `travelSpeedPxPerSec: 0` — each × all three views — asserting no `NaN`/`Infinity`,
      `confidence === 0` whenever `value === null`, and no throw.

## 5. Orchestration

- [x] 5.1 `src/heuristics/index.ts`: `computeVerticalRatio` called after `computeVerticalOscillation`
      in `computeFormHeuristics`'s return object, module doc count seven → eight.
- [x] 5.2 `src/heuristics/index.test.ts`: new drift-guard test — `estimateStrideLength(frames,
      DEFAULT_HEURISTICS_CONFIG)` computed directly, asserting
      `result.verticalRatio.value === result.verticalOscillation.fit!.peakToPeakAmplitudePx /
      stride.strideLengthPx` and `result.verticalRatio.sampleSize === stride.pairCount` — comment
      noting this is default-config-scoped (an `earMid` VO signal override would split
      `verticalOscillation`'s fit from `verticalRatio`'s hip-pinned one, by design, per D2).
      Existing clean-clip/ambiguous-view/empty-frames tests extended to cover `verticalRatio`.
      "all seven" comments become "all eight".

## 6. Results layer

- [x] 6.1 `src/results/metricConfidence.ts`: `METRIC_LABELS.verticalRatio = 'Vertical ratio'`,
      positioned after `verticalOscillation`.
- [x] 6.2 `src/results/MetricsPanel.tsx`: `METRIC_DESCRIPTIONS.verticalRatio` — "How much you
      bounce up and down relative to how far you travel each stride. This is the same concept a
      running watch calls 'vertical ratio', though this figure has not been validated against a
      watch reading." New `<MetricCard metric={heuristics.verticalRatio} />` immediately after the
      vertical-oscillation card. Module doc's "seven" → "eight".
- [x] 6.3 `src/results/MetricsPanel.test.tsx`: both `makeHighConfidenceResult`/
      `makeLowConfidenceResult` fixtures gain a `verticalRatio` entry; "renders all seven" test
      renamed/extended to eight including the new label; low-confidence-flag-count assertions
      updated for the added card; `verticalRatio.caveat: null` in the high-confidence fixture
      preserves the existing "exactly one note" (`footStrikePattern`'s) assertion.
- [x] 6.4 `src/results/LowConfidenceBanner.tsx`: per design.md D9, replace the hand-written
      `METRIC_IDS` array with `Object.keys(METRIC_LABELS) as MetricId[]`.
- [x] 6.5 `src/results/LowConfidenceBanner.test.tsx`: fixture gains a `verticalRatio` entry; new
      test asserting the derived list covers every `METRIC_LABELS` key (D9's exhaustiveness
      guarantee, exercised — not just typed).
- [x] 6.6 `src/results/analysisDiagnostics.ts`: NO code change — `metrics` is built by iterating
      `Object.entries(heuristics)` filtering out `'view'`, already name-driven. Verify this by
      running its existing tests after the fixture updates below, plus fix the "uniform across all
      seven metrics" doc-comment count (→ eight).
- [x] 6.7 `src/results/analysisDiagnostics.test.ts`: `makeHeuristics` fixture gains a
      `verticalRatio` entry; the sorted-metric-ids assertion list gains `'verticalRatio'`.
- [x] 6.8 `src/results/ResultsView.test.tsx`, `src/results/useVideoAnalysis.test.ts`: fixtures gain
      a `verticalRatio` entry (`unit: 'percent'`, a representative value, e.g. via
      `makeMetric({ metric: 'verticalRatio', unit: 'percent', value: 0.08 })` where a `makeMetric`
      helper already exists at that site, otherwise matching the site's existing inline literal
      style).

## 7. Doc-count fixes outside the results layer

- [x] 7.1 `src/App.tsx` ~line 54: "(seven cards)" → "(eight cards)".
- [x] 7.2 `src/heuristics/verticalOscillationCm.ts` ~line 200: "seven-metric result shape" —
      **SKIPPED**. Ticket #34 (parallel, own worktree) owns this file for the epic #33 cm-estimator
      work; touching it here risks a needless merge conflict. Left as a one-word note for the
      orchestrator to fold at merge.

## 8. Fixture support

- [x] 8.1 `src/heuristics/__fixtures__/syntheticGait.ts`: `SyntheticGaitParams` gains optional
      `travelSpeedPxPerSec?: number`, defaulting to the existing `TRAVEL_SPEED_PX_PER_SEC = 100`
      constant — additive and default-preserving, no existing test's expected values move. At `0`,
      produces a treadmill/in-place clip: footstrikes still detectable (ankle sway/lift is
      independent of hip-x travel), but hip-x never advances, so `estimateTravelDirection` returns
      `0`.

## 9. Verification

- [ ] 9.1 `npx tsc -b && npx vitest run && npx eslint .` — all green.
- [ ] 9.2 `openspec validate add-vertical-ratio-metric --strict` passes (this change only).
- [ ] 9.3 Live verification (Playwright, real GPU, MoveNet default) — see proposal.md's harness
      notes and epic #33's gotchas. ≥3 trials per demo clip (5 preferred). Track clip: median
      `verticalRatio.value` in `[0.04, 0.12]`; record `pairCount` per trial (D3's upgrade-trigger
      leading indicator) and derived stride px
      (`verticalOscillationFit.peakToPeakAmplitudePx / verticalRatio.value`); other seven metrics'
      medians within their previously recorded spreads. Park clip: `verticalRatio.value === null`
      with the exact caveat prefix on every trial — if any trial resolves a direction, cross-check
      `overstriding`'s caveat in the same diagnostics dump (divergence between the two metrics'
      travel-direction reads is a finding to report, not silently patch).

## 10. Commit

- [ ] 10.1 Commit with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. No push,
      no merge, no archive.
