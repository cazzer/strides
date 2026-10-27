## MODIFIED Requirements

### Requirement: A stop shows its area's value and feedback, within 25 words

An area stop SHALL show only: the headline metric's value on a line of its own under a small label
naming the metric (with its confidence when that is not normal), a decorative compact band bar when the headline is banded, the area's cited why line,
and either the area's cue or its non-point, never both. Each cited line SHALL say beside its source
how strong its evidence is. A stop SHALL carry no description, no disclosure and no metric card.

The stop's headline SHALL be the headline of the area's first reading (runner-feedback's composite
readings): a single metric's own, or a composite reading's headline metric. When that first
reading is the bounce composite headlined by vertical ratio, the value line SHALL also carry the
bounce reading's "From …" derivation line. When the bounce reading is a later reading (the rhythm
stop with cadence measured), the stop SHALL add one secondary value block after the headline's:
the bounce headline's short label, its value in a smaller type, its band position for assistive
technology only, and its "From …" line when it has one; no second bar and no legend. A stop SHALL
show no other later reading.

The visible words of every stop SHALL be at most 25, counting the heading and the lines' text and
excluding the value line, text for assistive technology only, the citations, the band legend
under a narrow layout's bar, and the end of the tour, which SHALL be at most 25 words on its own.
The secondary value block SHALL be excluded like the value line, and a "From …" line SHALL be at
most 14 words on its own.

#### Scenario: A banded headline

- **WHEN** an area's headline metric has a cited band
- **THEN** its stop shows a compact bar beside the value, and an unbanded headline shows none

#### Scenario: The word budget

- **WHEN** the tour renders for any result, including a cue at every stop that can carry one
- **THEN** every stop's counted words are at most 25

#### Scenario: The rhythm stop with cadence and bounce measured

- **WHEN** cadence and vertical ratio are both measured
- **THEN** the rhythm stop shows cadence as its headline with its bar, then a secondary block
  labelled "Vertical ratio" with its value and its "From …" line, and no second bar

#### Scenario: The rhythm stop with cadence excluded

- **WHEN** cadence is excluded and vertical ratio is measured
- **THEN** the rhythm stop's headline is vertical ratio, with its bar and its "From …" line

### Requirement: The active stop points the one runner's camera

The tour SHALL render exactly one model runner for its whole life, beside the stops, and SHALL NOT
remount it when the active stop changes. The active stop SHALL be the last stop whose top has
reached a reading line at 42% of the viewport height; keyboard focus entering a stop, and a
`#tour-<stop>` fragment, SHALL make that stop active. The active stop SHALL set the runner's camera
preset, playback rate and focus. The focus SHALL be the stop's headline metric only — the headline
of the area's first reading — (the one thing's cue metric at the one-thing stop, none without a
cue), so the runner never labels a number the stop does not state. At wide layouts the band legend
SHALL show beside the runner only while the active stop's headline has a compact bar; at narrow
layouts it SHALL show inside each stop's panel under its compact bar, and only in a panel that has
one.

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
