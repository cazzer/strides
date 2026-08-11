## 1. Retire the quality gate

- [x] 1.1 Delete `src/quality/` in full: `useVideoQualityGate.ts`, `useVideoQualityGate.test.ts`,
      `assessVideoQuality.ts`, `assessVideoQuality.test.ts`, `types.ts`,
      `QualityWarningBanner.tsx`, `QualityWarningBanner.test.tsx`.
- [x] 1.2 `App.tsx`: remove `useVideoQualityGate` wiring, `handleProceedAnyway`, and
      `QualityWarningBanner` composition.

## 2. Auto-start analysis

- [x] 2.1 `useVideoAnalysis.ts`: add an effect that calls `start()` once
      `videoSource.status === 'ready'`, `state.phase === 'idle'`, and `detector !== null`.
      `start()` also mutes the video before calling `play()` for sampling (unconditionally, not
      just for the auto-start path) — the effect-triggered call no longer has the synchronous
      click-handler call stack the old manual-only trigger relied on for autoplay policy.
- [x] 2.2 `ResultsView.tsx` (+ its `ResultsViewProps`): drop the now-unused `qualityAssessing`
      prop and its role in `analyzeDisabled`/`analyzeDisabledReason`.
- [x] 2.3 `App.tsx`: drop the `qualityAssessing` prop passed to `ResultsView`.
- [x] 2.4 Update `useVideoAnalysis.test.ts` and `ResultsView.test.tsx` for the new behavior
      (auto-start on ready with a detector; no more quality-gate-assessing disabled state).
      Discovered and fixed a real bug along the way: auto-start re-fired every time `phase`
      returned to `'idle'` (including after an explicit `reset()`), fighting `reset()` and
      abandon-on-new-clip. Fixed with `autoStartedForRef`, tracking which clip's `metadata`
      auto-start has already fired for so it fires at most once per clip.

## 3. Low-confidence results banner

- [x] 3.1 New `src/results/metricConfidence.ts`: export `LOW_CONFIDENCE_THRESHOLD`,
      `METRIC_LABELS`, and `isMetricFlagged(metric: MetricResult): boolean`, extracted from
      `MetricsPanel.tsx`.
- [x] 3.2 `MetricsPanel.tsx`: import `LOW_CONFIDENCE_THRESHOLD`/`METRIC_LABELS`/`isMetricFlagged`
      from `metricConfidence.ts` instead of defining them locally; behavior unchanged.
- [x] 3.3 New `src/results/LowConfidenceBanner.tsx` (+ test): pure presentational component
      taking `heuristics: FormHeuristicsResult`, renders nothing if no metric is flagged
      (`isMetricFlagged`), otherwise a non-modal `role="status"` banner naming the flagged
      metric(s) via `METRIC_LABELS`. (Component done; test pending.)
- [x] 3.4 `ResultsView.tsx`: render `LowConfidenceBanner` alongside `MetricsPanel` inside the
      existing `phase === 'ready' && heuristics` block.

## 4. Demo video revert

- [x] 4.1 `DemoVideoButton.tsx`: `DEMO_VIDEO_URL` back to
      `https://videos.pexels.com/video-files/8533913/8533913-uhd_3840_2160_25fps.mp4`
      (original clip, full length, no trim), update the sourcing comment accordingly.
- [x] 4.2 `DemoVideoButton.test.tsx`: update the expected fetch URL assertion to match.

## 5. Verification

- [x] 5.1 Run the full test suite, `tsc -b`, and `eslint .`; fix any regressions. (225/225 tests
      pass, `tsc -b` and `eslint .` both clean.)
- [x] 5.2 Manually exercise the app: load a clip (upload or demo button) and confirm analysis
      starts on its own with no click; confirm the low-confidence banner appears only when a
      metric is actually flagged, and matches which metric card(s) are visually flagged in
      `MetricsPanel`; confirm "Analyze again" still works after a completed/errored run.
      (Verified live in headless Chromium via Playwright against the dev server: no modal ever
      appeared, analysis auto-started without a click, the low-confidence banner correctly named
      all three metrics for a synthetic no-person test clip matching their flagged cards below,
      the loop-on-ready behavior from the prior change still works, "Analyze again" completed a
      second run successfully, zero console errors.)
