## Why

On phone viewports under ~700 px tall the tour's runner drawing got 0–53 px (375×548: 0 at every
stop; 375×667: 53; 390×844: 230, 27%), because the sticky session header (~200 px), the tour's bar
and the runner's control row (~110 px) and the active panel's reserve left it no room. The intro
gate passed for the zero-height figure, so the ~5 s intro played out unseen (`strides-xsl3`). A
second fault showed up while measuring: below ~620 px of height the 42% reading line sat inside the
sticky chrome, so a stop at rest never became active and the runner showed the stop before it.

## What Changes

- The phone drawing has a floor, `max(40svh, 200px)`, and is never shrunk below it for a panel. A
  panel that needs more room overlaps the drawing's bottom; its height is capped so the top 85% of
  the floor (where the focus body part is) stays uncovered at rest, and a longer panel scrolls
  inside itself.
- On a short phone (below 1024 px wide and at most 720 px tall) the tour's dots and Skip share one
  sticky row with the runner's controls (Skip intro, Pause icon-only), and Skip reads "Summary"
  (accessible name unchanged). The separate control row is gone there.
- The reading line never sits above the stuck bar: max(42% of the viewport, a quarter of the way
  down the screen under the bar).
- The intro gate also requires the figure to be at least 120 px tall, and re-reads it on resize.
- The session header and clip strip are unchanged (`strides-pmvo`). Desktop is unchanged.

## Capabilities

### Modified Capabilities

- `runner-tour`: the narrow layout requirement (floor, overlap, cap, the short phone's shared row)
  and the bar requirement (the short phone's row).

## Impact

`src/results/tour/` only (`RunnerTour.tsx`, `TourStop.tsx`, `useActiveStop.ts`,
`useMostlyVisible.ts`, new `useShortPhoneLayout.ts`, tests). No measurement code changes.
