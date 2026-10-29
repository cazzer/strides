## 1. Knees in slow motion

- [x] 1.1 `FOCUS_AREA_CAMERA.knees` at `SLOW_MOTION_RATE` (0.4); tests in `focusAreaCamera.test.ts`, `tourPlan.test.ts`, `RunnerTour.test.tsx`

## 2. Stride parameter

- [x] 2.1 `strideLength` in `RunnerParamId`, `verticalRatio` in `RunnerMetricId`; spec, binding via `bounceDerivation`, clamp rule
- [x] 2.2 Tables: annotation kind, key phase, segments, flash anchor, intro (no step), test tables
- [x] 2.3 Binding tests (`runnerParams.test.ts`)

## 3. Stride drawing and camera

- [x] 3.1 `strideLength` builder (bounce + stride brackets, label, tags); bounce annotation gives way
- [x] 3.2 Tags rendered in `ModelRunner`; vertical ratio printed at band precision
- [x] 3.3 `strideCamera` / `strideSide`; ModelRunner frames it on the values
- [x] 3.4 Readback tests (`runnerAnnotations.test.ts`, `camera.test.ts`, `ModelRunner.test.tsx`)

## 4. Focus and camera wiring

- [x] 4.1 `stopFocusMetrics`, `stopView`, `runnerViewFor`; tour and summary use them
- [x] 4.2 Full vitest, tsc, lint
- [x] 4.3 Live check at 1280×800 and 390×844 (demo, side-landscape, side-portrait)
