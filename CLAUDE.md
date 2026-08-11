# Strides — notes for Claude sessions working in this repo

Browser-only React/TypeScript app: webcam/upload/demo video → MoveNet pose detection (TF.js,
WebGL) → running-form heuristics → results UI. No backend.

## Spec-driven changes: openspec

This repo uses [openspec](openspec/) for anything beyond a trivial fix. Convention established
across this project's history:

```
openspec new change "<kebab-case-name>"
# write proposal.md, specs/<capability>/spec.md (delta), design.md, tasks.md
openspec validate <name> --strict
# implement against tasks.md, checking items off as you go
openspec archive <name> --yes   # folds the delta into openspec/specs/, do this once shipped
```

- `openspec/specs/` is the current, authoritative behavior contract per capability.
- `openspec/changes/` holds in-flight change proposals; `openspec/changes/archive/` holds
  completed ones. **Archive promptly after a change ships and is verified** — letting several
  changes pile up unarchived means `openspec/specs/` drifts out of sync with what's actually in
  the codebase (this happened once this session; six changes had to be archived in a batch to
  catch the main spec back up before a later change could reference what they'd added).
- If a change removes every requirement from a capability, delete that capability's spec file
  entirely rather than archiving to an empty stub — `openspec validate` rejects a spec with zero
  requirements, and an empty file doesn't mean anything anyway.
- MODIFIED/REMOVED requirement deltas must reuse the **exact existing requirement/scenario
  title text** — the archive step matches by name, not content, and silently drops anything it
  can't match. If a requirement's behavior fully reverses (not just changes), it's usually
  cleaner to REMOVE the old one (with Reason/Migration) and ADD a new one under a fresh name,
  rather than fighting the validator over a MODIFIED block that no longer resembles the
  original.

## Live-browser verification harness

Type checking and unit tests verify code correctness, not that a change actually works end to
end in a browser. This repo's pose-detection pipeline especially needs a real run — unit tests
mock the detector — so verify UI/pipeline changes live before calling them done.

**Use headless Chromium via Playwright, with real GPU acceleration — not SwiftShader.**

```js
import { chromium } from 'playwright'
const browser = await chromium.launch({
  args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist'],
})
```

Do **not** use `--use-angle=swiftshader --enable-unsafe-swiftshader` — that forces software
rendering, which was slow enough this session to sometimes sample only 1 detection frame across
an entire ~9s clip (a one-time cold-start fluke aside, steady-state it undercounts badly).
`--headless=new --enable-gpu --ignore-gpu-blocklist` gets real hardware acceleration (verified
via `WEBGL_debug_renderer_info`: `ANGLE Metal Renderer` on Apple Silicon, not
`SwiftShader Device`) and is dramatically faster and more representative of what a real user's
browser does.

**Driving the app:**
```bash
npm run dev -- --port 5173 --strictPort &
# poll: curl -sf http://localhost:5173
```
- `page.getByRole('button', { name: /try a demo video/i }).click()` loads a fixed reference
  clip (`src/video/DemoVideoButton.tsx`) — the standard clip for before/after comparisons.
  Alternative: Upload tab + `input[type=file]` + `setInputFiles(path)` for a different clip.
- Analysis starts **automatically** once the clip is ready and the detector has loaded — no
  button click needed. Wait for `page.getByText(/analyzing|processing results/i)` then
  `page.getByText(/analysis complete/i)` (the latter can take 10-90s depending on clip
  length/resolution and whether the detector is cold).

**Reading results — `analysisDiagnostics`, not screen-scraped card text:**

In development builds only, `useVideoAnalysis` auto-logs a single console line
`[analysis-diagnostics] {...}` the moment a run reaches `phase: 'ready'` — a JSON object with
per-keypoint detected/interpolated/unrecoverable counts, raw view-detection diagnostics,
sampling detected/missing counts, and every metric's `value`/`confidence`/`viewFit`/
`frameCoverage`/`caveat` in one place (`src/results/analysisDiagnostics.ts`). Capture it via
`page.on('console', ...)`, find the line by its prefix, `JSON.parse()` the rest. This never logs
in a production build (`import.meta.env.DEV`-gated) — don't try to read it from a `vite build`
output.

**Config overrides for comparing pipeline variants**, dev-only, read once per run:
- `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` — partial
  `SamplingRobustnessConfig` (`src/results/samplingRobustnessConfig.ts`): keypoint-confidence
  filtering, interpolation gap tolerance, detection error tolerance, per-frame timeout.
- Model-backend selection and math (`HeuristicsConfig`) selection don't have an override point
  yet — deferred, see "Backlog" below.
- **Set overrides with `page.addInitScript()`, not `page.evaluate()`.** Auto-analyze can start
  before an `evaluate()` call after `goto()` lands; `addInitScript()` guarantees the global
  exists before any page script runs, including before React mounts.

```js
await page.addInitScript((override) => {
  window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = override
}, { robustness: { minKeypointConfidence: 0.9 } })
await page.goto('http://localhost:5173')
// ...drive the demo clip, capture [analysis-diagnostics] as above
```

**Determinism caveat**: this pipeline is not bit-exact run-to-run even with identical input and
config — GPU float non-associativity and minor frame-timing jitter produce small variance (e.g.
74 vs. 75 detected frames across otherwise-identical trials, observed this session). For a real
before/after comparison, run a few trials per variant and compare medians/ranges, not single
runs.

## Backlog (assessed, not yet built)

Two more iteration planes were scoped but deferred as of 2026-08-11 — same "bundle into one
config, thread it through, dev-only override" pattern as the sampling/robustness plane above:
- **Model/detection**: `src/pose/detector.ts` already has a backend registry
  (`createDetector({ backend })`) — only `'movenet'` is wired up, and `movenet.ts` hardcodes
  `SINGLEPOSE_LIGHTNING`. Needs the model/variant choice exposed as a runtime-selectable value,
  not a second backend implementation (the registry already supports adding one later).
- **Math/heuristics**: `computeFormHeuristics` already takes a `HeuristicsConfig` — threshold
  iteration is free today, just needs the same override-point treatment for a harness to swap
  it without a code edit.

Also flagged, not yet scoped: input preprocessing (resize/crop before detection — the actual
root cause of this session's low-confidence demo-clip investigation, a 4K frame with the subject
too small/distant after downscaling to the model's fixed input size) doesn't have a pluggable
stage at all yet; and the eval harness/comparison tooling itself (multi-trial, labeled,
diffable) that would actually drive variants through these config planes hasn't been built —
this doc covers how to do it by hand, not a scripted harness.
