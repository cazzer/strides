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
- [x] 5.4 `MultiClipVideoSession.tsx`: mount exactly one view; motion stage beside classic only; Show summary; header-height property on `<main>`; focus the new view's first control after a switch. Delete `ResultsViewToggle`.
- [x] 5.5 Spec deltas: REMOVE "The guided results view is the default", ADD "The runner tour is the default results view", MODIFY the single-mount and completion-line requirements, and scope the motion-stage requirements in `results-view` to classic.
- [x] 5.6 Tests: every URL form × landing, throwing storage, the canvas surviving tour → summary → classic → summary, one completion line after every step.
- [x] 5.7 Review round 1: focus the `[data-view-entry]` control; push a `{ stridesView }` history entry per switch and restore on `popstate` (unstamped entries keep the view); rename to "Show summary"; move Replay tour into the summary footer; 44 px footer targets.
- [x] 5.8 Verify: lint, `tsc -b`, `vitest run`, `openspec validate --strict`, the e2e suite and a live run on `park-side-landscape.mp4`.

## 6. Results summary (`strides-trn2.5`)

- [x] 6.1 `GuidedResultsView` takes a `children` body slot; extract `useRevealFragment` (`revealFragment.ts`) and `NotMeasuredEntries`.
- [x] 6.2 `summary/summaryRows.ts`: one row per measured area in tour order, entries from `guidedGroups`, the rest in Not measured.
- [x] 6.3 `focusAreaCamera.ts`: per-area camera preset and rate, and `runnerFocusFor` (one limb key phase per still beat).
- [x] 6.4 `MetricScale` `compact`: track and marker only, `aria-hidden`.
- [x] 6.5 `summary/FocusAreaRow.tsx` (native `<details>`, cards at full depth, why line / non-point with source) and `NotMeasuredRow`.
- [x] 6.6 `ResultsSummary.tsx`: one `ModelRunner` (sticky at lg, in flow below), camera follows the last-opened row, legend, rows, footer.
- [x] 6.7 Spec: extend the single-mount MODIFIED block in place; add `specs/results-summary/spec.md`.
- [x] 6.8 Tests: summaryRows, focusAreaCamera, feedbackSources, compact MetricScale, FocusAreaRow, ResultsSummary.
- [x] 6.9 Verify live on "Demo (3 clips)" at 1280 and 390 px, light and dark; e2e suite.

## 7. Runner tour, desktop (`strides-trn2.3`)

- [x] 7.1 `summaryRows` returns all six `views`; `ONE_THING_UNCLEAR` copy; `FeedbackLine` citation class; `BandLegend` shared by summary and tour.
- [x] 7.2 `tour/tourPlan.ts`: stops, one thing, unmeasured areas, capture hint, `stopCamera`, `tourStopDomId`.
- [x] 7.3 `tour/useActiveStop.ts`: reading line, focus, rAF batching.
- [x] 7.4 `tour/TourStop.tsx`: `AreaStop` and `OneThingStop` with the end of the tour.
- [x] 7.5 `tour/RunnerTour.tsx`: sticky bar (heading + Skip), one runner rail, intro, stops; `MultiClipVideoSession` passes `resultKey` (with the replay count) and `coverage`.
- [x] 7.6 Spec: `specs/runner-tour/spec.md`; edit the single-mount MODIFIED block in place.
- [x] 7.7 Tests: tourPlan, useActiveStop, TourStop, RunnerTour (camera, hash, intro, replay, reduced motion, word budget), session canvas test.
- [x] 7.8 A/B fidelity gate (`--view-arm`): tour vs classic bit-identical but `elapsedMs`.
- [x] 7.9 Verify live at 1280 px on `park-side-landscape.mp4` and "Demo (3 clips)"; lint, `tsc -b`, `vitest run`, e2e, `openspec validate --strict`.
- [x] 7.10 Review round 1: landing → `legsSide` (summary too); headline-only focus; intro gated on a 90%-visible rail, intro camera from coverage; no coverage notice above the tour, hint as the add-a-clip control; wider rail, taller runner, value on its own line; "Your runner model"; NOTHING_TO_CHANGE reworded; progress dots; Replay scrolls to the top; TreeWalker word count; legend per active stop; ResizeObserver re-read.

## 8. Runner tour, phones (`strides-trn2.4`)

- [x] 8.1 `max-lg:` layout on the exported class strings: the rail `contents`; runner stage, notes and stops in one grid cell; the stage sticky under the bar, under the panels; the control row sticky above them; one runner at every width.
- [x] 8.2 `TourStop`: each stop's content in a panel (`TOUR_PANEL_CLASS`), at least 85% opaque with a backdrop blur, at the bottom of a transparent slot; phone sizes for the heading and the value.
- [x] 8.3 Frame the drawing above the panels' reserve (`--rt-reserve`); measure the tour bar into `--runner-tour-bar-height`; two-row bar below `lg`.
- [x] 8.4 Spec: edit "The runner sits beside the stops…" in place for the narrow layout.
- [x] 8.5 Tests: `tourPanelContrast.test.ts` (WCAG AA over the page and every runner colour, light and dark), `runnerPhoneStructure.test.tsx`, the panel structure in `RunnerTour.test.tsx`.
- [x] 8.6 Verify live at 390×844 (light, dark, reduced motion) on `park-side-landscape.mp4` and "Demo (3 clips)"; no horizontal overflow at 360/390/430; the runner stops when the tab is hidden; desktop at 1280 pixel-identical; A/B tour vs classic.
