## 1. Core

- [x] 1.1 `CameraPreset` gains `landingSide`; `landingCamera(values)`, `LANDING_PHASE_WINDOW`, `PhaseWindow`, `CAMERA_FRAME_HALF_WIDTH` in `camera.ts`; `footSide` marked unused by the app
- [x] 1.2 `advancePhase` in `runnerScene.ts`; `placeLabel` takes `offsetLines`
- [x] 1.3 `runnerAnnotations.ts`: `heldPhaseWithoutKey`, overstride plumb guides from hip-mid and ankle, foot-strike mark at ankle height with knee plumb and label under the contact keypoint, ground-lane stacking

## 2. Renderer and app

- [x] 2.1 ModelRunner: `landingSide` reframes on the static values, holds contact when still, loops the window while playing
- [x] 2.2 `focusAreaCamera.ts`: Landing → `landingSide` at 0.4×; the landing camera string in the tour and summary tests
- [x] 2.3 Sandbox scenarios: big landing (0.512), forefoot, stacked labels

## 3. Tests

- [x] 3.1 camera.test.ts: preset list, framing over the window at landing −0.3 … 0.7, frozen, preset = neutral frame
- [x] 3.2 runnerScene.test.ts: `advancePhase` (no window, loop, wrap, entry without jump, ten seconds inside), `placeLabel` offsetLines
- [x] 3.3 runnerAnnotations.test.ts: plumb guides, foot-strike geometry and label anchor (heel / toe), stacking, held phase without a key
- [x] 3.4 ModelRunner.test.tsx: tween to the landing frame and window playback, leaving without a jump, bound change reframes, reduced-motion contact on the ground (three focuses), marks on the live leg

## 4. Verification

- [ ] 4.1 Gates: lint, `tsc -b`, vitest (runner, results, full), `openspec validate add-landing-camera --strict`, `vite build`
- [ ] 4.2 Real-app screenshots of the tour stops (Landing included) and the summary's Landing row, plus sandbox crops at 390; check the ps19.4 sink and label crowding
