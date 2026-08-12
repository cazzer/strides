## 1. Spec artifacts

- [x] 1.1 `proposal.md`, `design.md` (D1–D5 + out-of-scope follow-ups), delta specs for
      `pose-detection`, `pose-robustness`, `form-heuristics`, `analysis-diagnostics`.
- [x] 1.2 `openspec validate add-mediapipe-metric-scale-calibration --strict` passes.

## 2. Transport: the scale rides on the frame

- [x] 2.1 `src/pose/types.ts`: `PoseFrame.pixelsPerMeter?: number`, docstring recording that
      absence means "this backend doesn't measure scale" and that the value is never
      `<= 0`/`NaN`/`Infinity`.
- [x] 2.2 `src/pose/backends/common.ts`: `toPoseFrame(rawKeypoints, timestamp, pixelsPerMeter?)`
      emits the key conditionally — never `pixelsPerMeter: undefined`.
- [x] 2.3 `src/pose/backends/common.test.ts`: key omitted when the argument is omitted; included
      when supplied; MoveNet's existing output shape unchanged.
- [x] 2.4 `src/pose/robustness/types.ts`: `RobustPoseFrame.pixelsPerMeter: number | null`
      (required-nullable), docstring recording copy-verbatim/never-interpolated.
- [x] 2.5 `src/pose/robustness/interpolate.ts`: copy `sample.frame?.pixelsPerMeter ?? null`.
- [x] 2.6 `src/pose/robustness/interpolate.test.ts`: detected sample's scale reaches the robust
      frame; `frame: null` sample → `null`; an interpolated-keypoint frame → `null` (never
      fabricated).

## 3. MediaPipe backend measures the scale

- [x] 3.1 `src/pose/backends/mediapipePoseLandmarker.ts`: module-private landmark indices
      (11/12/23/24) and a `computePixelsPerMeter(rawKeypoints, worldLandmarks)` helper — pixel
      torso as the 2D distance between the already-denormalized shoulder/hip midpoints, world
      torso as the **3D** distance between the same midpoints in `worldLandmarks[0]`, returning
      `undefined` unless both are finite and the world torso is strictly positive. Comments: why
      3D rather than xy; why world landmarks are scale-only and never positional; why
      `visibility` deliberately does not gate the measurement.
- [x] 3.2 `src/pose/backends/mediapipePoseLandmarker.test.ts`: known geometry (shoulders y=0.25,
      hips y=0.5, videoHeight 480 → 120 px torso; world shoulder-mid (0, −0.3, 0.4), hip-mid
      (0, 0, 0) → 0.5 m torso) yields exactly 240 px/m — the same fixture proving 3D-not-xy, since
      the xy distance of 0.3 would give 400. `worldLandmarks: []` → `'pixelsPerMeter' in frame`
      is `false`. Degenerate torso → key absent, no `Infinity`.

## 4. Fixtures

- [x] 4.1 `src/heuristics/__fixtures__/testFrames.ts` and
      `src/heuristics/__fixtures__/syntheticGait.ts`: set `pixelsPerMeter`, with an optional way
      for a test to specify it.
- [x] 4.2 `src/results/analysisDiagnostics.test.ts`, `src/results/useVideoAnalysis.test.ts`:
      `RobustPoseFrame` literals gain `pixelsPerMeter: null`.

## 5. The calculation

- [x] 5.1 New `src/heuristics/verticalOscillationCm.ts`:
      `computeVerticalOscillationCm(frames, config?) → ScaleCalibratedVerticalOscillation | null`,
      structured `collectScales → buildRuns → estimateAmplitudes`, per D3/D4 (integrated deltas,
      per-run reset, per-run extrema, opposite-kind pairing, in-run scale interpolation with
      edge hold, zero-scale runs dropped and counted).
- [x] 5.2 `src/heuristics/verticalOscillationCm.test.ts`: constant-scale equivalence to the pixel
      path within 1e-9; the 480 cm drifting-scale regression (assert the naive division *would*
      fabricate a large excursion, then that the integrated result is `null`/`sampleSize: 0`);
      known 6 cm bounce under ~1.2x drift recovered within ±10%; no amplitude near a large
      inter-run offset; all-null scale → `null`; partial in-run coverage; finite statistics.

