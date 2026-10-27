## Why

The runner-led results PRD (`docs/prd/runner-led-results.md`, "Why a model runner rather than a
replay of the footage") makes a wireframe runner built from the user's numbers the centre of the
results page. Only a model can turn to the front to show step width, unify metrics fused from
different clips, and loop without a seam. Every later runner ticket (renderer, intro, tour) needs
one contract underneath it: how the figure moves, which measurement drives which part of it, and
how the camera frames it. That contract has to carry the PRD's honesty rules, so it ships first,
pure and heavily tested.

## What Changes

- New pure, React-free module set `src/runner/`:
  - `gaitModel.ts`: a procedural, seamlessly looping gait cycle over the nineteen
    `COMMON_KEYPOINT_NAMES` joints, with fixed illustrative proportions.
  - `runnerParams.ts`: binds each degree of freedom to exactly one measured metric, or holds it at
    a documented neutral constant, and says per skeleton segment whether it is measured or neutral.
  - `camera.ts`: an orthographic camera (yaw, pitch, zoom, target), six presets, and continuous
    interpolation between any two cameras.
  - `types.ts`: the shared types.
- The honesty rules become spec: one metric per degree of freedom; neutral parts are identifiable so
  the renderer can draw them dashed; neutral constants are never a band midpoint or central value;
  no per-side or variability parameter; no "ideal" runner.

## Capabilities

### New Capabilities

- `model-runner`: the model runner's kinematics, metric binding and camera.

### Modified Capabilities

None.

## Impact

- New files only, under `src/runner/`. Nothing renders the runner yet.
- No measurement, threshold, heuristic or UI change. `src/heuristics/**` is imported for types only.
- No new dependency.
