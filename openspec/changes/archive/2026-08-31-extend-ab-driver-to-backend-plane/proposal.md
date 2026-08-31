# Extend the A/B driver to the pose-backend override plane

## Why

`scripts/ab-person-selection.mjs` (#53) is the repo's one supported way to run a multi-trial,
labelled, diffable A/B against the real pipeline. It exposes exactly one config plane:
`window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__`.

The two A/Bs `strides-b0y` flagged for re-measurement under the fresh-process regime — the
tracking-crop revival (2026-08-13) and the person-of-interest cost (2026-08-15) — both live on
`window.__STRIDES_POSE_BACKEND_OVERRIDE__` instead. Neither can be expressed with the driver as it
stands, so both would be re-run by a hand-rolled driver. That is exactly what #53 built this
harness to stop: hand-written one-offs come out mutually incomparable, and every one of them has to
re-derive the dev-server port, the identity guard, the renderer guard and the fresh-process
default from scratch.

## What Changes

- A second override plane on the command line: `--backend-arm <label>=<json>`, assigning a partial
  `PoseDetectorConfig` (`src/pose/poseBackendConfig.ts`) to
  `window.__STRIDES_POSE_BACKEND_OVERRIDE__` via `addInitScript`, alongside the existing sampling
  override.
- Arms are keyed by **label**. A label may carry a sampling override, a backend override, or both;
  an arm named on only one plane gets `{}` on the other. `--arm` keeps its exact present meaning.
- Validation is recursive and schema-driven rather than hand-unrolled two levels deep. The backend
  plane needs **three** levels (`personOfInterest.continuityGate.enabled`), which the current
  two-level loop structurally cannot check.
- The report header stamps backend arms next to the sampling arms, and `--json` records both.

## Impact

- `scripts/ab-person-selection.mjs` — the only file that changes.
- No `src/` change, no behaviour change in the app. This is measurement tooling: it asserts nothing
  and is not wired into CI.
- Unblocks `strides-09k`.

## Non-goals

- The scale-pass plane (`__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`) and the heuristics plane. Neither
  is needed by the two pending re-runs, and adding an unexercised plane is how a guard rots.
