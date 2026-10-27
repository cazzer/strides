## MODIFIED Requirements

### Requirement: The runner sits beside the stops when wide and behind them when narrow

At wide layouts the runner SHALL stay in view (sticky, under the tour's bar) in a column to the left
of the stops, sized so its controls, the slow-motion label and the legend stay on screen.

At narrow layouts (below 1024 px) the runner SHALL be a background behind the stops for the length
of the tour, sticky under the tour's bar and as tall as the viewport below it, and each stop's
content SHALL be a panel that scrolls over it: at least 85% opaque, with a backdrop blur, so the
runner shows through the gaps between panels. Panel text, and the runner's notes drawn on the same
surface, SHALL meet WCAG AA contrast (4.5:1) against the panel's colour composited over the page
and over every colour the runner paints with, in light and dark. The runner's drawing SHALL be at
least `max(40svh, 200px)` tall at every stop (or the whole stage, if that is less) and SHALL NOT be
shrunk below that to make room for a panel. It SHALL be framed above the active stop's panel as
measured at rest when that leaves it its floor; otherwise the panel SHALL overlap the drawing's
bottom on its translucent surface, its height capped so the top 85% of the floor stays uncovered at
rest (but never below 6rem), and a longer panel SHALL scroll inside itself; while it does, it SHALL
be focusable, named by its stop's heading and show a focus ring, so the keyboard can scroll it.
Either way, on a viewport at least 500 px tall, the camera's target, the focus body part, SHALL be
visible above the panel at rest, and the landing stop's feet sit above its panel. Except on a short
phone, the runner's controls (Skip intro while the intro runs, and Pause or Play) SHALL stay stuck
under the tour's bar above the panels; everywhere they SHALL be at least 44 px tall and never
covered by a panel, and "Skip to summary" SHALL stay in view. On a short phone (below 1024 px wide
and at most 720 px tall) the controls SHALL share one sticky row with the tour's progress dots and
Skip instead of a row of their own, in that order for the keyboard as on screen (the controls, the
dots, Skip), and Pause MAY show its icon alone, keeping its accessible name. The tour's heading
SHALL be visually hidden, remaining its entry point, so that, except on a short phone, the bar is
one row of progress dots and Skip. The stop the runner shows SHALL be the stop at rest: the reading
line SHALL NOT sit above the bottom of the stuck bar. A scroll SHALL settle, by proximity snapping,
with a stop's panel at rest and the runner clear above it; the first stop SHALL NOT be a snap
point, so the page never moves on its own as the tour appears and its top stays reachable. The tour
SHALL NOT scroll horizontally at widths from 360 to 430 px.

Both layouts SHALL be the same runner styled per breakpoint: the tour SHALL render one runner at
every width and SHALL NOT remount it when the width or height crosses a breakpoint, so the reader's
Pause survives a resize or a tablet's rotation. Only the progress dots and Skip move, between the
bar and a short phone's shared row, and a dot or Skip that had keyboard focus SHALL keep it across
the move.

#### Scenario: Wide layout

- **WHEN** the tour renders at a desktop width
- **THEN** the runner stays in view beside the stops while they scroll

#### Scenario: A phone

- **WHEN** the tour renders at 390 px wide and the reader scrolls a stop's panel halfway up over
  the runner
- **THEN** the runner stays behind the panel, Pause stays on screen above it and can be tapped,
  and the page is no wider than the screen

#### Scenario: A short phone at rest

- **WHEN** the tour renders at 375×548 and a stop's panel is at rest
- **THEN** the drawing is at least 40% of the viewport's height, the stop's focus body part is
  above the panel, and that stop is the one the runner shows

#### Scenario: Crossing the breakpoint

- **WHEN** the reader pauses the runner and the width then crosses 1024 px
- **THEN** the runner is the same element, still paused

### Requirement: The intro waits for a figure with room

The intro SHALL NOT start until the runner's figure is at least `min(120px, 25% of the viewport's
height)` tall (never 0 px) as well as at least 90% on screen (or filling 90% of the viewport), and
a change in the figure's size SHALL be re-read. The narrow layout's drawing floor SHALL leave the
figure that room on every phone, including a landscape one, so Skip intro never waits on a figure
that cannot get it.

#### Scenario: A zero-height figure

- **WHEN** the figure is on screen but 0 px tall
- **THEN** the intro does not start

#### Scenario: A landscape phone

- **WHEN** the tour renders at 667×375 and the reader reaches the first stop
- **THEN** the intro plays and finishes
