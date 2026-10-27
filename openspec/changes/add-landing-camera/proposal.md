## Why

The Landing stop and the summary's Landing row need to show a landing. The `footSide` preset
framed a fixed world point at 3× zoom, so for most of the cycle it showed a leg in mid-swing, the
foot-strike mark floated about 200 px above the foot, the overstride guides missed it, and the
reduced-motion still had the foot off the ground. The tour fell back to `legsSide` as a stopgap
(trn2.3 UX review, bead strides-ps19.5).

## What Changes

- A new camera preset `landingSide`: a side view framed per parameter set on hip-mid and the near
  leg's landing (`landingCamera(values)`). The renderer reframes it on the values it draws.
- While the camera is `landingSide`, playback loops a window of ±0.15 leg phase around the near
  leg's contact, at the area's 0.4× rate. Entering plays on into the window; leaving lets the
  phase run the whole cycle again.
- The still frame on `landingSide` with no keyed focus is the near leg's contact, so the
  reduced-motion still shows the foot on the ground.
- Contact marks meet the points their metrics read. The overstride guides are plumbs from hip-mid
  and the contact ankle. The foot-strike offset runs at ankle height from under the knee to the
  ankle, with its label under the heel (or under the toe on a forefoot strike). Ground-lane labels
  stack instead of overlapping.
- The Landing focus area (`src/results/focusAreaCamera.ts`) switches from `legsSide` to
  `landingSide`. `footSide` stays as a preset, unused by the app.
- ModelRunner's API is additive only: no prop changes. The new exports are `landingCamera`,
  `LANDING_PHASE_WINDOW`, `PhaseWindow` and `advancePhase`, plus optional fields
  (`AnnotationInput.heldPhaseWithoutKey`, `RunnerAnnotationLabel.offsetLines`) and an optional
  `placeLabel` argument.

## Capabilities

### New Capabilities

### Modified Capabilities
- `model-runner`: camera presets (adds `landingSide`), the animation loop's landing window, the
  reduced-motion still pose on the landing camera, and where the contact annotations sit.

## Impact

- Code: `src/runner/{types,camera,runnerScene,runnerAnnotations,ModelRunner}.ts(x)`, the sandbox,
  and `src/results/focusAreaCamera.ts`.
- Tests: the runner's own tests, plus the landing camera string in the tour and summary tests.
- No measurement changes. `runnerParams.ts`, `gaitModel.ts` and `__fixtures__/measureModel.ts` are
  untouched, and every bound value is still drawn exactly.
