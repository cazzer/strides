## Why

Issue #36 (epic #33). `verticalOscillationCm` (#34) has been a diagnostics-only calculation since
it shipped — real when it exists, but only visible in the dev-only `analysisDiagnostics` console
export, with no `MetricId`, no card, no confidence, and its own private quality gate
(`CM_MIN_FIT_R2`) duplicating `verticalOscillationMinFitR2` rather than reusing it. Meanwhile
`verticalRatio` (#35) shipped as the family's second real metric, immediately after
`verticalOscillation` in `MetricId`. This change promotes `verticalOscillationCm` to the family's
third metric — completing the pattern the epic promised: one bounce, three denominators (torso
length, stride length, none at all), all three real `MetricId`s a user can see.

The promotion is deliberately conservative: it reuses the existing `computeVerticalOscillationCm`
calculation UNCHANGED (still called exactly once), reuses `verticalOscillationMinFitR2` instead of
introducing a coherence-breaking second gate, and reuses `viewFitTable`/`computeMetricConfidence`
precedent from `verticalOscillation`/`verticalRatio` rather than inventing new confidence
machinery. The `AnalysisDiagnostics.scaleCalibration` diagnostics block stays — it carries fields
(`fit`, `fitFailureReason`, `scaleDriftRatio`, `torsoMeters`, `scaleCoverage`, `integrationRuns`)
richer than the `MetricResult` shape has room for — but it is now sourced from the metric's own
`calibration` field by reference, not a second computation.

## What Changes

- **`MetricId` widens `verticalOscillation` → `verticalRatio` → `verticalOscillationCm` →
  `trunkLean`** (8 → 9 metrics), appended after `verticalRatio` rather than inserted between
  `verticalOscillation` and `verticalRatio` — #35's shipped orchestration requirement says
  `verticalRatio` sits immediately after `verticalOscillation`, and appending preserves that
  literally rather than requiring it to be re-verified against a new neighbour.
- **New `unit: 'centimeters'`** on `MetricResult.unit` — an absolute physical quantity with no
  denominator, unlike every other unit in the union.
- **New `VerticalOscillationCmResult`** (`extends MetricResult`), carrying `calibration:
  ScaleCalibratedVerticalOscillation | null` — non-null iff a real-world scale was measured for
  the clip. `ScaleCalibratedFitFailureReason`/`ScaleCalibratedFit`/`ScaleCalibratedVerticalOscillation`
  move from `verticalOscillationCm.ts` to `types.ts` (mechanical; doc comments travel), since every
  consumer of `FormHeuristicsResult`, not just that module, now needs to reference the shape.
- **New `computeVerticalOscillationCmMetric(frames, view, config)`** in `verticalOscillationCm.ts`
  — the policy layer, calling the existing `computeVerticalOscillationCm(frames, config)` EXACTLY
  ONCE and turning its result into a `VerticalOscillationCmResult`: backend-gated (null +
  availability caveat when no scale was measured), reason-mapped caveats when scale was measured
  but no fit cleared the gate, and a `computeMetricConfidence`-based confidence for a resolved
  value — view-tolerant on the same terms as `verticalOscillation` (identical multipliers: side
  1.0, front 0.85 tolerated, ambiguous 0.6 tolerated), since this metric's numerator is the same
  view-tolerant hip bounce and it has no view-degenerate denominator (unlike `verticalRatio`) to be
  dragged down by.
- **Deletes `CM_MIN_FIT_R2`**, the calculation's former private module constant — the quality gate
  now reads `config.verticalOscillationMinFitR2` verbatim, the same reuse `verticalRatio` already
  established and for the identical reason: gating the identical fitted amplitude behind two
  independently-tunable thresholds would let the family disagree about whether one fit is
  trustworthy. Defaults are unchanged, so live output is bit-identical to before this change.
- **`computeFormHeuristics` orchestrates the new metric**; `computeAnalysisDiagnostics` drops its
  optional 4th parameter and instead derives `scaleCalibration` from
  `heuristics.verticalOscillationCm.calibration` BY REFERENCE — no-double-compute becomes a
  reference-identity invariant, not just an absence of a second function call.
  `useVideoAnalysis.ts` deletes its now-redundant direct `computeVerticalOscillationCm` call.
- **Results layer**: `METRIC_LABELS` gains `'Vertical oscillation (cm)'`; `MetricsPanel` gains a
  `'centimeters'` formatting branch (`N.N cm`, no percent/torso-length suffix) and a card
  immediately after `verticalRatio`'s; all three family cards' descriptions are rewritten to state
  what each number is relative to (or that it has no denominator at all). `LowConfidenceBanner`
  needs no code change — it already derives its metric-id enumeration from `METRIC_LABELS`'s keys.
- **No new config keys** beyond what already existed. `verticalOscillationCm` reuses
  `verticalOscillationMinFitR2` (design.md D3) and gets one new `viewFitTable` row (D2).
  `computeMetricConfidence` gains one new optional parameter, `scaleCoverage` (default 1, linear
  multiply) — the first metric-specific confidence factor this family has needed beyond the
  existing set.

## Impact

- Affected specs: `form-heuristics` (ADDED: backend-gated metric, view-tolerance, family
  coherence, orchestration participation; MODIFIED: the scale-calibrated-oscillation calculation's
  minimum-R² clause now names `verticalOscillationMinFitR2`, and the presence-trim carve-out now
  describes the block as produced by `computeFormHeuristics` itself), `analysis-diagnostics`
  (MODIFIED: diagnostics aggregation drops its optional 4th input; the scale-calibration
  scenario's source is now the metric's own `calibration` field), `results-view` (ADDED: the
  vertical-oscillation family's cards name their denominators).
- Affected code: `src/heuristics/types.ts`, `verticalOscillationCm.ts`, `confidence.ts`, `index.ts`,
  `src/results/analysisDiagnostics.ts`, `useVideoAnalysis.ts`, `metricConfidence.ts`,
  `MetricsPanel.tsx`. No changes to `verticalOscillation.ts`, `verticalRatio.ts`, `hipBounce.ts`,
  or any other family sibling's own computation — only orchestration, diagnostics, and the results
  UI change around them.
- Not in scope (recorded in design.md as follow-up): rendering an unavailable/not-applicable card
  more legibly than "Lower-confidence result" (#37's problem — flagged forward, not band-aided
  here); a `torsoMeters` plausibility caveat; retuning any default.
