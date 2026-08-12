## Why

Every metric this pipeline reports is normalized by torso length in pixels, because pixels are
the only unit the pose keypoints come in — there has never been a way to say how many
centimeters a runner's pelvis actually bounces. That makes vertical oscillation impossible to
sanity-check against the outside world: consumer running watches and the sports-science
literature both report VO in centimeters (roughly 6–13 cm for recreational runners), and a
torso-length ratio has no principled conversion to that.

The MediaPipe Pose Landmarker backend already receives, and currently discards, exactly the
missing piece: `PoseLandmarkerResult.worldLandmarks` — the same 33-point topology expressed in
**meters**, hip-centered. Dividing the pixel torso length by the world torso length yields a
per-frame `pixelsPerMeter` scale, which converts a pixel displacement into a real one.

Two constraints make this non-trivial, and both are already measured (evidence in the epic #27
investigation, `test1-metric-calibration.json`):

1. **World landmarks are hip-centered — translation is removed.** They can be used for scale
   only, never for bounce directly: the hip is pinned at the origin by construction, so the
   quantity we want to measure is identically zero there.
2. **Dividing absolute pixel positions by a drifting scale fabricates bounce.** On a clip where
   the subject approaches the camera, the scale drifts by 3.03x, and naive
   `y_px(t) / s(t)` produced a *480 cm* excursion — two orders of magnitude wrong. The correct
   conversion integrates per-frame *deltas*, each divided by the scale local to that step.

## What Changes

- The MediaPipe backend computes a per-frame `pixelsPerMeter` from the **3D** world distance
  shoulder-mid→hip-mid against the same distance in denormalized pixels, and attaches it to the
  `PoseFrame` it already produces. Other backends attach nothing (the field is optional and
  simply absent), so the MoveNet path is byte-for-byte unchanged.
- The robustness layer copies that scale through verbatim onto `RobustPoseFrame`, never
  interpolating or extrapolating it — a fabricated scale would silently corrupt the very
  correction this change exists to make.
- A new sibling calculation converts the hip-y pixel series to meters by **integrated deltas**
  with per-run resets, and reports a median half-cycle amplitude in centimeters. The existing
  `computeVerticalOscillation` (torso-length ratio) is untouched.
- The result surfaces in the development-only `[analysis-diagnostics]` console export, as a
  `scaleCalibration` block that is **absent entirely** when the backend doesn't measure scale —
  no invented nulls on the MoveNet path.

Diagnostics-only by design: whether centimeters should replace or accompany the torso-length
ratio in the user-facing results UI is a separate product decision, deliberately not made here.

## Capabilities

### Modified Capabilities
- `pose-detection`: `PoseFrame` may now carry optional backend-provided per-frame metadata; the
  MediaPipe backend gains a documented metric-scale measurement.
- `pose-robustness`: per-frame metric scale passes through the robustness layer unmodified.
- `form-heuristics`: a scale-calibrated vertical-oscillation calculation in real centimeters,
  computed from integrated deltas, alongside (not replacing) the existing ratio metric.
- `analysis-diagnostics`: diagnostics accept an optional scale-calibration input and surface it
  only when measured.

## Impact

- `src/pose/types.ts`: `PoseFrame.pixelsPerMeter?: number`.
- `src/pose/backends/common.ts` (+ test): `toPoseFrame` takes an optional scale and emits the key
  only when it is a real measurement.
- `src/pose/backends/mediapipePoseLandmarker.ts` (+ test): computes the scale from
  `worldLandmarks`.
- `src/pose/robustness/types.ts`, `src/pose/robustness/interpolate.ts` (+ test):
  `RobustPoseFrame.pixelsPerMeter: number | null`, copied verbatim.
- New `src/heuristics/verticalOscillationCm.ts` (+ test): the integrated-delta calculation.
- `src/results/analysisDiagnostics.ts` (+ test): optional fourth input, conditionally-present key.
- `src/results/useVideoAnalysis.ts` (+ test): hoists the presence trim so the new calculation and
  `computeFormHeuristics` see the same frames, and threads the result into diagnostics.
- Test fixtures (`src/heuristics/__fixtures__/`) gain an optional way to set the new field.
- Out of scope, recorded as follow-up in `design.md`: approach-drift correction (the park clip's
  14.8 cm reading is drift-inflated and is documented as such, not tuned); surfacing centimeters
  in the results UI; composing this with the spectral amplitude estimator.
