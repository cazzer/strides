## ADDED Requirements

### Requirement: The arms stop says its value is up-and-down wrist travel

The arms stop's value label SHALL read "Arm swing (wrist up-and-down)", so the reader knows the
value is the wrist's vertical travel and not the arm's fore-and-aft sweep. The label SHALL be
excluded from the stop's word budget, like the value line it names.

#### Scenario: The arms stop

- **WHEN** the tour reaches the arms stop with arm swing measured
- **THEN** the small label above its value reads "Arm swing (wrist up-and-down)"

## MODIFIED Requirements

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
| arms | upper body, 15° off the side (`armsQuarter`) | 1 |
| posture | torso, side | 1 |
| knees | legs, side | 1 |
| landing | legs, side (a stopgap until a contact-tracking camera) | 0.4, labelled "Slow motion" |
| foot path | feet, front | 0.4, labelled "Slow motion" |
| one thing | whole body, side | 1 |

The arms camera SHALL sit close to the side, so the measured swing reads fore-and-aft and the two
arms never read as crossing the body's midline, while still far enough round for the two shoulders
to separate in depth. The near elbow's backswing SHALL stay outside the projected shoulder–hip
outline, and its forward swing, drawn in front of the trunk, SHALL overlap it by at most 0.15
viewBox units. A front-quarter view drew the near forearm across the chest and the two forearms as
an X, which read as a crossover arm swing that nothing measured says.

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

#### Scenario: The arms stop's camera

- **WHEN** the arms stop is active with arm swing measured at 0.335 or 0.5627
- **THEN** the runner frames the upper body 15° off the side, the near arm is painted over the
  trunk, its backswing stays outside the torso outline, and the far wrist stays outside it at the
  neutral lean
