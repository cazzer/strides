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

## 5. Gates

- [x] 5.1 `npm run lint`, `npx tsc -b`, `npx vitest run src/runner`, and the full `npx vitest run`
- [x] 5.2 `openspec validate add-model-runner --strict`
