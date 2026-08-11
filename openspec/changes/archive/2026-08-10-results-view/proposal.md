## Why

Every prior ticket in the epic builds one stage of the pipeline in isolation: video input (#4)
produces a playable clip, pose detection (#3) turns a video frame into keypoints, robustness (#5)
turns raw per-frame keypoints into a gap-tolerant stream, and heuristics (#7) turns that stream
into numbers. None of it is wired to a real, playing `<video>` element yet, and none of it is
visible to a user. This change is the integration point: play the loaded clip back, run the whole
pipeline against it once, and show the result — a skeleton overlay synced to playback, and a
metrics panel with a timeseries chart — so a user can actually see what the analysis found and
where it's less certain. It's the screen the user looks at after recording or uploading a run.

## What Changes

- Add `src/results/sampleClip.ts`: plays the loaded clip once at 1x and samples it via
  `requestVideoFrameCallback`, self-throttled to whatever the pose detector can sustain (kick off
  detection for a presented frame if the previous one has resolved; drop the frame and re-arm if
  not). A circuit breaker aborts after `maxConsecutiveErrors` (default 30) consecutive per-frame
  detection failures — a broken detector, not an isolated miss, which is caught and skipped
  instead.
- Add `src/results/useVideoAnalysis.ts`: the hook driving one end-to-end analysis run —
  `sampleClip` → sort samples by timestamp → `applyRobustness` (#5) → `computeFormHeuristics` (#7)
  — exposing `AnalysisPhase` (`idle`/`sampling`/`processing`/`ready`/`error`), progress, and a
  pause flag. Explicit `start()`, not automatic on clip load.
- Add `src/results/skeletonGeometry.ts`: pure, canvas-free geometry — `SKELETON_EDGES` (the 12
  bones connecting the common keypoint set), `findNearestFrame` (binary search by timestamp), and
  `toDrawOps` (maps one `RobustPoseFrame` to point/edge draw instructions, with opacity derived
  from each keypoint's `RobustKeypoint.status` — full for `'detected'`, reduced for
  `'interpolated'`, entirely skipped for `'unrecoverable'`).
- Add `src/results/SkeletonOverlay.tsx`: a canvas positioned over the video, drawing the nearest
  frame's `toDrawOps()` output, kept in sync via an `requestAnimationFrame` loop while playing and
  `seeked`/`timeupdate` listeners for immediate redraw while paused/scrubbing.
- Add `src/results/MetricsPanel.tsx` and `src/results/VerticalOscillationChart.tsx`: numeric
  readouts for all three metrics (value, plain-language label, confidence/applicability
  indicator, with a visibly different — never color-alone — treatment for a flagged metric), plus
  a hand-rolled inline SVG waveform for vertical oscillation, gap-segmented at real tracking
  gaps.
- Add `src/results/ResultsView.tsx`: presentational composition — an "Analyze" button, a
  progress readout, and the metrics panel once ready. Leaves one documented, empty seam for a
  future save/export action (out of scope here).
- Add `src/results/types.ts`: `AnalysisPhase`, `VideoAnalysisError`, `VideoAnalysisState`.
- **Extend `src/heuristics/verticalOscillation.ts` + `src/heuristics/types.ts` (#7, additive):**
  add `TimeseriesPoint` and `VerticalOscillationResult` (a `MetricResult` superset with a
  timestamp-aligned `series`), surfacing the hip-mid-y series `computeVerticalOscillation` already
  builds internally and previously discarded. `FormHeuristicsResult.verticalOscillation` retypes
  to the superset — structurally compatible, no existing consumer breaks.
- **Extend `src/video/VideoInputPanel.tsx` (#4, additive):** add a `children` prop and wrap the
  existing (always-mounted) `<video>` in a `position: relative` stage `<div>`, so `SkeletonOverlay`
  can be rendered as a sibling positioned over it.
- **Extract `src/pose/usePoseDetector.ts` (new):** pulls the lazy-create/cache/dispose detector
  lifecycle out of `useVideoQualityGate` (#6) into a hook shared by both the quality gate and
  analysis, avoiding paying MoveNet's model-load cost twice per session.
- Test helpers: `src/test/videoFrameCallbackTestUtils.ts` (stubs `requestVideoFrameCallback` for
  tests) and `src/test/canvasTestUtils.ts` (a fake 2D context for a thin `SkeletonOverlay` smoke
  test — jsdom has no native canvas).
- Wire `App.tsx`: `usePoseDetector()` once, shared by `useVideoQualityGate` and the new
  `useVideoAnalysis`; render `SkeletonOverlay` as `VideoInputPanel`'s child once analysis is
  ready; render `ResultsView` once a video is loaded.

## Capabilities

### New Capabilities

- `results-view`: plays a loaded clip back through the full analysis pipeline on an explicit user
  action, rendering a skeleton overlay synced to playback (distinguishing directly-detected from
  interpolated keypoints) and a metrics panel with numeric readouts and a vertical-oscillation
  waveform chart.

### Modified Capabilities

- `form-heuristics`: additive extension — `computeVerticalOscillation` now also returns a
  timestamp-aligned `series`, needed for #8's chart. No existing field removed or retyped
  incompatibly.
- `video-input`: additive extension — `VideoInputPanel` accepts an optional `children` prop and
  wraps `<video>` in a positioned stage `<div>`, needed so `SkeletonOverlay` can be layered over
  the canonical video element. No existing prop or rendering behavior for the picker/loading/error
  states changes.
- `pose-detection`: no capability change — `usePoseDetector` is a new consumer-facing hook
  wrapping the existing `createDetector`/`PoseDetector` contract (#3) for shared lifecycle
  management; `video-quality-gate` (#6) changes how it obtains a detector (injected, not
  self-created) but its own behavior is unchanged.

## Impact

- New directory `src/results/` (types, sampling loop, analysis hook, skeleton geometry + overlay,
  metrics panel, chart, composition view, tests).
- New `src/pose/usePoseDetector.ts` (extracted from `useVideoQualityGate`).
- Touches `src/heuristics/verticalOscillation.ts`, `src/heuristics/types.ts`,
  `src/video/VideoInputPanel.tsx`, `src/quality/useVideoQualityGate.ts`, `src/App.tsx`, and their
  existing test files (mechanical updates for the new `series` field and the detector-injection
  signature change).
- No new runtime dependencies — no charting library (a single hand-rolled SVG polyline), no
  `canvas` npm package (pure geometry functions carry the unit-test burden instead).
- Google Drive save/export remains explicitly out of scope — `ResultsView` leaves one documented
  empty seam, nothing more.
