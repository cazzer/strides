## 1. Implementation

- [x] 1.1 `TourStop.tsx`: drop the panel's `max-h`/`overflow-y-auto`; pad the slot's top by `--rt-draw-top + --rt-clear` below `lg`; `snap-end` → `snap-start`; remove `useOverflowing` and the focusable group
- [x] 1.2 `index.css`: update the snap comment
- [x] 1.3 `AddClipAction.tsx`: drop the 60vh cap; export `ADD_CLIP_PANEL_ID`; bring the trigger into view on open
- [x] 1.4 `MultiClipVideoSession.tsx`: header `has-[#add-clip-panel]:static`; publish a 0 header height while it is unstuck
- [x] 1.5 `TourStop.test.tsx`: replace the scrolling-group test with a no-cap test

## 2. Guards

- [x] 2.1 `src/results/noInnerScroll.test.ts` (fails on 45b35bca's `TourStop.tsx` and `AddClipAction.tsx`)
- [x] 2.2 `e2e/phonePageScroll.spec.ts` at 390×844 (fails on 45b35bca, passes after)

## 3. Verification

- [x] 3.1 Live, real GPU, 3-clip demo: 390×844, 375×548, 375×667, 360×740, 430×932, 1280×800 — no inner scroller, no sideways page scroll, panel top on the clear line at rest, desktop unchanged
- [x] 3.2 Before/after screenshots
- [x] 3.3 `npm run lint`, unit tests, `npm run build`
- [x] 3.4 Real iPhone / Android device check: deferred to the user after deploy (2026-11-06); they reopen strides-jet8 if it recurs
