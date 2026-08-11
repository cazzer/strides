## Why

Iterating on the pipeline's model and math planes is already low-friction: `HeuristicsConfig`
and the pose-detector backend registry both exist and just need a value swapped in. The
sampling/robustness plane — `RobustnessConfig` (`minKeypointConfidence`, `maxGapSeconds`) and
`sampleClip`'s `maxConsecutiveErrors`/`detectionTimeoutMs` — has the same problem in reverse:
the parameters already exist on `applyRobustness`/`sampleClip`'s signatures, but
`useVideoAnalysis.ts`, the one call site that orchestrates the whole pipeline, never passes
anything through, so every run silently uses the hardcoded defaults. There's no single object
to swap to try a different robustness/sampling variant, and the two knobs live in two
differently-shaped places (an interpolation-layer config object, and a sampling-layer options
bag).

## What Changes

- A new `SamplingRobustnessConfig` bundles the interpolation layer's existing `RobustnessConfig`
  together with `sampleClip`'s `maxConsecutiveErrors`/`detectionTimeoutMs`, as one object
  representing this whole plane — `interpolate.ts`/`confidenceFilter.ts` keep taking a plain
  `RobustnessConfig` unchanged; nothing about their own signatures changes.
- `useVideoAnalysis.ts` resolves one `SamplingRobustnessConfig` per analysis run and threads it
  into both `applyRobustness(sorted, config.robustness)` and
  `sampleClip(video, detector, duration, { ...opts, maxConsecutiveErrors:
  config.maxConsecutiveErrors, detectionTimeoutMs: config.detectionTimeoutMs })`, instead of
  letting both silently default.
- In development builds only, an optional override can be supplied via a
  `window`-scoped global (set by a Playwright-driven eval harness before the page's first
  analysis run, or manually in devtools) — the same `import.meta.env.DEV`-gated, no-UI pattern
  `analysisDiagnostics`'s auto-log already uses this session. Absent an override, behavior is
  unchanged from today (the existing defaults).

## Capabilities

### New Capabilities
- `sampling-robustness-config`: the sampling/robustness plane becomes a single, swappable
  configuration object actually used by the pipeline, with a development-only override point for
  eval/comparison tooling.

## Impact

- New `src/pose/robustness/samplingRobustnessConfig.ts` (+ test): the new type +
  `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`, no changes to `RobustnessConfig` itself.
- `src/results/useVideoAnalysis.ts`: resolves and threads the config through both call sites;
  reads the dev-only override if present.
- No changes to `sampleClip.ts`, `interpolate.ts`, or `confidenceFilter.ts` — all three are
  already correctly parameterized; this only stops the one call site from dropping the
  parameters.
- Out of scope (explicitly deferred, per this session's earlier assessment): the model-backend
  and math-config selection planes, and the actual eval harness/comparison tooling itself — this
  change only prepares the robustness/sampling plane to be swappable.
