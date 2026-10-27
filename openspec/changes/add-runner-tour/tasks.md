## 1. Focus areas

- [x] 1.1 Add `src/guidance/focusAreas.ts`: area ids, tour order, labels, metrics in headline-preference order, `focusAreaView`.
- [x] 1.2 Test exhaustiveness (13 metrics, each in exactly one area), fixed order, 1–2-word labels, excluded-skipping headline, `measured: false`, preference order.

## 2. Feedback points

- [x] 2.1 Open every cited URL and record the supporting sentence in design.md; drop any line no page states.
- [x] 2.2 Add `src/guidance/feedbackPoints.ts`: `WHY_LINES`, `NON_POINTS`, `feedbackFor`, `ONE_THING_PRIORITY`, `selectOneThing`.
- [x] 2.3 Pin every URL in `FEEDBACK_VERIFIED_URLS`; each member is in the research file or the guidance record.
- [x] 2.4 Test: cue equals the Try line; why ≤ 14 words; 25-word budget worst case per area and for the one-thing stop; no grading words; knees never cue lifting; cue withheld at VO_cm 4.42; one-thing selection cases; agreement with the Energy cost headline's side logic.

## 3. Verification

- [x] 3.1 `openspec validate add-runner-tour --strict`.
- [x] 3.2 `npm run lint`, `npx tsc -b`, `npx vitest run`.
