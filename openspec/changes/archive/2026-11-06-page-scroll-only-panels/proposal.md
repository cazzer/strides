## Why

On a phone, six of the seven runner-tour stop panels scroll inside themselves as well as the page
(`strides-jet8`). Measured at 390×844 on the 3-clip demo: each panel is capped at 229 px and holds
238–344 px of content, so a swipe that starts on a panel sometimes moves the panel and sometimes the
page. The header's add-a-clip panel does the same (506 px cap, 528 px of content). The reader wants
the page to be the only thing that scrolls.

## What Changes

- **Tour stop panels are never capped below `lg`.** The slot's top padding reserves the drawing's
  uncovered part (`--rt-draw-top` + `--rt-clear`) instead of a `max-height` on the panel, so a short
  panel sits at the slot's foot exactly as before, and a longer one makes its slot taller and
  continues below the fold, read by scrolling the page. Stops snap by their START (under the bar)
  rather than their end, so a tall stop comes to rest with its panel's top below the figure's focus,
  which is where the old cap put it; for a stop no taller than the screen the two positions are the
  same. The focusable "scrolling panel" group goes, since nothing scrolls.
- **The add-a-clip panel is not capped.** While it is open the header stops being sticky, so the page
  scrolls past a picker of any height; opening it brings the header into view; the header-height
  offset reads 0 while the header is not stuck. It sticks again on close.
- **A guard**: an e2e spec walks every results view at 390 px (tour stops, summary with every row
  open, classic, the save panel, the progress page, add-a-clip) and fails on any vertical scroll
  container, any scroll container in `main`, or a horizontally scrolling page. A unit test fails on a
  scrolling or height-capping utility in the results, storage, progress and guidance sources outside
  a short allowlist (modal dialogs; the horizontally scrolling clip strip).

## Capabilities

### Modified Capabilities

- `runner-tour`: a narrow-layout panel is never capped and never scrolls inside itself.
- `results-view`: no results panel has its own scroll area at phone widths.
- `video-input`: the add-a-clip panel is not capped; the header unsticks while it is open.
- `multi-clip-analysis`: header-height offsets follow the header's STUCK height (0 while unstuck).

## Impact

- `src/results/tour/TourStop.tsx`, `TourStop.test.tsx`, `src/index.css` (snap comment),
  `src/video/AddClipAction.tsx`, `src/results/MultiClipVideoSession.tsx`.
- New `e2e/phonePageScroll.spec.ts`, new `src/results/noInnerScroll.test.ts`.
- No metric, evidence or sampling change: layout only.
