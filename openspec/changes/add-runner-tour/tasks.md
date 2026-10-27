## 1. Focus areas

- [x] 1.1 Add `src/guidance/focusAreas.ts`: area ids, tour order, labels, metrics in headline-preference order, `focusAreaView`.
- [x] 1.2 Test exhaustiveness (13 metrics, each in exactly one area), fixed order, 1–2-word labels, excluded-skipping headline, `measured: false`, preference order.

## 2. Feedback points

- [x] 2.1 Open every cited URL and record the supporting sentence in design.md; drop any line no page states.
- [x] 2.2 Add `src/guidance/feedbackPoints.ts`: `WHY_LINES`, `NON_POINTS`, `feedbackFor`, `ONE_THING_PRIORITY`, `selectOneThing`.
- [x] 2.3 Pin every URL in `FEEDBACK_VERIFIED_URLS`; each member is in the research file or the guidance record.
- [x] 2.4 Test: cue equals the Try line; why ≤ 14 words; 25-word budget worst case per area and for the one-thing stop; no grading words; knees never cue lifting; cue withheld at VO_cm 4.42; one-thing selection cases; agreement with the Energy cost headline's side logic.

## 3. Review round 1

- [x] 3.1 Apply one eligibility rule to both area cues and the one thing: normal tier, Try line applies, renderable band, value past the costly side. The area cue is the area's first eligible metric by priority.
- [x] 3.2 Key the why line to the cue's metric when there is a cue.
- [x] 3.3 `selectOneThing` takes `scalePassStatus` and returns `unclear` (`caveated` / `pending` / `unmeasured`) unless every cue-capable metric was measured at the normal tier.
- [x] 3.4 Revise the copy. Foot path drops its why line, and the step-width non-point becomes Arellano 2011's cost finding.
- [x] 3.5 Move `tryLineApplies`, `renderableBand`, `sourceHasProvenance`, `pastCostlySide`, `GuidedEntry`, `MetricTier` and `ScalePassStatus` into `src/guidance`, re-exported from `src/results`.
- [x] 3.6 Add explicit cue / no-cue case tables, and tests for each unclear reason.

## 4. Verification

- [x] 4.1 `openspec validate add-runner-tour --strict`.
- [x] 4.2 `npm run lint`, `npx tsc -b`, `npx vitest run`.

## 5. View routing (`strides-trn2.2`)

- [x] 5.1 `resultsViewMode.ts`: resolve `tour|summary|classic`, map `guide` to tour, fall back to the remembered landing, else tour; only classic is written to the address.
- [x] 5.2 `resultsLanding.ts`: read/write `strides.resultsLanding`, with every storage access (the `localStorage` getter included) inside try/catch.
- [x] 5.3 Stubs `tour/RunnerTour.tsx` and `summary/ResultsSummary.tsx`: runner slot, their own controls, exactly one `GuidedResultsView`, no completion line of their own.
- [x] 5.4 `MultiClipVideoSession.tsx`: mount exactly one view; motion stage beside classic only; Back to summary; header-height property on `<main>`; focus the new view's first control after a switch. Delete `ResultsViewToggle`.
- [x] 5.5 Spec deltas: REMOVE "The guided results view is the default", ADD "The runner tour is the default results view", MODIFY the single-mount and completion-line requirements, and scope the motion-stage requirements in `results-view` to classic.
- [x] 5.6 Tests: every URL form × landing, throwing storage, the canvas surviving tour → summary → classic → summary, one completion line after every step.
- [x] 5.7 Verify: lint, `tsc -b`, `vitest run`, `openspec validate --strict`, the e2e suite and a live run on `park-side-landscape.mp4`.
