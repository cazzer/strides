## Why

`armSwingAmplitude` is the peak-to-peak vertical travel of the wrist relative to the shoulder, in
torso lengths (`strides-eiil.1`–`.3`). Two things undersell that:

- The tour stop and the summary row label it plain "Arm swing", which reads as the whole
  fore-and-aft swing. The value says nothing about how far the arm travels forward or back.
- The model runner swings its rigid bent arm about a 48° shoulder→wrist centre. At the neutral
  0.3 the upper arm runs −3°…+23° from vertical and never passes behind the trunk line; even at a
  side reading (0.51) it reaches only −13° back against +33° forward, so the arm pumps in front of
  the chest. Real bent-arm running carries the elbow behind the
  trunk on the backswing (upper arm roughly −35°…+25° from vertical, wrist travel ≈ 0.48 torso).

## What Changes

- `SHORT_METRIC_LABELS.armSwingAmplitude`: `Arm swing` → `Arm swing (wrist up-and-down)`. The tour's
  arms stop label and the summary's arms row both read it. `METRIC_LABELS.armSwingAmplitude`
  (classic table, guided cards, "Also:" lists, the camera-coverage notice): `Arm swing amplitude` →
  `Arm swing amplitude (wrist up-and-down)`. The metric description adds that the forward-and-back
  sweep isn't measured.
- `MODEL_PROPORTIONS.armCentreDeg`: 48° → 33°, so the upper arm hangs about 5° behind vertical and
  the swing carries the elbow behind the trunk.
- `armAt` centre: `max(armCentreDeg, asin(√(v / 2R)))`. Above v* = 2R·sin²33° ≈ 0.523 a symmetric
  swing would carry the wrist behind the shoulder (where the wrist stops falling and rises again,
  so the readback would come up short); the backswing is pinned with the wrist straight below the
  shoulder instead.
  Wrist travel stays exactly the bound value in both cases.
- The arm-swing bracket's label moves from under the bracket's foot to above its top end. A pinned
  swing reaches lower, and at 390 px the label under the foot went behind the stop panel (design D4).
- The arms stop's camera: a new `armsQuarter` preset, 15° off the side, replaces the 45°
  `upperFrontQuarter` there. At 45° the arms read as crossing the midline (design D5). Runner-tour's
  camera requirement is MODIFIED (the arms row only).
- Unchanged: the measurement, the binding (neutral 0.3, range [0, 0.9]), the bracket (it spans
  exactly the value), every other annotation, the elbow bend, segment lengths and phase offset, the
  word budgets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-runner`: one ADDED requirement (the arm sweeps past the trunk; wrist travel exact).
- `runner-tour`: one ADDED requirement (the arms stop's label).
- `results-summary`: one ADDED requirement (the arms row's label).

ADDED only: `compose-bounce-reading` (in flight) MODIFIES the tour and summary requirements that
name the headline label, and a second MODIFIED block would clobber it on archive.

## Impact

`src/runner/gaitModel.ts`, `src/runner/runnerAnnotations.ts` (arm-swing label only),
`src/results/summary/summaryLabels.ts`, their tests and the two label tests (`TourStop.test.tsx`,
`FocusAreaRow.test.tsx`). No `src/heuristics/**` change.
