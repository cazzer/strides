## Context

The phone tour is one grid cell: the runner (sticky stage, drawing inside it, sticky control row)
behind the stops, each stop a slot with its panel at the bottom. The drawing was inset from the
stage's bottom by the active panel's height (`--rt-reserve`), so on short screens it got nothing.
The session header (~200 px with the clip strip) is out of scope (`strides-pmvo`).

## Decisions

### D1. A floor, and the panel overlaps rather than squeezing

Drawing height = `max(stage − draw-top − reserve, draw-min)`, `draw-min = min(max(40svh, 200px),
stage − draw-top)`. When the panel needs more than what is left, it overlaps the drawing's bottom
on its existing 85%-opaque, blurred surface.

### D2. The panel is capped so the focus stays uncovered

The camera centres the focus part in the drawing; measured live, the focus joints reach 74–82% of
the drawing's height (posture is the lowest). The panel's max height is the stage less `draw-top`,
less 85% of the floor (`--rt-clear`), less the slot's bottom padding, never below 6rem; a longer
panel scrolls inside itself (`overflow-y: auto`, scroll chaining left on). At 375×548 that is a
96 px window; at 390×844 229 px (was 286). This is the price of a 40% drawing with a 200 px
header; it shrinks once `strides-pmvo` slims the header.

### D3. On a short phone the tour's bar actions move into a row shared with the controls

The brief asked for Pause and Skip intro inline in the tour's bar. They are rendered inside
`ModelRunner` (`src/runner`, out of scope), and a sticky element only moves within its containing
block: placed over the bar from inside the runner, the controls would sit below the bar until the
tour reached the top. So the reverse: on a short phone (`useShortPhoneLayout`, the same query as
the breakpoint plus `max-height: 720px`) the dots and Skip render in a sticky row that is a cell of
the tour body's grid, beside the runner, and the runner's controls are laid over its start
(`--rt-controls-width`, measured). Both stick together at every scroll position. The bar keeps only
the visually hidden heading. Only the dots and Skip move between the two places; the runner is
never remounted. Pause shows its icon alone (its name is its `aria-label`); Skip reads "Summary".

### D4. The reading line stays under the stuck bar

`max(0.42·vh, barStuckBottom + 0.25·(vh − barStuckBottom))`, where `barStuckBottom` is the bar's
sticky `top` plus its height (not its current position, so at scroll 0 nothing activates early).
Desktop (bar ends at 144 px of 800) keeps 42%.

### D5. The gate needs area

`useMostlyVisible` also requires `boundingClientRect.height ≥ 120`, and re-observes on resize, as a
figure growing while fully on screen crosses no intersection threshold. With D1 the figure always
has at least 200 px, so Skip intro never waits on a figure that cannot get room.