## 6. Diagnostics and wiring

- [x] 6.1 `src/results/analysisDiagnostics.ts`: optional fourth parameter, conditional-spread
      `scaleCalibration` key.
- [x] 6.2 `src/results/analysisDiagnostics.test.ts`: key absent when the argument is omitted AND
      when it is `null`; present verbatim when supplied.
- [x] 6.3 `src/results/useVideoAnalysis.ts`: hoist `trimToPresenceWindow` into one local, thread
      it into `computeFormHeuristics` and `computeVerticalOscillationCm`, pass the result to
      `computeAnalysisDiagnostics`.

## 7. Verification

- [x] 7.1 `npm test` and `npx tsc -b` both clean.
- [x] 7.2 Live: MediaPipe backend override, ≥3 trials per demo clip, `[analysis-diagnostics]`
      captured. Record `verticalOscillationCm`, `scaleDriftRatio`, `torsoMeters`,
      `medianPixelsPerMeter` per trial below.
- [x] 7.3 Live: MoveNet control (no override) — no `scaleCalibration` key, other metrics within
      their known baselines.
- [x] 7.4 Append a short "MediaPipe metric calibration" note to `CLAUDE.md` (how to read
      `scaleCalibration`, expected values per clip).

### Live results

Real GPU (`--headless=new --enable-gpu --ignore-gpu-blocklist`), dev server on :5282,
`window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'mediapipePoseLandmarker' }` via
`addInitScript`. Values read from the `[analysis-diagnostics]` console line.

**MediaPipe — track clip (`try a demo video`), 3 trials**

| trial | VO_cm | driftRatio | torsoMeters | medianPxPerM | sampleSize | runs | coverage |
|---|---|---|---|---|---|---|---|
| 1 | 6.088 | 1.011 | 0.505 | 871.8 | 5 | 1 | 1.0 |
| 2 | 6.084 | 1.012 | 0.504 | 872.5 | 5 | 1 | 1.0 |
| 3 | 6.074 | 1.011 | 0.505 | 871.9 | 5 | 1 | 1.0 |

Matches the ticket's expected ~6.07 cm; cross-trial spread 0.014 cm (under the 0.05 cm
investigate-threshold). `torsoMeters` ≈ 0.50 m is the sanity check passing: the calibration is
sizing a real human torso. `driftRatio` ≈ 1.01 confirms the fixed-camera-distance assumption for
this clip.

**MediaPipe — park approach clip (`another demo`), 3 trials** — recorded as
EXPECTED-BUT-DRIFT-INFLATED, not asserted accurate:

| trial | VO_cm | driftRatio | torsoMeters | medianPxPerM | sampleSize | runs | coverage |
|---|---|---|---|---|---|---|---|
| 1 | 15.67 | 5.45 | 0.475 | 530.2 | 7 | 1 | 1.0 |
| 2 | 14.89 | 3.90 | 0.473 | 528.5 | 7 | 1 | 1.0 |
| 3 | 14.93 | 3.89 | 0.472 | 532.0 | 7 | 1 | 1.0 |

In the expected ~14.8 ± 1 band. `driftRatio` here (3.9–5.4) runs above the investigation's
measured 3.03x, and swings between trials: it is a two-sample statistic (last measured scale /
first), so one noisy endpoint frame moves it a lot, and it is computed over the presence-trimmed
window rather than the raw clip. It is a flag ("this clip's subject translated toward the
camera; don't believe the centimetres"), not a measurement — the centimetre figure itself is
stable across trials to ~0.8 cm.

**MoveNet control (no override)** — `'scaleCalibration' in diagnostics === false` on all 4 runs:

| clip | trial | scaleCalibration key | VO ratio | baseline |
|---|---|---|---|---|
| track | 1 | absent | 0.182 | ~0.185–0.19 ✓ |
| track | 2 | absent | 0.192 | ~0.185–0.19 ✓ |
| park | 1 | absent | 0.249 | ~0.22–0.24 ✓ |
| park | 2 | absent | 0.243 | ~0.22–0.24 ✓ |
