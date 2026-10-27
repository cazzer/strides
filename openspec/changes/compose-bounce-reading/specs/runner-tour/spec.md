## MODIFIED Requirements

### Requirement: A stop shows its area's value and feedback, within 25 words

An area stop SHALL show only: the headline metric's value on a line of its own under a small label
naming the metric (with its confidence when that is not normal), a decorative compact band bar when the headline is banded, the area's cited why line,
and either the area's cue or its non-point, never both; plus, at the rhythm stop only, vertical
ratio's "From …" derivation line or its secondary value block, as below. Each cited line SHALL say
beside its source how strong its evidence is. A stop SHALL carry no description, no disclosure and
no metric card.

The headline SHALL be the area's own headline (runner-feedback's first non-excluded metric), the
metric its feedback is keyed on. When that headline is vertical ratio, the stop SHALL show vertical
ratio's "From …" line (runner-feedback) after the bar and its legend. When it is not, and the
area's bounce reading is headed by a measured vertical ratio, the stop SHALL show one secondary
value block after the why line and the cue or non-point: the label "Vertical ratio", its value
with its band position as visible text, and its confidence when that is not normal; no bar, no
legend and no "From …" line. No other secondary block SHALL be shown.

The visible words of every stop SHALL be at most 25, counting the heading and the lines' text and
excluding the value line, text for assistive technology only, the citations, the band legend
under a narrow layout's bar, and the end of the tour, which SHALL be at most 25 words on its own.
The secondary value block SHALL be excluded like the value line, and the "From …" line SHALL be
excluded and at most 14 words on its own.

#### Scenario: A banded headline

- **WHEN** an area's headline metric has a cited band
- **THEN** its stop shows a compact bar beside the value, and an unbanded headline shows none

#### Scenario: The word budget

- **WHEN** the tour renders for any result, including a cue at every stop that can carry one
- **THEN** every stop's counted words are at most 25

#### Scenario: The rhythm stop with cadence and vertical ratio measured

- **WHEN** cadence and vertical ratio are both measured
- **THEN** the rhythm stop shows cadence as its headline with its bar, its why line and cue or
  non-point, then a secondary block "Vertical ratio" with its value and band position, and no
  second bar and no "From …" line

#### Scenario: Vertical ratio heads the rhythm stop

- **WHEN** cadence and vertical oscillation in centimetres are excluded and vertical ratio is measured
- **THEN** the rhythm stop's headline is vertical ratio, with its bar, then its "From …" line after
  the bar and legend, and no secondary block

#### Scenario: Vertical ratio not measured

- **WHEN** vertical ratio is excluded
- **THEN** the rhythm stop shows its headline and feedback only, with no secondary block
