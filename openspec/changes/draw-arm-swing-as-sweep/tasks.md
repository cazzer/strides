## 1. Copy

- [x] 1.1 `SHORT_METRIC_LABELS.armSwingAmplitude` → `Arm swing (wrist up-and-down)`
- [x] 1.2 `summaryLabels.test.ts`, `TourStop.test.tsx`, `FocusAreaRow.test.tsx`: the arms label

## 2. Figure

- [x] 2.1 `MODEL_PROPORTIONS.armCentreDeg` 48 → 33, doc rewritten
- [x] 2.2 `armAt`: centre `max(armCentreDeg, asin(√(v / 2R)))`, doc for both cases
- [x] 2.3 `gaitModel.test.ts`: upper-arm range at 0.3 / 0.33 / 0.51 (elbow crosses the trunk line), wrist never behind the shoulder up to 0.9, continuity at v*

## 3. Verification

- [x] 3.1 `tsc -b`, lint, full vitest, `vite build`
- [x] 3.2 Live: demo session, arms stop at 1280×800 and 390×844; note entry in `docs/agent-notes/runner-tour.md`

## 4. Review round 1: the arm label at phone width

- [x] 4.1 `runnerAnnotations.ts` armSwing: label anchored at the bracket's top end, `side: 'above'` (was below its foot)
- [x] 4.2 `runnerAnnotations.test.ts`: label anchor is the top end, laid out centred on the bracket, unclamped, wholly above the top tick, for 0.05 / 0.33 / 0.5627 / 0.9
- [x] 4.3 Live re-check at 390 (side pinned, front) and 1280; another stop's label unmoved; note updated

## 5. Review round 2

- [x] 5.1 `METRIC_LABELS.armSwingAmplitude` → `Arm swing amplitude (wrist up-and-down)`; `MetricsPanel.test.tsx`, `SessionCoverageNotice.test.tsx`
- [x] 5.2 `metricDescriptions.ts`: the forward-and-back sweep isn't measured
- [x] 5.3 Direction words fixed (the wrist rises / the drop shrinks) in `gaitModel.ts`, proposal, design, note
- [x] 5.4 `runnerAnnotations.test.ts`: the 130 px/unit constant tied to `strides-ikbu`
- [x] 5.5 Arms-stop camera: new `armsQuarter` preset (yaw 15, pitch 5, zoom 1.7, target 0.4 forward), used only by the arms stop; `armsCamera.test.ts` (backswing and far wrist outside the outline, forward overlap ≤ 0.15, arms framed), paint order in `runnerScene.test.ts`, joints-in-frame in `camera.test.ts`; runner-tour camera requirement MODIFIED
- [x] 5.6 Arm label re-checked under `armsQuarter`: the near upper arm never runs through it at phone or desktop scale (tested), so it stays above the top end everywhere; live r2 at 1280 and 390, side and front clips
