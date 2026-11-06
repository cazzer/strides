## Context

`strides-jet8`. Baseline at 390×844, 3-clip demo, real GPU (ANGLE Metal), commit 45b35bca:

| where | inner scroller | box / content |
|---|---|---|
| tour stops (6 of 7: rhythm, arms, posture, knees, landing, footPath) | `.runner-tour__panel`, `max-lg:max-h-[…] overflow-y-auto` | 229 / 238–344 px |
| tour stop oneThing | same class, not overflowing | 202 / 198 px |
| header add-a-clip panel | `#add-clip-panel`, `max-h-[60vh] overflow-y-auto` | 506 / 528 px ("Demo (3 clips)" cut off) |
| summary (all rows open), guided cards, classic, save panel, progress | none | — |

The clip strip computes `overflow-y: auto` (a side effect of its `overflow-x: auto`) but never
overflows vertically; it scrolls sideways by spec. The `MotionStoryStage` expand dialog is a modal
`<dialog>` and keeps its own scroll.

## Decisions

### D1. The tour panel's room becomes the slot's top padding, not the panel's cap

The cap existed (`strides-xsl3`) so that at rest a panel never covers the top 85% of the drawing's
floor, where the camera puts the focus body part. The same line is kept by padding the slot's top by
`--rt-draw-top + --rt-clear` below `lg` (replacing `py-3`'s top). The slot keeps
`min-h: 100dvh − --rt-top` and `justify-end`, so a panel that fits sits exactly where it did; a
longer panel grows the slot past the screen and continues below the fold. Measured rest positions
are unchanged (390×844: panel top 603 px before and after; 375×548: 444 px, the clear line).

### D2. Snap by start, not end

With slots that can now be taller than the screen, `snap-end` would rest a tall stop with its
panel's END at the screen's foot and its top over the figure. `snap-start` with the existing
`scroll-mt-[var(--rt-top)]` rests it with the slot under the bar, i.e. the panel's top on the clear
line. For a slot exactly the screen's height (every slot before this change) the two positions are
identical. An oversized snap area lets the page scroll freely while it covers the snapport, so
reading on to the panel's end is not pulled back (checked live and by the e2e spec).

### D3. The scrolling-panel group goes

`useOverflowing` made a capped, overflowing panel a focusable `role=group` so the keyboard could
scroll it. Nothing scrolls now; the page's own keyboard scrolling covers it.

### D4. The add-a-clip panel: unstick the header while it is open (user decision, 2026-11-05)

Uncapping the panel inside a sticky header would put the end of a tall picker permanently below the
fold on a short phone. While `#add-clip-panel` is in the header, the header is `static`
(`has-[#add-clip-panel]:static`), the published `--motion-story-header-height` is 0 (an offset of the
full height would leave that gap above every sticky element once the header scrolls away), and
opening the panel scrolls its trigger into view (a header that has just stopped sticking is at the
top of the page). Cost: opening add-a-clip from part-way down the results moves the reader to the
top of the page.

### D5. Two guards

- `src/results/noInnerScroll.test.ts` (CI): scans results, guidance, storage, progress and runner
  sources plus `AddClipAction.tsx` and `index.css` for `overflow(-y)-(auto|scroll)` / `max-h-*` /
  CSS `overflow: auto|scroll` / `max-height` that apply below `lg`. Allowlist: the modal dialog.
- `e2e/phonePageScroll.spec.ts` (real GPU, `npm run test:e2e`): at 390×844 walks every tour stop,
  the summary with every row open, the save panel through connect and save, progress, classic and
  add-a-clip. Fails on any vertical scroller in `main` or any overflowing one anywhere (outside
  dialogs), sideways page scroll, a swipe on a tour panel that does not move the page or scrolls an
  element, or a panel end that page scrolling cannot bring on screen. Fails on 45b35bca (six tour
  panels).

## Risks

- A long panel on a short phone shows only its heading and value at rest (375×548: ~104 px visible);
  the rest is a page scroll away. That is the requested trade: before, the same 96–229 px window
  scrolled inside itself.
