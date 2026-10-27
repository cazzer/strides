# runner-tour Specification

## Purpose
The default results view: a tour with one stop per measured focus area and a closing one-thing
stop, each pointing the one model runner's camera at its area, within a 25-word budget, with Skip
to the summary always in view.
## Requirements
### Requirement: The tour has one stop per measured focus area, then the one-thing stop

The runner tour SHALL render one stop per measured focus area, in focus-area order, followed by one
closing one-thing stop, so a tour SHALL have at most seven stops. An area with every metric excluded
SHALL get no stop. Each stop SHALL be a section labelled by its own heading and SHALL carry the id
`tour-<stop>`.

#### Scenario: Everything measured

- **WHEN** every focus area has a measured metric
- **THEN** the tour has seven stops: rhythm, arms, posture, knees, landing, foot path, then the
  one-thing stop

#### Scenario: A side view only

- **WHEN** a side-view session leaves the arms and foot path areas unmeasured
- **THEN** the tour skips both, and its stops are rhythm, posture, knees, landing and the one-thing
  stop

### Requirement: A stop shows its area's value and feedback, within 25 words

An area stop SHALL show only: the headline metric's value on a line of its own under a small label
naming the metric (with its confidence when that is not normal), a decorative compact band bar when the headline is banded, the area's cited why line,
and either the area's cue or its non-point, never both. Each cited line SHALL say beside its source
how strong its evidence is. A stop SHALL carry no description, no disclosure and no metric card.

The visible words of every stop SHALL be at most 25, counting the heading and the lines' text and
excluding the value line, text for assistive technology only, the citations, the band legend
under a narrow layout's bar, and the end of the tour, which SHALL be at most 25 words on its own.

#### Scenario: A banded headline

- **WHEN** an area's headline metric has a cited band
- **THEN** its stop shows a compact bar beside the value, and an unbanded headline shows none

#### Scenario: The word budget

- **WHEN** the tour renders for any result, including a cue at every stop that can carry one
- **THEN** every stop's counted words are at most 25

### Requirement: The active stop points the one runner's camera

The tour SHALL render exactly one model runner for its whole life, beside the stops, and SHALL NOT
remount it when the active stop changes. The active stop SHALL be the last stop whose top has
reached a reading line at 42% of the viewport height; keyboard focus entering a stop, and a
`#tour-<stop>` fragment, SHALL make that stop active. The active stop SHALL set the runner's camera
preset, playback rate and focus. The focus SHALL be the stop's headline metric only (the one
thing's cue metric at the one-thing stop, none without a cue), so the runner never labels a number
the stop does not state. At wide layouts the band legend SHALL show beside the runner only while
the active stop's headline has a compact bar; at narrow layouts it SHALL show inside each stop's
panel under its compact bar, and only in a panel that has one.

| stop | camera | rate |
|---|---|---|
| rhythm | whole body, side | 1 |
| arms | upper body, front quarter | 1 |
| posture | torso, side | 1 |
| knees | legs, side | 1 |
| landing | legs, side (a stopgap until a contact-tracking camera) | 0.4, labelled "Slow motion" |
| foot path | feet, front | 0.4, labelled "Slow motion" |
| one thing | whole body, side | 1 |

With no stop active the runner SHALL show the whole figure from the side at full speed.

#### Scenario: The rhythm stop

- **WHEN** the rhythm stop is active with cadence as its headline
- **THEN** the runner's focus is cadence alone, and no bounce value is labelled on the figure

#### Scenario: Focusing a stop from the keyboard

- **WHEN** focus moves into the landing stop
- **THEN** the runner frames the legs from the side, plays slowed, says "Slow motion", and is the
  same runner element as before

#### Scenario: A fragment link

- **WHEN** the address changes to `#tour-knees`
- **THEN** the knees stop is focused and the runner frames the legs from the side

### Requirement: The tour opens with the runner's intro

The tour SHALL play the runner's adopt-your-gait intro first, once per result: on the whole figure
from the side, or on the feet from the front for a session with front-view clips only, so its
lateral measurements get a step. The same camera SHALL be the runner's while the intro runs. The
intro SHALL NOT start until at least 90% of the runner's figure (its drawing; the caption, the
controls and the legend around it may be off screen) is on screen. It plays
once: a remount or a re-render of the same result (including the scale-pass graft) SHALL NOT replay
it, and replaying the tour SHALL, from the top of the tour. While the intro runs no stop SHALL point the camera, and the intro
SHALL end when the active stop moves past the first stop. Under reduced motion the intro SHALL NOT
play.

#### Scenario: Reading on during the intro

- **WHEN** the intro is running and the reader reaches the second stop
- **THEN** the intro ends and the runner takes that stop's camera

#### Scenario: Replay tour

- **WHEN** the reader replays the tour from the summary
- **THEN** the intro plays again

### Requirement: The one-thing stop says one cue, nothing to change, or why it cannot say

The one-thing stop SHALL show the tour's one cue with its source when there is one; otherwise
"No studied change to try for these readings." when every cue-capable metric was measured at the normal tier;
otherwise one line saying it cannot say and why: a reading that could matter was measured with
lower confidence, bounce in centimetres is still being measured, or a reading that could call for a
change was not measured. None of these SHALL grade the runner.

#### Scenario: The scale pass is still running

- **WHEN** bounce in centimetres is not measured yet and the scale pass is running
- **THEN** the one-thing stop says it cannot say yet because bounce in centimetres is still being
  measured

### Requirement: The end of the tour lists what was skipped and leads on

The one-thing stop SHALL end the tour with the unmeasured areas by name, one capture hint (a
missing camera view when that is what cost those areas their metrics, else steadier footage), and a
"See all measurements" control that finishes the tour, switching to the summary and remembering it
as the landing view. A hint to add a clip from a missing view SHALL be the add-a-clip control
itself. The session SHALL NOT show its camera-coverage notice above the tour, whose end carries
the same information.

#### Scenario: A side view only

- **WHEN** arms and foot path were unmeasured for want of a front view
- **THEN** the end reads "Not measured: Arms and Foot path." above an "Add a front-view clip"
  control, which opens add-a-clip, and "See all measurements"

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

### Requirement: The tour honours reduced motion

Under reduced motion the runner SHALL hold a still pose, camera changes SHALL cut rather than tween,
no "Slow motion" label SHALL show, and the tour SHALL NOT scroll smoothly.

#### Scenario: Reduced motion at the landing stop

- **WHEN** reduced motion is requested and the landing stop is active
- **THEN** the runner frames the legs with no intro and no "Slow motion" label

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

