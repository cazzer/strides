## 1. Diagnostics aggregation

- [x] 1.1 New `src/results/analysisDiagnostics.ts`: define `AnalysisDiagnostics` (keypoint
      resolution counts per `KeypointName`, view diagnostics, sampling counts, per-metric
      confidence-input map) and `computeAnalysisDiagnostics(samples: PoseSample[], robustFrames:
      RobustPoseFrame[], heuristics: FormHeuristicsResult): AnalysisDiagnostics`.
- [x] 1.2 `src/results/analysisDiagnostics.test.ts`: cover keypoint-count aggregation, view
      diagnostics passthrough, sampling detected/missing counts, and per-metric field
      collection, including edge cases (empty samples, all-unrecoverable keypoints).

## 2. Wire into the analysis hook

- [x] 2.1 `src/results/types.ts`: add `diagnostics: AnalysisDiagnostics | null` to
      `VideoAnalysisState`.
- [x] 2.2 `src/results/useVideoAnalysis.ts`: compute diagnostics via
      `computeAnalysisDiagnostics` alongside `heuristics` when a run reaches `'ready'`; `null`
      in every other phase (matches `heuristics`'s own null-until-ready convention).
- [x] 2.3 Add a `useEffect` keyed on `phase`/`diagnostics` that, only when
      `import.meta.env.DEV` is true and `phase === 'ready'`, logs
      `console.log('[analysis-diagnostics]', JSON.stringify(diagnostics))` once per
      `'ready'` transition (mirror the existing loop-restart effect's shape in the same file).
- [x] 2.4 Update `useVideoAnalysis.test.ts` for the new `diagnostics` field on every state
      assertion, plus new tests: diagnostics populated on ready, null otherwise, console.log
      called with the expected prefix when `import.meta.env.DEV` is stubbed true, not called
      when stubbed false.

## 3. Verification

- [x] 3.1 `npx vitest run`, `npx tsc -b`, `npx eslint .` all clean. (268/268 tests pass.)
- [x] 3.2 Live-browser check via the existing Playwright harness: load a clip, wait for
      "Analysis complete", capture console output via `page.on('console', ...)`, confirm a
      `[analysis-diagnostics]` line appears and `JSON.parse()`s into an object with the expected
      shape (keypoints/view/sampling/metrics). Confirm building for production
      (`npx vite build` + serving `dist/`) shows no such log after analysis completes.
      (Both confirmed: dev build logs a valid, fully-shaped diagnostics object — 12 keypoints,
      all 7 metrics, view diagnostics present; production build via `vite build` + `vite
      preview` shows zero `[analysis-diagnostics]` output after the same flow.)
