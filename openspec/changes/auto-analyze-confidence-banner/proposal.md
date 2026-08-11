## Why

The pre-analysis quality gate (resolution/frame-rate/detection-confidence checks, blocking modal,
"Proceed anyway") adds a step between loading a clip and seeing results, and duplicates signal
that the analysis itself already produces per-metric confidence for. Running analysis
automatically and only warning when the *actual* computed metrics turn out unreliable is a
simpler, more direct flow: load a clip, see results, get told only if something's off.

## What Changes

- Analysis starts automatically once a freshly loaded clip reaches `videoSource.status ===
  'ready'` and a detector is available — no explicit "Analyze" click needed for the first run.
  The manual "Analyze"/"Analyze again" control remains, for retries and re-running the same clip.
- The pre-analysis quality gate is retired entirely: `useVideoQualityGate`, `assessVideoQuality`,
  the `video-quality-gate` capability's resolution/frame-rate/detection-confidence checks, the
  blocking modal, and "Proceed anyway" are removed. **BREAKING**: nothing in the app pre-screens
  clip quality before analysis runs anymore.
- A new, non-modal, non-blocking banner appears after analysis completes (`phase: 'ready'`),
  listing which computed metrics are low-confidence — using the exact same per-metric
  flagged-or-not condition `MetricsPanel` already uses (`value === null`, `confidence` below the
  existing low-confidence threshold, or `viewFit === 'unsuitable'`). It renders nothing when no
  metric is flagged.
- The demo video button (`DemoVideoButton`) switches back to
  `https://www.pexels.com/video/side-view-of-a-man-running-at-a-track-8533913/` (the original demo
  clip), full length, no trim.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `results-view`: "Explicit analysis trigger" requirement changes to auto-start on ready (manual
  control retained for retries); adds a new low-confidence-results-banner requirement.

### Removed Capabilities
- `video-quality-gate`: retired in full — every requirement in
  `openspec/specs/video-quality-gate/spec.md` is removed. Reason and migration are captured per
  requirement in the delta spec.

## Impact

- Delete `src/quality/` in full: `useVideoQualityGate.ts(+.test.ts)`, `assessVideoQuality.ts(+.test.ts)`,
  `types.ts`, `QualityWarningBanner.tsx(+.test.tsx)`.
- `src/App.tsx`: drop `useVideoQualityGate` wiring, `handleProceedAnyway`, and
  `QualityWarningBanner` composition.
- `src/results/useVideoAnalysis.ts`: add an effect that calls `start()` once
  `videoSource.status === 'ready'`, `phase === 'idle'`, and `detector` is non-null.
- `src/results/ResultsView.tsx`: drop the now-unused `qualityAssessing` prop; render the new
  low-confidence banner alongside `MetricsPanel` once `phase === 'ready'`.
- New `src/results/LowConfidenceBanner.tsx` (+ test): pure presentational component, no hook —
  derives its flagged/not-flagged state directly from `FormHeuristicsResult`.
- New `src/results/metricConfidence.ts`: extracts the low-confidence threshold, per-metric
  flagged check, and metric display labels out of `MetricsPanel.tsx` so both it and the new
  banner share one definition instead of duplicating the threshold constant.
- `src/video/DemoVideoButton.tsx` (+ test): `DEMO_VIDEO_URL` reverts to
  `https://videos.pexels.com/video-files/8533913/8533913-uhd_3840_2160_25fps.mp4`.
