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

## 8. Renderer review round 1

- [x] 8.1 No limb-shaped guides; the still frame holds the first keyed focus parameter's key phase; front views annotate the leg at its key phase
- [x] 8.2 `overrides.valueTween` interpolated by the loop (no React commits), ends exactly at `to`
- [x] 8.3 Live reduced-motion switch returns to the still frame; single loop controller; tests for media change, camera retarget, unmount, model cross-checks
- [x] 8.4 Far/unfocused opacity floors, 6 px focus stroke, arc wedge, forced-colours palette, ground at the foot floor, "shown approximately", legend only when dashes are in frame
- [x] 8.5 Gates and re-shot screenshots (390/1280, light/dark, reduced/normal, forced colours)

## 9. Renderer review round 2

- [x] 9.1 A still figure draws only the limb marks at its held phase; every mark while playing
- [x] 9.2 The held phase is taken on the side view's near leg in every camera
- [x] 9.3 Value tween progress is wall-clock and shared by drawing and cadence; zero duration is finished; overlap with a camera tween tested
- [x] 9.4 Requirement renamed "Reduced motion holds a still pose"; `footFloor` computed once; left labels get more gap

## 10. Intro beat (ps19.3)

- [x] 10.1 `src/runner/useRunnerIntro.ts`: `introOrder` (focus first via `paramForMetric`, then spec order), `introStepMs`, `introOverrides` per step (`valueTween` neutral → bound, `sources` flip, 500 ms `flash`), `setTimeout` sequencing, once-per-result registry, skip, reduced motion
- [x] 10.2 `ModelRunner` `intro` prop: "Skip" button beside Play/Pause while running (never under reduced motion), focus handed to Play/Pause when it goes away focused
- [x] 10.3 `useRunnerIntro.test.tsx`: order, exact end, neutrals fixed, continuity across steps, skip, reduced motion (on load and mid-intro), once per result, new result, StrictMode, commits O(steps), Skip button and focus
- [x] 10.4 Dev sandbox "Replay intro"; gates: lint, `tsc -b`, vitest (runner + full), `openspec validate --strict`, `vite build`

## 11. Intro review round 1

- [x] 11.1 String `resultKey` (run/session id); the hold starts only once the runner is seen (`onActiveChange`, `active`); plan snapshotted at step 0; `onDone`/`running` contract documented
- [x] 11.2 Pause skips the intro; tweening parameter's annotation hidden; flash at a fixed per-parameter point clear of label boxes (`introFlash.ts`); "Dashed: not applied yet"; 500 ms neutral hold; steps 450..1000 ms over 4.5 s; side-view lateral parameters folded into the final state; landing before foot strike; "Skip intro"
- [x] 11.3 Steps chained from actual starts in the timer callbacks; reduced-motion flip resumes; test-only registry reset; order memoized by joined ids
- [x] 11.4 Sandbox uses the tour's area order; re-shot at 390 light (hold, mid, end); gates

## 12. Intro review round 2

- [x] 12.1 Overrides hold every parameter at its snapshot value; `onActiveChange(false)` on unmount; `camera` required; no steps finishes at once
- [x] 12.2 Foot-strike and swing-arc flashes on the near ankle; lean flash end-aligned on the torso's back side; half-line clearance from labels, marks and guides; no flash blink under 150 ms
- [x] 12.3 D14 records the ~5 s total; re-shot at the foot-strike and torso steps; gates

## 13. Stance foot pinned to the ground (ps19.4)

- [x] 13.1 `gaitModel.ts`: `pelvisHeight(params)` puts the contact foot on y = 0; stance-low bounce keyed at the half-cycle phase (exact VO); stance IK with heel lift, knee cap, reach clamp and thigh cap; swing curves start from the stance toe-off; `GROUND_Y`
- [x] 13.2 `runnerAnnotations.ts`, `introFlash.ts`, `ModelRunner.tsx`: `footFloor` removed; ground and ground marks at y = 0; bounce bracket centred on `pelvisHeight`
- [x] 13.3 Tests: pin at neutral, contact at every corner, declared domain and landing −0.3 corners within 0.01, swing clearance, landing 0.7 fallback bound with every binding exact, still frames planted; isolation restated (shared vertical shift); MEASURE_PARAM tests and tolerances unchanged
- [x] 13.4 Sandbox big-overstride scenario; screenshots incl. the summary view; gates
