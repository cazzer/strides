## Why

Issue #45 (partial completion of parent #43). `verticalOscillationCm` (#34/#36) proved that a
MediaPipe-only, real-world-centimetre metric can sit alongside this pipeline's existing
torso/stride-relative ratios as a real `MetricId` — "not available" on backends that don't measure
scale, a real number on the one that does. Step width is the natural second candidate: a
mediolateral (side-to-side) footstrike offset that consumer running watches already report in
centimetres, and this pipeline already computes the identical pixel-space signal for `stepWidth`
(issue #46, a separate ticket/worktree) — this change adds only the centimetre conversion, reusing
the same `pixelsPerMeter` plumbing `verticalOscillationCm` already established.

**The one thing this change deliberately does NOT do**: copy `verticalOscillationCm.ts`'s
spectral-fit/drift-integration machinery. Despite the shared naming convention, `stepWidthCm` is
structurally `overstriding`'s shape, not `verticalOscillationCm`'s — an INSTANTANEOUS per-frame
spatial offset (ankle vs. hip-mid, read off one video frame) divided by that same frame's
`pixelsPerMeter`, never a time series to integrate. `verticalOscillationCm`'s spectral fit and
per-frame-delta integration exist specifically to solve a camera-approach-drift problem when
accumulating a *series* of bounce over time; that problem cannot arise for a same-instant spatial
ratio, so `stepWidthCm` has no `calibration`/`fit` companion type, no per-run integration, and no
weighted-median-across-runs selection — a plain `MetricResult` is the whole shape.

## What Changes

- **`MetricId` widens to `stepWidthCm`, appended last** (after `footStrikePattern` — 9 → 10
  metrics), mirroring how `verticalOscillationCm` was appended after `verticalRatio` rather than
  inserted mid-list, so no existing metric's position in `MetricId` or its enumerations moves.
- **New `src/heuristics/stepWidthCm.ts`** — `computeStepWidthCm(frames, view, config)`: at each
  footstrike (`detectFootstrikes`, shared with `overstriding`/`cadence`/`footStrikePattern`),
  reads the signed ankle-x-minus-hip-mid-x offset and converts it to centimetres via that frame's
  `pixelsPerMeter`, median across footstrikes. Backend-gated FIRST (before footstrike detection,
  mirroring `computeVerticalOscillationCmMetric`'s ordering): a clip with no measured scale
  anywhere reports one availability caveat, never a confusing "no footstrikes" message for a clip
  that tracked fine on the wrong backend. Frames without a usable scale at a given footstrike are
  excluded from that footstrike's contribution, not treated as a whole-clip failure. No travel-
  direction correction (unlike `overstriding`'s fore-aft offset, a mediolateral offset has no
  fore-aft sign to resolve). View-gated front/rear-primary, side-unsuitable — the mirror image of
  `overstriding`'s side-primary gating and the same shape `armSwingSymmetry` already uses, since a
  side-on camera collapses the mediolateral offset toward zero rather than reading it noisily.
- **New `viewFitTable.stepWidthCm` row** in `types.ts`, mirroring `armSwingSymmetry`'s exactly
  (front/rear `primary: 1.0`, side `unsuitable: 0.1`, ambiguous `unsuitable: 0.2`).
  `MetricResult.unit`'s `'centimeters'` doc comment updates to name both producers.
- **Scale-pass graft extended, not scoped out** (`src/results/scalePassGraft.ts`): the background
  MediaPipe scale pass now grafts `stepWidthCm` alongside `verticalOscillationCm` whenever it
  completes with a measured scale. This costs no new gating branch anywhere the pass's fate is
  decided — the existing gate (`verticalOscillationCm.calibration !== null`, in
  `useVideoAnalysis.ts`) already tests the exact same underlying fact (`pixelsPerMeter` measured)
  that gates `stepWidthCm` — it only widens what gets pulled out of an already-computed scale-pass
  result. The two metrics graft independently: a pass that measured scale broadly but found no
  footstrikes for `stepWidthCm` specifically still grafts that metric's own null value and caveat,
  without disturbing a successfully-grafted `verticalOscillationCm`.
- **Results UI**: `METRIC_LABELS` gains `'Step width (cm)'`; `MetricsPanel` gains a
  `METRIC_DESCRIPTIONS` entry and a card (`formatValue`'s existing `'centimeters'` branch needs no
  new code); the scale-pass-in-progress excluded-entry hint widens to match either
  `verticalOscillationCm` or `stepWidthCm`, not just the former. `ResultsView`'s ready-phase status
  line now counts how many of the two scale-pass-backed metrics actually gained a value
  (`0`/`1`/`2`), pluralizing "metric(s)" off that count instead of assuming exactly one was added;
  its in-progress phrasing softens from "one more metric" to a count-agnostic "more metrics" since
  the eventual count isn't known until the pass concludes.
- **No new config keys, no changes to `verticalOscillation.ts`/`verticalOscillationCm.ts`/
  `overstriding.ts`/`stepWidth.ts`** (`stepWidth.ts`, the sibling pixel-ratio metric, is issue #46,
  a separate ticket/worktree — not touched here) — and no changes to `src/pose/` (the
  `pixelsPerMeter` plumbing this change reuses already shipped with #34/#36).

## Impact

- Affected specs: `form-heuristics` (ADDED: the new metric's backend gate, view-gating, and
  orchestration-participation requirements — the same three-requirement shape
  `verticalOscillationCm` established), `results-view` (MODIFIED: the background-scale-pass graft
  requirement widens to both metrics; the centimetre-card/status-line requirement widens to a
  count-based "how many metrics were added" narrative; the metrics-panel tier requirement's metric
  count updates from nine to ten. ADDED: a dedicated requirement for the step-width card's
  centimetre rendering, since it is not a member of the existing "vertical-oscillation family"
  requirement, which is scoped to `verticalOscillation`/`verticalRatio`/`verticalOscillationCm`
  specifically).
- Affected code: `src/heuristics/types.ts`, new `src/heuristics/stepWidthCm.ts` (+ test),
  `src/heuristics/index.ts` (+ test), `src/results/scalePassGraft.ts` (+ test),
  `src/results/metricConfidence.ts`, `src/results/MetricsPanel.tsx` (+ test),
  `src/results/ResultsView.tsx` (+ test), `src/results/useVideoAnalysis.ts` (comment-only) (+
  test), `src/results/analysisDiagnostics.test.ts` (fixture gains the new key; the aggregation
  code itself is already generic over `MetricId` and needs no change).
- Not in scope: `src/heuristics/stepWidth.ts` (the pixel-ratio sibling, #46), `src/pose/types.ts`/
  keypoint widening (#44), `src/results/fuseHeuristics.ts`/`multiClipAnalysis.ts` (#48) — all
  separate tickets per the epic's parallel-tracks split.
