## Context

See proposal.md for motivation. Relevant current state:

- `useVideoAnalysis.ts`'s `start()` already has, in scope, the sorted `PoseSample[]` (before
  `applyRobustness`), the resulting `RobustPoseFrame[]`, and the `FormHeuristicsResult` from
  `computeFormHeuristics` — everything a diagnostics aggregation needs already exists in one
  place, in memory, at the point `phase` is set to `'ready'`.
- `RobustPoseFrame.keypoints` is always exactly 12 entries (`COMMON_KEYPOINT_NAMES` order), each
  with a `status: 'detected' | 'interpolated' | 'unrecoverable'` — the raw material for
  per-keypoint resolution stats.
- `FormHeuristicsResult.view` already carries `view`, `confidence`, and a `diagnostics` object
  (`bilateralSpreadRatio`, `sagittalExcursionRatio`, `frameCoverage`) — nothing new to compute,
  just surface.
- Every `MetricResult` (all 7 metrics) already carries `value`, `confidence`, `viewFit`,
  `frameCoverage`, `interpolatedFraction`, `sampleSize`, `caveat` — again, nothing new to
  compute.
- Vite's `import.meta.env.DEV` is `true` under `vite`/`vite dev` and `false` in a `vite build`
  production bundle; referencing it lets a bundler dead-code-eliminate the gated branch entirely
  from production output, not just skip it at runtime.

## Goals / Non-Goals

**Goals:**
- Make a completed run's confidence-relevant internals inspectable as one JSON blob, without
  reading rendered UI text.
- Zero footprint in production: no new network calls, no new UI a real user sees, no bundle-size
  cost that survives tree-shaking.
- No changes to the sampling/robustness/heuristics computation itself — this is a read-only
  aggregation over their existing outputs.

**Non-Goals:**
- Building a UI for browsing diagnostics (the consumer is browser automation reading console
  output, not a human clicking through a panel).
- Persisting diagnostics anywhere (no localStorage, no export-to-file) — out of scope until a
  concrete need for that emerges.
- Changing any metric's computed confidence/value based on what diagnostics reveals — this
  change only makes existing behavior visible, it doesn't alter it.

## Decisions

**Diagnostics computed by a pure function in a new `analysisDiagnostics.ts`, not inlined into
`useVideoAnalysis.ts`.** Matches this codebase's established pattern (`metricConfidence.ts`,
every `heuristics/*.ts` module) of keeping derivation logic in small, independently testable
pure functions, with hooks/components composing them rather than computing directly.

**Auto-log via a `useEffect` keyed on `phase`, mirroring the existing loop-restart effect
already in `useVideoAnalysis.ts`.** Same shape as the existing "once `phase` becomes `'ready'`,
do X" effect (which restarts the video loop) — this one instead calls
`console.log('[analysis-diagnostics]', JSON.stringify(diagnostics))` when
`import.meta.env.DEV` is true. Reusing an established pattern in this exact file rather than
introducing a new one.

**No button, no manual trigger — automatic on every `'ready'` transition.** The proposal's
explicit design goal is driving this through browser automation across a batch of clips; a
manual click step would mean scripting a click for every clip instead of just waiting for
"Analysis complete" and reading console output, which is strictly worse for the stated use case.
A human wanting to eyeball it can already open devtools in a dev build — no extra affordance
needed for that secondary case.

**Single `console.log` call with a JSON string, not `console.table`/multiple calls/pretty
formatting.** A single greppable, JSON-parseable line is the easiest thing for a Playwright
`page.on('console', ...)` handler (already the pattern used throughout this session's manual
verification scripts) to capture and `JSON.parse()` reliably. A fixed, distinctive prefix
(`[analysis-diagnostics]`) makes it trivial to filter out of other console noise.

## Risks / Trade-offs

- [`import.meta.env.DEV` gating relies on the build tool, not a runtime check — if this code
  were ever server-rendered or evaluated somewhere Vite's define doesn't apply, the gate could
  behave differently] → Not a real risk in this app: it's a pure client-side Vite SPA with no
  SSR anywhere in the pipeline.
- [Diagnostics could grow to include something sensitive if the pipeline is extended later] →
  Not applicable today (all inputs are already-computed pose/geometry numbers, nothing
  user-identifying), but worth a second look if this object's shape grows significantly later.
