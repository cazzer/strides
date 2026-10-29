## 1. Knee flexion as a bend from straight

- [x] 1.1 Sided accent (`focusAccentEdges`, `segmentStyle` sides) wired from the annotations in `ModelRunner`
- [x] 1.2 Dashed straight-leg reference (`dashedGuides`), label "<value> bend"
- [x] 1.3 Dwell: `keyPhaseDwellWindow`, `keyPhaseDwellMs` prop, `FOCUS_AREA_CAMERA.knees` 500 ms, tour and summary pass it
- [x] 1.4 Tests: readback (`runnerAnnotations.test.ts`), accents and dwell (`ModelRunner.test.tsx`, `runnerScene.test.ts`, `camera.test.ts`)

## 2. Rhythm framing

- [x] 2.1 `strideCamera` fills the visible frame (`drawingFrame`, `strideFramePad`, clear bottom); labels clamp to the visible frame
- [x] 2.2 `useStrideOpening` + `stopOpensWhole`: whole body, ease out, then draw; reduced motion straight to stride
- [x] 2.3 Tests (`camera.test.ts`, `RunnerTour.test.tsx`)

## 3. Whole-body framing (review round 1)

- [x] 3.1 `DrawingFrame.clearBottom` read from `--runner-clear-bottom` (phone tour 0.15); stride camera uses it
- [x] 3.2 `wholeBodyCamera` + `wholeBodyFramePad`; ModelRunner reframes `wholeBodySide` once measured, on the bound values
- [x] 3.3 Tests (`camera.test.ts`, `RunnerTour.test.tsx`); live every stop and the intro at 1280×800 and 390×844, base vs branch label boxes

## 4. Verification

- [x] 4.1 Full vitest, `tsc -b`, `eslint .`
- [x] 4.2 Live: Demo (3 clips) at 1280×800 and 390×844 (and 390 reduced motion), knees playing / dwell / paused, rhythm arrival and stride
