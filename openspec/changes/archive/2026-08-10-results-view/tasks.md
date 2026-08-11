## 1. Cross-ticket touches (#7, #4)

- [x] 1.1 `src/heuristics/types.ts`: add `TimeseriesPoint`, `VerticalOscillationResult`; retype
      `FormHeuristicsResult.verticalOscillation`
- [x] 1.2 `src/heuristics/verticalOscillation.ts`: extend `nullResult()` to accept/default a
      `series` param; populate `series` (timestamp-aligned 1:1 with input frames) in every return
      branch, empty only when `bodyScale` is null
- [x] 1.3 Update `src/heuristics/verticalOscillation.test.ts` and `src/heuristics/index.test.ts`
      field assertions to cover `series`
- [x] 1.4 `src/video/VideoInputPanel.tsx`: add `children` prop, wrap `<video>` in a
      `position: relative` stage `<div>`, render `children` after it — `<video>` stays
      unconditionally mounted (see design.md's risk note)
- [x] 1.5 Verify `src/video/VideoInputPanel.test.tsx` still passes against the new wrapper div

## 2. Shared detector lifecycle

- [x] 2.1 Add `src/pose/usePoseDetector.ts`: `PoseDetectorStatus`, `SharedPoseDetector`,
      extracted verbatim from `useVideoQualityGate`'s lazy-create/cache/dispose logic
- [x] 2.2 Add `src/pose/usePoseDetector.test.ts`: loading → ready, creation failure → error,
      created once across re-renders, disposed on unmount
- [x] 2.3 Change `src/quality/useVideoQualityGate.ts` signature to
      `(videoSource, detector: PoseDetector | null)`; remove its own detector lifecycle
- [x] 2.4 Update `src/quality/useVideoQualityGate.test.ts` to pass a fake `PoseDetector` directly

## 3. Test infrastructure for jsdom gaps

- [x] 3.1 Add `src/test/videoFrameCallbackTestUtils.ts`: stubs
      `video.requestVideoFrameCallback`/`cancelVideoFrameCallback` so tests can manually invoke
      the registered callback with a controlled `mediaTime`
- [x] 3.2 Add `src/test/canvasTestUtils.ts`: a fake 2D context (plain object of `vi.fn()`s)
      stubbed onto `HTMLCanvasElement.prototype.getContext`

## 4. Sampling loop

- [x] 4.1 Add `src/results/sampleClip.ts`: `SampleClipHandle`, `SampleClipOptions`, `sampleClip()`
      per design.md's self-throttled `requestVideoFrameCallback` policy; circuit breaker at
      `maxConsecutiveErrors` (default 30); `pause`/`play`/`ended` event wiring;
      `handle.stop()` cancels the pending rVFC registration and settles the promise with samples
      collected so far
- [x] 4.2 Add `src/results/sampleClip.test.ts`: frame-drop-when-busy, error-skip vs
      circuit-breaker abort, pause/resume event wiring, progress reporting, `ended` resolution,
      `handle.stop()` behavior

## 5. Analysis hook

- [x] 5.1 Add `src/results/types.ts`: `AnalysisPhase`, `VideoAnalysisError`, `VideoAnalysisState`
- [x] 5.2 Add `src/results/useVideoAnalysis.ts`: `start()` (detector/video guards, sampling →
      sort-by-timestamp → `applyRobustness` → `computeFormHeuristics` → ready), `reset()`,
      auto-reset on `videoSource.metadata` identity change, cleanup on unmount — all without
      violating `react-hooks/refs`/`react-hooks/set-state-in-effect` (see design.md)
- [x] 5.3 Add `src/results/useVideoAnalysis.test.ts`: phase transitions
      (idle/sampling/processing/ready/error), sort-before-robustness, detector-unavailable and
      no-video error paths, detection-stalled error path, reset-stops-active-run,
      auto-reset-on-new-clip, unmount cleanup

## 6. Skeleton overlay

- [x] 6.1 Add `src/results/skeletonGeometry.ts`: `SKELETON_EDGES`, `findNearestFrame` (binary
      search), `toDrawOps` (status → opacity mapping, unrecoverable points/edges skipped, an
      edge's opacity is the weaker of its two endpoints')
- [x] 6.2 Add `src/results/skeletonGeometry.test.ts`: nearest-frame lookup (exact/interpolated/
      clamped/empty), draw-op opacity mapping per status, edge skipped when either endpoint is
      unrecoverable
- [x] 6.3 Add `src/results/SkeletonOverlay.tsx`: canvas sized to `metadata.width`/`height`,
      CSS-scaled to fit; `rAF` loop while playing, `seeked`/`timeupdate` redraw otherwise
- [x] 6.4 Add `src/results/SkeletonOverlay.test.tsx`: smoke test via the fake 2D context —
      draws on mount while paused, sets canvas dimensions from metadata, starts/stops the rAF
      loop on play/pause/ended, redraws on seeked/timeupdate, doesn't throw when
      `getContext` returns null

## 7. Metrics panel + chart

- [x] 7.1 Add `src/results/VerticalOscillationChart.tsx`: hand-rolled inline SVG polyline,
      gap-segmented at `null` series entries, `role="img"` + title + text `<figcaption>`
      description
- [x] 7.2 Add `src/results/VerticalOscillationChart.test.tsx`: single vs. gap-segmented
      polylines, empty/all-null fallback, accessible name
- [x] 7.3 Add `src/results/MetricsPanel.tsx`: numeric readouts for all three metrics — value,
      plain-language label, confidence/applicability indicator, visibly-different (not
      color-alone) treatment for flagged metrics, `caveat` text surfaced when present
- [x] 7.4 Add `src/results/MetricsPanel.test.tsx`: high-confidence fixture vs.
      low-confidence/flagged fixture, both rendering correctly and distinguishably

## 8. Results view composition + wiring

- [x] 8.1 Add `src/results/ResultsView.tsx`: "Analyze" button (disabled while
      `qualityAssessing` or `phase !== 'idle'`), progress readout, error alert with retry, ready
      state rendering `MetricsPanel`, one documented empty seam for future save/export
- [x] 8.2 Add `src/results/ResultsView.test.tsx`: button disabled states, progress/paused text,
      error alert + retry, ready-state metrics panel rendering, idle renders no extra content
- [x] 8.3 Wire `src/App.tsx`: `usePoseDetector()` once; `useVideoQualityGate(videoSource,
      detector)`; `useVideoAnalysis(videoSource, detector)`; `VideoInputPanel` renders
      `SkeletonOverlay` as a child once `phase === 'ready'`; render `ResultsView` once a video is
      loaded

## 9. Verification

- [x] 9.1 `npm run lint` passes clean
- [x] 9.2 `npm run build` passes (`tsc -b` + `vite build`)
- [x] 9.3 `npm run test` passes, including all mechanically-updated existing suites
- [x] 9.4 `openspec validate --all` passes clean
- [x] 9.5 `openspec archive results-view` once all of the above are complete
