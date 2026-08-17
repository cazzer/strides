## Why

A running form can be filmed from more than one angle in one session (side view for
trunkLean/kneeFlexion, front view for armSwingSymmetry) — today's pipeline only ever analyzes one
clip. Every `MetricResult` already carries a `confidence`/`viewFit`, so the highest-confidence
value per metric across N clips is a well-defined merge with no new measurement concept: this
generalizes `scalePassGraft.ts`'s existing hardcoded 2-input, 1-field graft to N inputs and all
nine metric keys.

## What Changes

- **New `src/results/runClipAnalysisPipeline.ts`**: mechanical extraction of the inline
  sort → `applyRobustness` → `trimToPresenceWindow` → `computeFormHeuristics` →
  `computeAnalysisDiagnostics` pipeline body, currently duplicated in `useVideoAnalysis.ts`'s
  `start()` IIFE and its scale-pass effect, into one pure function both call. Zero behavior
  change — verified by running the full pre-existing `useVideoAnalysis.test.ts` suite unmodified
  against the extracted call sites.
- **New `src/results/fuseHeuristics.ts`**: `fuseFormHeuristicsResults(results: FormHeuristicsResult[])`
  picks, per metric key, the whole winning `MetricResult` object by highest `confidence` (never a
  scalar-field franken-merge, so `verticalOscillation.fit`/`verticalOscillationCm.calibration`
  travel with the winning object for free) and appends a provenance caveat naming the source clip.
  `view` gets its own highest-confidence pick, no caveat (it has no `caveat` field). N=1 returns
  its input by reference — the load-bearing case for the single-clip regression proof.
- **New `src/results/multiClipAnalysis.ts`**: pure combinators over a `ClipSession[]` —
  `computeAggregateAnalysisState` (phase/progress/error/scalePass-status aggregation, fused
  `heuristics` once every clip is `'ready'`) and `nextActiveClipIndex` (advances past any clip
  whose primary run AND scale pass have both reached a terminal state).
- **New `src/results/ClipSlot.tsx`**: mounts one unmodified `useVideoSource()` +
  `useVideoAnalysis()` pair per clip id. `useVideoSource.ts`/`useVideoAnalysis.ts` internals are
  untouched — multi-clip support is composition (N mounted instances), not a rewrite of either
  hook's ref/effect/state shape, because React's rules of hooks make a variable-count-of-effects
  rewrite far riskier than mounting N copies of a hook pair that already works. Loads a
  pre-selected clip (`pendingLoad`) one microtask after mount, not synchronously — live two-clip
  verification found that calling `videoSource.load()` synchronously from a mount-time effect
  races React StrictMode's dev-only double-invoke against `useVideoSource`'s own (untouched)
  unmount-cleanup effect, corrupting the second clip's video every time; see design.md D7.
- **New `src/results/MultiClipVideoSession.tsx`**: owns the clip id list and per-clip state,
  renders one `ClipSlot` per clip, passes the shared `PoseDetector` to exactly one active clip at
  a time (the concurrency mitigation below), computes the aggregate via
  `computeAggregateAnalysisState`, and renders the existing two-column layout with the unmodified
  `ResultsView` fed the fused result.
- **`src/video/FileUpload.tsx`**: additive — `multiple` on the file input, one `onSelected` call
  per selected file. Signature unchanged.
- **`src/App.tsx`**: shrinks to header + `<MultiClipVideoSession>`; the "try again"/"choose
  different video" focus-management logic moves down into the new component, which now owns the
  state it operates on.

## Concurrency finding (not in the original ticket)

The pose detector is a shared singleton (`usePoseDetector.ts`) reused across every clip in a
session. Two backends carry mutable cross-frame tracking state that outlives a single call:
MoveNet's tracking crop (`movenet.ts` — `lastBoundingBox`/`consecutiveLowConfidence`/
`lastSeenTime`, module-level `let`s, i.e. shared across every detector instance the module ever
creates) and MediaPipe's `PoseLandmarker` in `runningMode: 'VIDEO'` (`scalePassDetector.ts`,
strictly-increasing-timestamp contract). If two clips' pipelines ran concurrently against this one
shared detector, one clip's tracked box (or MediaPipe's internal tracking) could silently leak
into the other clip's frames — the existing backward-timestamp "new run" reset never fires for two
different videos advancing forward concurrently, so this is a real, silent correctness gap, not a
hypothetical one.

**Mitigation**: serialize clip analysis. `MultiClipVideoSession` hands a non-null `detector` prop
to exactly one `ClipSlot` at a time; every other slot gets `null` (which `useVideoAnalysis`
already treats as "don't auto-start" — no new gating mechanism needed there).
`nextActiveClipIndex` only advances past a clip once BOTH its primary run and its background scale
pass have reached a terminal state, so the scale pass's own MediaPipe detector (a *different*,
scale-pass-dedicated singleton, same sharing hazard) is covered by the identical rule.

## What Does NOT Change

- `src/results/MetricsPanel.tsx`, `src/results/ResultsView.tsx`, `src/results/metricConfidence.ts`,
  `src/heuristics/index.ts`, any individual metric module, `src/video/VideoInputPanel.tsx`,
  `src/video/useVideoSource.ts`, `src/video/types.ts` — all already fusion-agnostic (one
  `FormHeuristicsResult` in, no provenance awareness needed).
- `useVideoAnalysis.ts`'s refs, effects, and state shape — the only change there is calling the
  extracted `runClipAnalysisPipeline` instead of the inline body.

## Impact

- Affected specs: a new `multi-clip-analysis` capability (ADDED). `results-view`'s existing
  requirements describe per-clip pipeline behavior that stays true unchanged (each `ClipSlot`
  still runs the same `useVideoAnalysis` lifecycle) — no delta needed there.
- Affected code: see "What Changes" above, plus `fuseHeuristics.test.ts`,
  `multiClipAnalysis.test.ts`, `runClipAnalysisPipeline.test.ts`, and a concurrency regression test
  asserting only one `ClipSlot` ever receives a non-null `detector` at a time.
- Known follow-up, not this ticket: `stepWidth`/`stepWidthCm` (#45/#46) will need one more line
  each in `fuseFormHeuristicsResults`'s explicit per-field picks when they land.
