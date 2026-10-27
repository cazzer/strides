## ADDED Requirements

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

An area stop SHALL show only: the headline metric's name and value (with its confidence when that
is not normal), a decorative compact band bar when the headline is banded, the area's cited why line,
and either the area's cue or its non-point, never both. Each cited line SHALL say beside its source
how strong its evidence is. A stop SHALL carry no description, no disclosure and no metric card.

The visible words of every stop SHALL be at most 25, counting the heading and the lines' text and
excluding the value line, text for assistive technology only, the citations and the end of the
tour, which SHALL be at most 25 words on its own.

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
preset, playback rate and focus (the area's measured metrics, or the one thing's cue metric):

| stop | camera | rate |
|---|---|---|
| rhythm | whole body, side | 1 |
| arms | upper body, front quarter | 1 |
| posture | torso, side | 1 |
| knees | legs, side | 1 |
| landing | foot, side | 0.4, labelled "Slow motion" |
| foot path | feet, front | 0.4, labelled "Slow motion" |
| one thing | whole body, side | 1 |

With no stop active the runner SHALL show the whole figure from the side at full speed.

#### Scenario: Focusing a stop from the keyboard

- **WHEN** focus moves into the landing stop
- **THEN** the runner frames the foot from the side, plays slowed, says "Slow motion", and is the
  same runner element as before

#### Scenario: A fragment link

- **WHEN** the address changes to `#tour-knees`
- **THEN** the knees stop is focused and the runner frames the legs from the side

### Requirement: The tour opens with the runner's intro

The tour SHALL play the runner's adopt-your-gait intro first, on the whole figure, once per result:
a remount or a re-render of the same result (including the scale-pass graft) SHALL NOT replay it,
and replaying the tour SHALL. While the intro runs no stop SHALL point the camera, and the intro
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
"Nothing here calls for a change." when every cue-capable metric was measured at the normal tier;
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
as the landing view.

#### Scenario: A side view only

- **WHEN** arms and foot path were unmeasured for want of a front view
- **THEN** the end reads "Not measured: Arms and Foot path. Add a front-view clip." above "See all
  measurements"

### Requirement: Skip stays in view and the heading is the tour's entry point

The tour SHALL open with a bar holding its "Your runner" heading, which is its entry point after a
switch, and a "Skip to summary" control. The bar SHALL stay in view (sticky, under the session
header) for the whole tour.

#### Scenario: Skipping from the last stop

- **WHEN** the reader has scrolled to the one-thing stop
- **THEN** "Skip to summary" is still on screen

### Requirement: The tour honours reduced motion

Under reduced motion the runner SHALL hold a still pose, camera changes SHALL cut rather than tween,
no "Slow motion" label SHALL show, and the tour SHALL NOT scroll smoothly.

#### Scenario: Reduced motion at the landing stop

- **WHEN** reduced motion is requested and the landing stop is active
- **THEN** the runner frames the foot with no intro and no "Slow motion" label

### Requirement: The runner sits beside the stops when wide and above them when narrow

At wide layouts the runner SHALL stay in view (sticky, under the tour's bar) in a column beside the
stops. At narrow layouts it SHALL sit in flow above the stops.

#### Scenario: Wide layout

- **WHEN** the tour renders at a desktop width
- **THEN** the runner stays in view beside the stops while they scroll
