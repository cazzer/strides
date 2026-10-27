## MODIFIED Requirements

### Requirement: Skip stays in view and the heading is the tour's entry point

The tour SHALL open with a bar holding its "Your runner model" heading, which is its entry point
after a switch, a progress cue, and a "Skip to summary" control. The bar SHALL stay in view
(sticky, under the session header) for the whole tour. The progress cue SHALL be one link per stop
to its `#tour-<stop>` fragment, the active one marked current, each named to assistive technology
as "Stop N of M" with the stop's name. On a short phone (below 1024 px wide and at most 720 px
tall) the progress cue and Skip SHALL instead sit in the row the tour's body shares with the
runner's controls (see the narrow layout), sticky under the session header for the whole tour, and
the bar SHALL hold only the heading; Skip MAY read "Summary" there, keeping the accessible name
"Skip to summary".

#### Scenario: Skipping from the last stop

- **WHEN** the reader has scrolled to the one-thing stop
- **THEN** "Skip to summary" is still on screen

#### Scenario: A short phone

- **WHEN** the tour renders at 375×548 and the reader is at any stop
- **THEN** the dots, Skip, Skip intro (while the intro runs) and Pause share one row under the
  session header, each at least 44 px tall (24 px for a dot) and topmost where it is drawn

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
rest, and a longer panel SHALL scroll inside itself. Either way the camera's target, the focus body
part, SHALL be visible above the panel at rest, and the landing stop's feet sit above its panel.
The runner's controls (Skip intro while the intro runs, and Pause or Play) SHALL stay stuck under
the tour's bar above the panels, at least 44 px tall and never covered by one, and "Skip to
summary" SHALL stay in view. On a short phone (below 1024 px wide and at most 720 px tall) the
controls SHALL share one sticky row with the tour's progress dots and Skip instead of a row of
their own, and Pause MAY show its icon alone, keeping its accessible name. The tour's heading SHALL
be visually hidden, remaining its entry point, so the bar is one row of progress dots and Skip. The
stop the runner shows SHALL be the stop at rest: the reading line SHALL NOT sit above the bottom of
the stuck bar. A scroll SHALL settle, by proximity snapping, with a stop's panel at rest and the
runner clear above it; the first stop SHALL NOT be a snap point, so the page never moves on its own
as the tour appears and its top stays reachable. The tour SHALL NOT scroll horizontally at widths
from 360 to 430 px.

Both layouts SHALL be the same runner styled per breakpoint: the tour SHALL render one runner at
every width and SHALL NOT remount it when the width or height crosses a breakpoint, so the reader's
Pause survives a resize or a tablet's rotation. Only the progress dots and Skip move, between the
bar and a short phone's shared row.

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

## ADDED Requirements

### Requirement: The intro waits for a figure with room

The intro SHALL NOT start until the runner's figure is at least 120 px tall as well as at least
90% on screen (or filling 90% of the viewport), and a change in the figure's size SHALL be
re-read. The narrow layout's drawing floor SHALL leave the figure that room on every phone, so
Skip intro never waits on a figure that cannot get it.

#### Scenario: A zero-height figure

- **WHEN** the figure is on screen but 0 px tall
- **THEN** the intro does not start
