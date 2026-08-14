## Why

Issue #46 (parent: #43, partial) asks for a step-width metric — the crossover-gait signal, i.e.
whether a foot lands under the hips or crosses the body's midline. None of the existing nine
metrics report mediolateral foot placement at all: overstriding reads the fore-aft (sagittal)
ankle-hip offset, and every other footstrike-relative metric is either sagittal-plane or a
bilateral-symmetry comparison, not a per-footstrike lateral-offset measurement. This is also
backend-agnostic (a pure pixel ratio, scale cancels out) and keypoint-cheap — it needs only the
ankle/hip keypoints already in the pipeline, not the heel/foot_index widening tracked separately.

## What Changes

- Add `computeStepWidth` in `src/heuristics/stepWidth.ts`: at each footstrike (reusing
  `detectFootstrikes`, the same shared basis `overstriding`/`cadence`/`footStrikePattern` use), the
  signed lateral offset of that leg's ankle from the hip-midline, as a fraction of hip width.
- **Sign convention (the metric's one correctness-critical decision):** polarity is resolved
  per-footstrike from that same frame's own-side hip position relative to hip-mid — NOT a
  clip-wide constant — so that positive always means "landed on its own anatomical side" and
  negative always means "crossed toward or past the midline," regardless of which leg. A naive,
  unflipped `ankle.x - hipMid.x` combined across both legs cancels toward ~0 for any symmetric
  gait (wide or narrow), destroying the crossover signal this metric exists to report — see
  `design.md` for the full derivation, including a fixture that empirically confirms this failure
  mode before the fix.
- Add a new hip-width scale reference, `estimateHipWidth` in `src/heuristics/bodyScale.ts` — median
  left-right hip separation across frames, mirroring `estimateBodyScale`'s existing pattern but a
  distinct denominator (this metric's own, not torso length).
- Extend `MetricId`, `FormHeuristicsResult`, and `DEFAULT_VIEW_FIT_TABLE`
  (`src/heuristics/types.ts`) with `stepWidth`, gated **front/rear-view-primary, side-unsuitable**
  — mirroring `armSwingSymmetry`'s row exactly, since both are mediolateral measurements collapsed
  toward degeneracy by a side-on camera. Unit `'percent'`, following `verticalRatio`'s precedent
  (not `'ratio'`, which `MetricsPanel.formatValue` hard-codes to a "% of torso length" suffix that
  would misstate a hip-width-relative quantity).
- Wire `computeStepWidth` into `computeFormHeuristics` (`src/heuristics/index.ts`), appended after
  `footStrikePattern` per this file's established append-only convention.
- Render a tenth `MetricCard` in `MetricsPanel` (`src/results/MetricsPanel.tsx`) with a label,
  plain-language description stating both the hip-width denominator and the sign convention (the
  bare `'percent'` formatting emits `NN.N%` with no denominator suffix, so the description is the
  only place either fact is stated), and `'percent'`-aware formatting (already implemented).

## Capabilities

### Modified Capabilities
- `form-heuristics`: adds a tenth metric, step width, with its own view-fit table entry and an
  output contract identical in shape to the existing nine metrics (`MetricResult`, never `null`
  purely because the view is unsuitable, never throws, never `NaN`).

## Impact

- New: `src/heuristics/stepWidth.ts`, `src/heuristics/stepWidth.test.ts`.
- Edited: `src/heuristics/bodyScale.ts` (+ `.test.ts`), `src/heuristics/types.ts`,
  `src/heuristics/index.ts` (+ `.test.ts`), `src/results/metricConfidence.ts`,
  `src/results/MetricsPanel.tsx` (+ `.test.tsx`), `src/results/ResultsView.test.tsx`,
  `src/results/useVideoAnalysis.test.ts`, `src/results/analysisDiagnostics.test.ts` (+
  `analysisDiagnostics.ts` doc comment only — the aggregation itself is already generic over
  `FormHeuristicsResult`'s keys), `src/results/scalePassGraft.test.ts` (+ `scalePassGraft.ts` doc
  comment only — the graft itself already spreads `primary` generically).
- No new runtime dependencies. No changes to view detection, the robustness layer, or the
  computation of any existing metric. Does not touch `stepWidthCm` (#45, a separate ticket/agent),
  `src/pose/types.ts` keypoint widening (#44, separate), or `fuseHeuristics.ts`/
  `multiClipAnalysis.ts` (#48, separate).
