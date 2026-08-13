## 1. OpenSpec change

- [x] 1.1 `openspec new change add-background-scale-pass`; write `proposal.md`, `design.md`
      (D1–D6), `tasks.md`, three spec deltas (`results-view` ADDED ×2 + MODIFIED ×1,
      `analysis-diagnostics` ADDED ×1, `pose-detection` ADDED ×1).
- [x] 1.2 `openspec validate add-background-scale-pass --strict` passes. Do NOT archive.

## 2. Config (D4)

- [x] 2.1 New `src/results/scalePassConfig.ts`: `ScalePassConfig { enabled: boolean }`,
      `DEFAULT_SCALE_PASS_CONFIG = { enabled: true }`,
      `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__` global declared in-module,
      `resolveScalePassConfig()` — pattern-clone of `samplingRobustnessConfig.ts`.
- [x] 2.2 New `src/results/scalePassConfig.test.ts`: default on; override honored in a dev
      build; override ignored outside a dev build (mirrors `samplingRobustnessConfig.test.ts`).

## 3. Detector (D2)

- [x] 3.1 New `src/pose/scalePassDetector.ts`: module-cached `getScalePassDetector()`, hardcoded
      `mediapipePoseLandmarker`, null-on-failure with retry, page-lifetime cache,
      `__disposeForTests()`.
- [x] 3.2 New `src/pose/scalePassDetector.test.ts` (mock `createDetector`): lazy; cached (one
      `createDetector` call across two gets); hardcoded backend even with
      `__STRIDES_POSE_BACKEND_OVERRIDE__` set; failure → null then retry.

## 4. Graft (D3)

- [x] 4.1 New `src/results/scalePassGraft.ts`: pure `graftScalePassResult(primary, scale)` with
      the provenance sentence composed onto the scale result's caveat. No changes under
      `src/heuristics/`.
- [x] 4.2 New `src/results/scalePassGraft.test.ts`: grafts only VO-cm; other 8 metrics + view
      reference-identical; primary not mutated; caveat composition with and without a scale
      caveat; calibration by reference; measured-but-unfittable case grafts the fit-failure
      caveat.

## 5. Orchestration (D1, D6)

- [x] 5.1 `src/results/types.ts`: `VideoAnalysisState.scalePass` (status machine + reason/error
      + diagnostics).
- [x] 5.2 `src/results/useVideoAnalysis.ts`: ready-setState decides pending/skipped;
      scale-pass effect (ref-guarded, runId-guarded, watchdog, same pipeline, graft);
      `scaleHandleRef` stopped by `abandonActiveRun`; loop-restart effect conditioned on the
      pass not being in flight; dev-only `[analysis-diagnostics:scale-pass]` emission; existing
      `[analysis-diagnostics]` emission byte-identical.
- [x] 5.3 `src/results/useVideoAnalysis.test.ts`: extend mocks for two sequential `sampleClip`
      calls per run; pending→running→done with grafted heuristics; scale-pass rejection →
      `'failed'` with primary untouched; watchdog timeout → `'failed'`; skip on primary
      calibration; skip on kill-switch off; reset() cancels the scale handle and discards a late
      resolution; loop=false during the pass and loop=true after done; console spy asserting
      exactly one primary line (payload unchanged) + one scale-pass line. Existing tests
      updated only where the loop now waits on the pass.

## 6. UI (D5)

- [x] 6.1 `src/results/MetricsPanel.tsx`: optional `scalePassInProgress?: boolean`; excluded
      entry for a null-value `verticalOscillationCm` renders the measuring hint while in
      progress.
- [x] 6.2 `src/results/ResultsView.tsx`: derive `scalePassInProgress` from
      `analysis.scalePass.status`.
- [x] 6.3 `src/results/MetricsPanel.test.tsx`: hint renders for null VO-cm when in progress;
      caveat renders otherwise; grafted result renders as a caveated card whose note contains
      the provenance sentence.

## 7. CLAUDE.md

- [x] 7.1 "Reading results": two-line contract (first line byte-identical primary;
      `'scaleCalibration' in` = primary-backend discriminator only; second line carries the
      scale pass). "Config overrides": add `__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`. The #36
      section's `'scaleCalibration' in diagnostics` sentence updated to the primary-only
      meaning. Surgical edits only.

## 8. Gates + live verification

- [x] 8.1 `npx vitest run` all green; `npm run build`; `npx eslint .`;
      `openspec validate add-background-scale-pass --strict`.
- [x] 8.2 Live matrix in the worktree (driver copied, not committed): default × {track, park}
      × 3 (first line baseline-consistent, scale-pass `'done'`, VO-cm ≈4.8/≈12.0, page text
      reflects the graft); kill-switch off × track ×1 (`'skipped'`/`'disabled'`, availability
      caveat shown); mediapipe-primary × track ×1 (first line has `scaleCalibration`,
      `'skipped'`/`'primary-scale'`). Record the full table; delete the driver copy before
      committing.
