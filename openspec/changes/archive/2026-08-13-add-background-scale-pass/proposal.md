## Why

`verticalOscillationCm` needs a real-world scale, and only the MediaPipe Pose Landmarker backend
measures one — so on the default MoveNet primary pass the centimetre card always renders as "Not
available". The assessed evidence (settled, this epic): MediaPipe resolves VO-cm ≈4.79 cm on the
track demo clip and ≈12.0 cm on the park clip (confidence 0.37/0.41), bit-deterministically —
while MoveNet remains the better primary for everything else (higher view confidence, higher
detection ratio, and it disagrees with MediaPipe on cadence/kneeFlexion with no ground truth
either way). The two backends are not interchangeable; they are complementary: MoveNet for the
eight relative metrics, MediaPipe for the one absolute one.

This change runs one background MediaPipe sampling pass after the primary analysis reaches
`'ready'` and has rendered, computes heuristics over that pass's frames, and grafts ONLY
`verticalOscillationCm` (with a provenance caveat) into the displayed result. Users get the
centimetre figure without giving up MoveNet's primary-pass quality, and without the results UI
blocking on a second full pass.

## What Changes

- **`VideoAnalysisState` gains `scalePass`** (`useVideoAnalysis.ts` + `types.ts`): a status
  machine (`'idle' | 'pending' | 'running' | 'done' | 'failed' | 'skipped'`) plus the scale
  pass's own `AnalysisDiagnostics` (populated on `'done'` only). The ready-transition decides
  `'pending'` vs `'skipped'` (skip reasons: primary already carried scale — covers a
  mediapipe-primary dev override — or the kill-switch is off). A new effect drives the pass:
  dedicated detector → replay the same video muted/unlooped from 0 → `sampleClip` → the identical
  sort → robustness → presence-trim → heuristics pipeline the primary uses → graft. Every state
  write is guarded by the primary run's `runId`; a wall-clock watchdog
  (`max(30s, 3 × clip duration)`) fails the pass rather than letting it hang.
- **New `src/pose/scalePassDetector.ts`**: module-cached `getScalePassDetector()` that lazily
  creates a `mediapipePoseLandmarker` detector, caches it for the page lifetime, returns `null`
  on creation failure (resetting so a later run can retry), and NEVER reads
  `resolvePoseDetectorConfig()` — the backend override applies to the primary detector only.
- **New `src/results/scalePassGraft.ts`**: pure `graftScalePassResult(primary, scale)` — copies
  the scale pass's `verticalOscillationCm` (calibration by reference) onto the primary result
  with a provenance sentence appended to its caveat; every other metric and `view` stay
  reference-identical to the primary's. Composes OUTSIDE `src/heuristics/` — the heuristics
  layer is untouched.
- **New `src/results/scalePassConfig.ts`**: `ScalePassConfig { enabled: boolean }` (default on),
  dev-only `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`, `resolveScalePassConfig()` —
  pattern-clone of `samplingRobustnessConfig.ts`.
- **Results UI** (`ResultsView.tsx` + `MetricsPanel.tsx`): while the pass is `'pending'`/
  `'running'` and the centimetre metric is excluded with a null value, its excluded entry shows a
  "measuring real-world scale with a second detection pass" hint instead of the availability
  caveat. No new card states: a grafted non-null value lands in whatever confidence tier its own
  numbers put it in, exactly like any other metric.
- **Loop-restart re-armed declaratively**: the existing ready-phase loop effect now also waits
  for the scale pass to leave `'pending'`/`'running'`, so the replay doesn't fight the loop; it
  fires immediately when the pass is skipped and again when the pass concludes.
- **Second dev-only console line**: `[analysis-diagnostics:scale-pass]` with
  `{ status, reason?, error?, diagnostics? }` when the pass reaches a terminal status. The
  existing `[analysis-diagnostics]` line is byte-identical to today — same trigger, same payload,
  primary pass only.

## What Does NOT Change

- `src/heuristics/` — no file in it is touched; the graft composes outside the heuristics layer.
- The primary pass: detector selection (`resolvePoseDetectorConfig`), sampling, robustness,
  heuristics, `state.diagnostics`, and the primary `[analysis-diagnostics]` emission are all
  exactly what they were.
- Metric tier thresholds and `metricTier` — a grafted value is tiered by the existing rules.

## Impact

- Affected specs: `results-view` (ADDED ×2, MODIFIED ×1), `analysis-diagnostics` (ADDED ×1),
  `pose-detection` (ADDED ×1).
- Affected code: `src/results/useVideoAnalysis.ts`, `src/results/types.ts`,
  `src/results/ResultsView.tsx`, `src/results/MetricsPanel.tsx`, new
  `src/pose/scalePassDetector.ts`, new `src/results/scalePassGraft.ts`, new
  `src/results/scalePassConfig.ts`, plus tests and CLAUDE.md harness notes.
- Runtime cost: one extra full-clip playback + MediaPipe inference per analysis run, after
  results render — the user sees results at the same time as today; the centimetre card
  upgrades (or its excluded-entry reason resolves) when the pass lands.
