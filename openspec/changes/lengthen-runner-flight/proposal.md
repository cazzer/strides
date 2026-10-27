## Why

The model runner's stance ran to 0.38 of a cycle, leaving each step a flight of 0.12 (about 80 ms
at 180 steps/min). The planted leg can absorb only `STANCE_DROP` (0.10 torso lengths) of the bounce
while its foot stays pinned and its knee forms no second knee-flexion peak, so every bounce beyond
that has to happen in flight. At a large measured bounce (pelvis bounce past about 0.2 torso
lengths) the hips moved half a bounce or more in one 30 fps frame and each step's highest drawn
frame aliased: the 0.3 bounce moved 2.28× as far per frame as a sinusoid of the same size (bead
strides-ps19.7, from the ps19.4 review).

## What Changes

- Stance shortens to 0.30 of a cycle (`GAIT_PHASES.stanceEnd` 0.38 → 0.30), so each step has a
  flight of 0.20. Mid-stance moves to halfway through stance (0.19 → 0.15) and the hips' flight
  peak to midway through flight (0.44 → 0.40), keeping the two a quarter cycle apart, so a small
  bounce is still a true sinusoid.
- The thigh peak's key phase moves from 0.85 to 0.78, so a still frame held on it still has the
  other foot planted.
- One illustrative swing-thigh key is added at the other leg's mid-stance (0.65), 0.6 of the way
  from the toe-off angle to the peak, so the swing foot clears the ground under the lowest hips and
  the thigh curve stays monotone from toe-off to its peak.
- Unchanged: `STANCE_DROP`, every bound parameter and its measure tolerance, the knee and foot key
  values, the swing-arc window, the pin's declared domain and the fallback bounds past it, the
  landing camera's phase window, and ModelRunner's API.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-runner`: ADDED requirements only. The runner's bounce is held to a per-frame smoothness
  bound at 30 fps, and every limb key phase falls while the other foot is planted.

## Impact

- `src/runner/gaitModel.ts` (phases, flight peak, swing-thigh key, doc comments),
  `src/runner/camera.ts` (landing-window comment: the 0.512 end-hold sink is now −0.045),
  `src/runner/gaitModel.test.ts` (smoothness bands, phase guards), two cadence-beat fixtures in
  `src/runner/ModelRunner.test.tsx`, and two bounce-only sandbox scenarios.
- No change under `src/results`, `runnerParams.ts` or `__fixtures__/measureModel.ts`.
