## Context

See proposal.md for motivation. Relevant current state:

- `applyRobustness(samples, config: RobustnessConfig = DEFAULT_ROBUSTNESS_CONFIG)` already
  accepts a config parameter — `useVideoAnalysis.ts` calls it as `applyRobustness(sorted)`,
  never passing one, so it's always the default in practice today.
- `sampleClip(video, detector, durationSec, opts: SampleClipOptions)` already accepts
  `maxConsecutiveErrors`/`detectionTimeoutMs` in `opts` — `useVideoAnalysis.ts` only ever passes
  `{ onProgress, onPausedChange }`, so these two also always default today.
- `analysisDiagnostics`'s dev-only auto-log (this session) already established the pattern this
  change reuses: `import.meta.env.DEV`-gated, no UI, Vite dead-code-eliminates the whole branch
  from a production bundle.

## Goals / Non-Goals

**Goals:**
- One object represents "this run's sampling/robustness plane", swappable by an eval harness
  without touching application code.
- Zero behavior change with no override present — this is pure plumbing preparation, not a
  tuning change.
- No new dependencies, no changes to the already-correct `sampleClip.ts`/`interpolate.ts`/
  `confidenceFilter.ts` logic.

**Non-Goals:**
- The model-backend or math-config selection planes — explicitly deferred, per this session's
  triage.
- Building the actual eval harness/comparison tooling — this change only prepares the plane to
  be swappable; the harness that drives variants through it is separate, later work.
- A user-facing settings UI — the override is a development/tooling seam only.

## Decisions

**`SamplingRobustnessConfig` wraps `RobustnessConfig` as a nested field, rather than flattening
everything into one type.** `interpolate.ts`/`confidenceFilter.ts` already take a plain
`RobustnessConfig` and stay untouched; `useVideoAnalysis.ts` just unwraps
`config.robustness` when calling `applyRobustness`. Flattening would mean either changing
`RobustnessConfig`'s own shape (touching two files that don't need to change) or duplicating its
two fields at the top level (inviting the two copies to drift). Nesting is the smaller, more
honest diff.

**Override lives on `window`, not an env var or URL query param.** An env var would require
restarting the dev server per variant — far too slow for an eval loop that wants to try several
configs in one sitting. A URL query param is closer, but still requires a full navigation per
variant and string-encoding a whole config object into the URL. A `window`-scoped global that a
Playwright script sets via `page.evaluate()` immediately before triggering analysis (or a
developer sets by hand in devtools) needs no navigation and no encoding — exactly matched to
"run N trials against variant A, then N trials against variant B" in one browser session per
variant, without re-loading the page. Read once, at the top of the analysis run (inside
`start()`), not reactively — this is a one-shot tooling knob, not a live-updating setting.

**Global name and shape**: `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__: Partial<SamplingRobustnessConfig> | undefined`.
`Partial`, not the full shape — a harness varying just `maxGapSeconds` shouldn't have to restate
the other three fields; the resolved config is `{ ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG, ...override }`
(with `robustness` itself shallow-merged the same way, since it's the one nested field).

## Risks / Trade-offs

- [A `window` global is an easy-to-miss, loosely-typed integration point compared to a typed
  function argument] → Acceptable for a dev-only tooling seam with no production presence;
  `analysisDiagnostics`'s console-log override point is the same category of trade-off, already
  accepted this session.
- [Reading the override only once per run (not reactively) means changing it mid-run has no
  effect until the next run] → Intentional — matches how a harness actually wants to use this
  (set before starting a run, not adjust mid-flight).
