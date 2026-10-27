## 1. Types

- [x] 1.1 `src/runner/types.ts`: `Vec3`, `Joint3D`, `RunnerParamId`, `RunnerParams`, `RunnerMetricId`, `BoundRunnerParam(s)`, `CameraPreset`, `CameraState`, `ProjectedJoint`, `SkeletonEdge`

## 2. Gait model

- [x] 2.1 `src/runner/gaitModel.ts`: illustrative proportions, `MODEL_TORSO_LENGTH_CM`, `PELVIS_HEIGHT`, `GAIT_PHASES`, periodic cosine-eased keyframes, contact solve, leg tilt and swing arc, arms, `poseAt`, `cyclesPerSecond`
- [x] 2.2 `gaitModel.test.ts`: joint order and finiteness at every range corner, seamless loop and phase wrap, continuity, constant segment lengths, mirrored half-cycle, neutral runner on the ground
- [x] 2.3 `gaitModel.test.ts`: per binding, measuring the model returns the bound value and rises with it, and joints outside the allowed set are bit-identical; always-exact bindings hold at the range corners; swing arc exact at any step width; documented contact and thigh-peak conflicts

## 3. Parameter binding

- [x] 3.1 `src/runner/runnerParams.ts`: `RUNNER_PARAM_SPECS`, `NEUTRAL_RUNNER_PARAMS`, `bindRunnerParams` (tier function defaulting to `metricTier`), `runnerParamValues`, `paramForMetric`, `RUNNER_PARAM_SEGMENTS`, `segmentSource`
- [x] 3.2 `runnerParams.test.ts`: measured, null, excluded and caveated binds; the centimetre fallback; clamping; `verticalRatio`/`stepWidthCm` inert; one metric per parameter; neutrals clear of every band centre in `METRIC_GUIDANCE`; segment sources

## 4. Camera

- [x] 4.1 `src/runner/camera.ts`: orthographic projection, `CAMERA_PRESETS`, `CAMERA_FRAME_HALF_HEIGHT`, `resolveCamera`, `projectPoint`, `projectPose`, `interpolateCamera`
- [x] 4.2 `camera.test.ts`: side and front projection, target and zoom, pitch, preset framing, interpolation endpoints, yaw wrap, geometric zoom, continuity for every preset pair

## 5. Review round 1

- [x] 5.1 `realizeParams`: contact conflicts resolved by precedence (measured beats neutral; landing, foot strike, thigh peak); `bindRunnerParams` sets every `value` to what is drawn, `clamped` on a measured parameter that gave way; invariant and reviewer cases tested; convex-mix tween test
- [x] 5.2 Contact knee bend capped at the mid-stance key (30°); peak metrics measured in tests with the heuristics' own extrema finder and median
- [x] 5.3 Non-tautological seam tests at phase 1 and at the right leg's wrap (0.5)
- [x] 5.4 Camera: test title fixed, yaw normalised to [0, 360), presets frozen; per-binding moved-joint families asserted

## 6. Gates

- [x] 6.1 `npm run lint`, `npx tsc -b`, `npx vitest run src/runner`, and the full `npx vitest run`
- [x] 6.2 `openspec validate add-model-runner --strict`

## 7. Renderer (ps19.2)

- [x] 7.1 `runnerScene.ts` + tests: segment/joint styles (agrees with `segmentSource`), effective sources, focus params, draw order, text alternative, label layout, timing constants
- [x] 7.2 `runnerAnnotations.ts` + tests: kinds, units, labels from `metricValue` (clamp note), exact arc sweeps and bracket/offset lengths, kind filter
- [x] 7.3 `usePrefersReducedMotion.ts`; `formatGuidedValue` parameter widened to `Pick<MetricResult, 'metric' | 'value' | 'unit'>` (type only)
- [x] 7.4 `ModelRunner.tsx` + tests: dashes, focus annotations, 30 fps cap without React renders, hidden/offscreen stop, camera tween vs cut, persistent pause, reduced motion, StrictMode, overrides seam, a11y
- [x] 7.5 Dev sandbox `src/runner/dev/sandbox.html` screenshotted at 390/1280 px, light/dark, reduced/normal motion; absent from `vite build`
- [x] 7.6 Gates: lint, `tsc -b`, vitest (runner + full), `openspec validate --strict`, `vite build`
