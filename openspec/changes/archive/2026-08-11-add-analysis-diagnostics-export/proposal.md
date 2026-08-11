## Why

Improving the heuristics pipeline's confidence on more clips requires seeing *why* a given
analysis run came out low-confidence — which keypoints went unresolved, why view detection
landed where it did, how many sampled frames the detector actually returned. Today that
information exists scattered across `RobustPoseFrame`/`FormHeuristicsResult` internals but is
never surfaced anywhere outside the rendered UI text, so diagnosing a pattern across multiple
test clips means manually reading metric cards one at a time.

## What Changes

- A new `computeAnalysisDiagnostics` function aggregates, from data the analysis pipeline
  already produces (no new instrumentation upstream): per-keypoint detected/interpolated/
  unrecoverable counts across the clip, raw view-detection diagnostics, sampling counts
  (total/detected/missing frames), and each metric's confidence-relevant fields in one place.
- `useVideoAnalysis`'s `VideoAnalysisState` gains a `diagnostics: AnalysisDiagnostics | null`
  field, populated alongside `heuristics` once a run reaches `phase: 'ready'`.
- In development builds only (`import.meta.env.DEV`), the diagnostics object is automatically
  logged to the console (a single, greppable, JSON-serialized line) the moment analysis reaches
  `'ready'` — no button, no manual step. This is built for driving the app via browser
  automation (e.g. Playwright) across a batch of test clips and capturing the console output,
  not for end users. It never runs in a production build.

## Capabilities

### New Capabilities
- `analysis-diagnostics`: aggregates and exposes machine-readable diagnostics about a completed
  analysis run (keypoint resolution, view detection, sampling, per-metric confidence inputs),
  for development-time debugging of low-confidence results — not part of the end-user product
  surface.

### Modified Capabilities
(none — `results-view`'s `VideoAnalysisState` gains a field but its own documented requirements
don't change)

## Impact

- New `src/results/analysisDiagnostics.ts` (+ test): pure function, no new dependencies.
- `src/results/types.ts`: `VideoAnalysisState` gains `diagnostics: AnalysisDiagnostics | null`.
- `src/results/useVideoAnalysis.ts`: compute diagnostics alongside heuristics; dev-only
  auto-log effect keyed on `phase === 'ready'`.
- No changes to `sampleClip.ts`, the robustness layer, or any heuristics metric module — this
  reads their existing outputs, it doesn't change what they compute.
