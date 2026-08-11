## Why

The quality warning currently renders inline in the page flow instead of as a standard dimmed
modal, the metrics panel sits below the video and requires scrolling past it to see, and the
video stops on its final frame once analysis completes instead of looping so the user can
keep watching the skeleton overlay trace their form. These three gaps make the results
experience harder to read and less polished than the underlying analysis warrants.

## What Changes

- `QualityWarningBanner` renders as a modal dialog with a dimmed backdrop over the rest of the
  screen (instead of an inline block in the page flow), keeping its existing content (failed
  checks + "Proceed anyway") and focus-management behavior.
- The results layout places the metrics/stats panel beside the video on wide viewports (instead
  of stacked below it), so both are visible without scrolling; narrow viewports keep the
  stacked fallback.
- Once analysis reaches `phase: 'ready'`, the video loops continuously with the skeleton overlay
  superimposed, instead of remaining paused on its last frame.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `video-quality-gate`: the quality warning's rendering requirement changes from an inline
  alert block to a modal dialog with a dimming backdrop.
- `results-view`: adds a requirement that video playback loops (with the overlay) once analysis
  reaches `phase: 'ready'`.

## Impact

- `src/quality/QualityWarningBanner.tsx` (+ its test): inline alert → modal dialog + backdrop.
- `src/App.tsx`: composition point for the modal overlay; results layout (side-by-side video +
  stats); wiring the loop-restart on `phase: 'ready'`.
- `src/results/ResultsView.tsx`, `src/results/MetricsPanel.tsx`: layout only, no behavior change.
- `src/results/useVideoAnalysis.ts`: transition into `phase: 'ready'` needs to trigger the
  loop-restart (seek to 0, set `loop`, `play()`).
- `src/video/VideoInputPanel.tsx`: video element wrapper, may need layout adjustment for the
  side-by-side composition.
- `src/results/SkeletonOverlay.tsx`: no functional change expected, but looped playback must not
  break its `play`/`pause`/`ended`/`seeked`/`timeupdate`-driven redraw logic.
- The side-by-side layout change is presentational only and does not change any spec-level
  requirement, so it is not listed as a modified capability above.
