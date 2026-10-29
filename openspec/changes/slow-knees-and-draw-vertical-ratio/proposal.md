## Why

Two user-requested runner-tour tweaks (`strides-trn2.10`):

1. The knee-flexion stop plays at full speed, so the swing knee's fold to its peak bend passes in a
   fraction of a second at the legs camera's zoom. Landing and foot path already play slowed for the
   same reason.
2. Vertical ratio is hip bounce ÷ stride length (`strides-xki9`'s bounce reading cites both), but
   the figure draws only the bounce bracket, so the ratio a runner reads at the rhythm stop has no
   picture: the stride it divides by is nowhere on screen.

## What Changes

- The knees area (headed by knee flexion, with knee drive) plays at 0.4×, the rate landing and foot
  path use, in the tour and the wide summary, with the existing "Slow motion" note.
- New runner parameter `strideLength` (torso lengths per gait cycle), bound from vertical ratio as
  the stride it was computed over: the bounce reading's derived stride (`verticalOscillation /
  verticalRatio`, only on vertical ratio's own clip from the same hip fit), neutral otherwise. It
  moves no joint.
- A vertical-ratio focus draws the ratio's two inputs at one scale: the hip-bounce bracket and a
  horizontal stride bracket along the ground from the near foot's contact to where it lands next,
  labelled with vertical ratio's value over "bounce ÷ stride", the two brackets tagged "bounce" and
  "stride". It replaces the bounce's own bracket when both are in focus.
- New per-values side camera `strideSide` frames the figure and the whole stride.
- The tour's rhythm stop focuses vertical ratio too wherever it states it (secondary value), and
  takes the stride camera when the stride is measured; the summary's rhythm row does the same.

Presentation only: no heuristic, measurement or metric value changes.

## Capabilities

### Modified Capabilities

- `runner-tour`: knees rate; rhythm-stop focus and camera.
- `model-runner`: vertical ratio binds the stride; the stride drawing and camera.
- `results-summary`: the rhythm row's stride camera.

## Impact

`src/runner/{types,runnerParams,runnerAnnotations,camera,ModelRunner,introFlash,useRunnerIntro}.ts(x)`,
`src/results/focusAreaCamera.ts`, `src/results/tour/{tourPlan,RunnerTour}.ts(x)`,
`src/results/summary/ResultsSummary.tsx`, `src/guidance/compositeReadings.ts` (type widening only).
