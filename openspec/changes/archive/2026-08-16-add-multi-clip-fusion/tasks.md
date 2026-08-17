## 1. Extract the pipeline (foundation — land and verify alone first)

- [x] 1.1 `src/results/runClipAnalysisPipeline.ts`: extract sort → `applyRobustness` →
      `trimToPresenceWindow` → `computeFormHeuristics` → `computeAnalysisDiagnostics` into
      `runClipAnalysisPipeline(samples, samplingRobustnessConfig)`.
- [x] 1.2 `src/results/useVideoAnalysis.ts`: replace both inline pipeline bodies (primary IIFE,
      scale-pass effect) with calls to `runClipAnalysisPipeline`. No ref/effect/state-shape
      changes.
- [x] 1.3 Run the full pre-existing test suite unmodified; confirm zero failures before touching
      anything else.
- [x] 1.4 `src/results/runClipAnalysisPipeline.test.ts`: extracted function in isolation, mocked
      dependencies, call order/argument shape.

## 2. Fusion layer (independent of the rest)

- [x] 2.1 `src/results/fuseHeuristics.ts`: `fusionProvenanceCaveat`, `fuseFormHeuristicsResults`.
- [x] 2.2 `src/results/fuseHeuristics.test.ts`: N=1 reference identity (`toBe`), throws on `[]`,
      2-input split-winner case, `view` merge independent of metric confidence,
      `verticalOscillation.fit`/`verticalOscillationCm.calibration` carried by reference,
      provenance caveat present at N>1 / absent at N=1 / correctly space-joined, 3+ clip
      non-{0,1} winner, tie-break picks earlier index, a metric resolving on only one of N clips
      surfaces that clip's value.

## 3. Pure multi-clip combinators (no React)

- [x] 3.1 `src/results/multiClipAnalysis.ts`: `ClipSession`, `computeAggregateAnalysisState`,
      `nextActiveClipIndex`.
- [x] 3.2 `src/results/multiClipAnalysis.test.ts`: phase/scalePass/progress/error combinators over
      hand-built fixtures (all-idle, one-error, mixed-phase, all-ready);
      `nextActiveClipIndex` advancing on terminal-phase and on clip removal.

## 4. `ClipSlot`

- [x] 4.1 `src/results/ClipSlot.tsx`: mounts `useVideoSource()` + `useVideoAnalysis()` unmodified;
      one mount effect to `load()` a pending source; one effect to report `{clipId, videoSource,
      analysis}` via a stabilized callback; today's video-column JSX moved here; queued-clip hint;
      remove button.
- [x] 4.2 Verify N=1 behavior against a representative subset of `useVideoAnalysis.test.ts`'s
      scenarios mounted through `ClipSlot`.

## 5. Session orchestration

- [x] 5.1 `src/results/MultiClipVideoSession.tsx`: clip id/pending-load/clip-state maps, one
      `ClipSlot` per id, real detector to `activeClipIndex` only, `computeAggregateAnalysisState`,
      `nextActiveClipIndex` recomputed on every clips-array change, existing two-column layout,
      unmodified `ResultsView` fed the aggregate.
- [x] 5.2 `src/video/FileUpload.tsx`: `multiple` on the input, one `onSelected` call per file;
      signature unchanged.
- [x] 5.3 `src/App.tsx`: shrink to header + `<MultiClipVideoSession>`; move
      `handleTryAgain`/`handleChooseDifferentVideo` down.
- [x] 5.4 Concurrency regression test: mount two `ClipSlot`s, assert only one ever receives a
      non-null `detector` prop at a time.
- [x] 5.5 Verify N=1 end-to-end before testing N=2.

## 6. Verification

- [x] 6.1 `tsc -b`, `vitest run`, `eslint .` all clean (one pre-existing, unrelated failure in
      `VideoInputPanel.test.tsx` confirmed via `git stash` to predate this change).
- [x] 6.2 Live-browser N=1 regression (real GPU — `ANGLE Metal Renderer: Apple M4 Pro`, confirmed
      via `WEBGL_debug_renderer_info`): side-view demo clip, reached "Analysis complete", 75
      detected frames / view confidence 0.77 (matches CLAUDE.md's documented baseline range), no
      "Remove clip" button rendered for a lone clip.
- [x] 6.3 Live-browser N=2 (side-view demo + front-view `park-approach.mp4`, real GPU): found and
      fixed a real StrictMode/object-URL race (design.md D7) that broke the second clip's video
      decode; after the fix, both clips analyzed end to end, clip 2 stayed queued (no detector,
      "Queued — waiting for another clip to finish analyzing…") until clip 1's ENTIRE pipeline
      (primary + scale pass) reached a terminal state, and the rendered `MetricsPanel` showed
      every side-view-primary metric attributed to clip 1 ("Combined from clip 1 of 2") and
      `armSwingSymmetry` (front-view-primary) attributed to clip 2 ("Combined from clip 2 of 2") —
      the ticket's per-metric-fusion acceptance criterion, confirmed live.

## 7. OpenSpec

- [x] 7.1 `proposal.md`, `design.md`, `tasks.md` (this file).
- [x] 7.2 Spec delta for the new `multi-clip-analysis` capability.
- [x] 7.3 `openspec validate add-multi-clip-fusion --strict`.
