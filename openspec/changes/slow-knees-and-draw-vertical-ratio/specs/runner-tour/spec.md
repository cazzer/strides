## MODIFIED Requirements

### Requirement: The active stop points the one runner's camera

The tour SHALL render exactly one model runner for its whole life, beside the stops, and SHALL NOT
remount it when the active stop changes. The active stop SHALL be the last stop whose top has
reached a reading line at 42% of the viewport height; keyboard focus entering a stop, and a
`#tour-<stop>` fragment, SHALL make that stop active. The active stop SHALL set the runner's camera
preset, playback rate and focus. The focus SHALL be the stop's headline metric (the one thing's cue
metric at the one-thing stop, none without a cue), plus vertical ratio where the rhythm stop states
it as its secondary value, so the runner never labels a number the stop does not state. Where the
focus draws vertical ratio's stride (the stride is measured), the camera SHALL be the stride camera
(`strideSide`: the whole figure and one stride along the ground, side on, at one scale) at the
stop's rate. At wide layouts the band legend SHALL show beside the runner only while the active
stop's headline has a compact bar; at narrow layouts it SHALL show inside each stop's panel under
its compact bar, and only in a panel that has one.

| stop | camera | rate |
|---|---|---|
| rhythm | whole body, side; the stride camera where vertical ratio's stride is drawn | 1 |
| arms | upper body, 15° off the side (`armsQuarter`) | 1 |
| posture | torso, side | 1 |
| knees | legs, side | 0.4, labelled "Slow motion" |
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

- **WHEN** the rhythm stop is active with cadence as its headline and vertical ratio as its
  secondary value, its stride measured
- **THEN** the runner's focus is cadence and vertical ratio, the camera is the stride camera at full
  speed, and no bounce or stride value is labelled on the figure, only vertical ratio's

#### Scenario: The rhythm stop without vertical ratio

- **WHEN** the rhythm stop is active with cadence as its headline and vertical ratio excluded
- **THEN** the runner's focus is cadence alone and the camera is the whole body from the side

#### Scenario: Focusing a stop from the keyboard

- **WHEN** focus moves into the landing stop
- **THEN** the runner frames the legs from the side, plays slowed, says "Slow motion", and is the
  same runner element as before

#### Scenario: The knees stop plays slowed

- **WHEN** the knees stop, headed by knee flexion, is active
- **THEN** the runner frames the legs from the side at 0.4×, the rate landing and foot path use,
  and says "Slow motion" (under reduced motion the figure stays still and no note shows)

#### Scenario: A fragment link

- **WHEN** the address changes to `#tour-knees`
- **THEN** the knees stop is focused and the runner frames the legs from the side

#### Scenario: The arms stop's camera

- **WHEN** the arms stop is active with arm swing measured at 0.335 or 0.5627
- **THEN** the runner frames the upper body 15° off the side, the near arm is painted over the
  trunk, its backswing stays outside the torso outline, and the far wrist stays outside it at the
  neutral lean
