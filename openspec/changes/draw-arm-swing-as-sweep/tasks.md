## 1. Copy

- [x] 1.1 `SHORT_METRIC_LABELS.armSwingAmplitude` → `Arm swing (wrist up-and-down)`
- [x] 1.2 `summaryLabels.test.ts`, `TourStop.test.tsx`, `FocusAreaRow.test.tsx`: the arms label

## 2. Figure

- [x] 2.1 `MODEL_PROPORTIONS.armCentreDeg` 48 → 33, doc rewritten
- [x] 2.2 `armAt`: centre `max(armCentreDeg, asin(√(v / 2R)))`, doc for both cases
- [x] 2.3 `gaitModel.test.ts`: upper-arm range at 0.3 / 0.33 / 0.51 (elbow crosses the trunk line), wrist never behind the shoulder up to 0.9, continuity at v*

## 3. Verification

- [ ] 3.1 `tsc -b`, lint, full vitest, `vite build`
- [ ] 3.2 Live: demo session, arms stop at 1280×800 and 390×844; note entry in `docs/agent-notes/runner-tour.md`
