## 1. Composite layer

- [x] 1.1 `src/guidance/compositeReadings.ts`: `COMPOSITE_READINGS`, `compositeOf`, `areaReadings`, `bounceDerivation` (same-clip guard)
- [x] 1.2 `compositeReadings.test.ts`: membership vs `FOCUS_AREAS`, headline fallback, grouping order, same-clip guard, VO/VR = stride/torso identity on synthetic gait

## 2. Summary

- [x] 2.1 `summaryRows`: `readings` and `bounce` beside an unchanged `entries`; takes `sourceIndices`
- [x] 2.2 `summaryLabels`: `alsoMeasuredNames` over readings (composite named once); `formatBounceDerivation`; delete `BOUNCE_UNITS`
- [x] 2.3 `GuidedMetricCard`: optional `derivation` line under the headline
- [x] 2.4 `CompositeReading.tsx`: labelled group, headline card with From line, one nested collapsed "Also:" disclosure
- [x] 2.5 `FocusAreaRow` / `ResultsSummary`: headline from the first reading; body by readings; pass `sourceIndices`

## 3. Tour

- [x] 3.1 `tourPlan` takes `sourceIndices`; stops inherit `readings` and `bounce`
- [x] 3.2 `TourStop`: headline from the first reading (with From line for a composite); secondary bounce block for a later composite
- [x] 3.3 `RunnerTour`: focus and legend from the first reading's headline; pass `sourceIndices`

## 4. Verification

- [x] 4.1 Tests updated and added (row, labels, rows, plan, stop, tour word budget incl. From ≤ 14, card furniture ≤ 50)
- [x] 4.2 `npx tsc -b`, lint, vitest, `vite build`, `openspec validate compose-bounce-reading --strict`
- [x] 4.3 Live: side-landscape tour + summary at 1280×800, 390×844, 375×667, light/dark, reduced motion; 3-clip demo same-clip guard; park-approach; side-portrait
- [x] 4.4 View A/B base vs branch, three clips, bit-identical but `elapsedMs`
- [x] 4.5 Findings in `docs/agent-notes/runner-tour.md`
