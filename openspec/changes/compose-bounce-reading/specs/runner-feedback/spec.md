## ADDED Requirements

### Requirement: Same-quantity metrics in an area read as one composite reading

The system SHALL declare composite readings: sets of metrics in one focus area that describe the
same quantity. Exactly one is declared, bounce, in the rhythm area, with its members in this order:
vertical ratio, vertical oscillation in centimetres, vertical oscillation relative to torso length.
An area's measured metrics SHALL be grouped into readings in the area's own preference order: a
metric outside any composite is a reading of its own, and a composite's measured members form ONE
reading, placed where the first of them sits in the area's order. A composite reading SHALL be
headlined by its first measured member in composite order (vertical ratio, else vertical
oscillation in centimetres, else the relative vertical oscillation), and SHALL carry its other
measured members, in composite order. A composite with no measured member SHALL form no reading.
Composite readings are presentation only: they SHALL NOT change any area's headline, its feedback
(why line, cue or non-point), the one thing, or any measured value.

#### Scenario: Rhythm with everything measured

- **WHEN** cadence and all three bounce metrics are measured
- **THEN** the rhythm area reads as two readings, cadence then bounce, and the bounce reading is
  headlined by vertical ratio with the centimetre and relative vertical oscillation as its members

#### Scenario: Vertical ratio excluded

- **WHEN** vertical ratio is excluded and both vertical oscillation metrics are measured
- **THEN** the bounce reading is headlined by vertical oscillation in centimetres, with the relative
  vertical oscillation as its one member

#### Scenario: Cadence excluded

- **WHEN** cadence is excluded and vertical ratio is measured
- **THEN** the rhythm area's only reading is bounce, and the rhythm area's headline and feedback are
  those `focusAreaView` and `feedbackFor` give, unchanged

### Requirement: The bounce reading is headlined by vertical ratio and cites what it was derived from

When vertical ratio is measured, the bounce reading SHALL carry one line naming what vertical ratio
was derived from, in words, never with an operator: the bounce (vertical oscillation in
centimetres when it is measured, else the relative vertical oscillation, as "% of torso length"),
the stride in torso lengths (the relative vertical oscillation's value divided by vertical ratio's,
which equals the median stride over the median torso length because both read the same hip-bounce
fit), and the number of strides vertical ratio's stride length was the median of (its sample size).
A figure SHALL be cited only when its metric is measured AND comes from the same clip as vertical
ratio's; a figure from another clip SHALL be left out rather than combined. With neither bounce
figure from vertical ratio's clip the line SHALL cite the strides alone. The line SHALL read
"From bounce 7.2 cm and stride 4.6 torso lengths (5 strides)", "From bounce 7.2 cm and 5 strides"
without a stride figure, "From 5 strides" with neither, and use "1 stride" for one. When vertical
ratio is not measured the bounce reading SHALL carry no such line. Stride length in metres SHALL
NOT be cited: it would be derived from vertical ratio and the centimetre bounce, which is circular.

#### Scenario: One clip, everything measured

- **WHEN** all three bounce metrics are measured on one clip, with vertical ratio over 5 strides
- **THEN** the line reads "From bounce <cm value> cm and stride <x.x> torso lengths (5 strides)"

#### Scenario: Centimetre bounce not yet measured

- **WHEN** the scale pass has not grafted vertical oscillation in centimetres
- **THEN** the line cites the relative bounce as "% of torso length", and switches to centimetres
  once the graft lands

#### Scenario: Bounce figures from another clip

- **WHEN** a multi-clip session takes vertical ratio from one clip and both vertical oscillation
  metrics from another
- **THEN** the line reads "From N strides" and cites no bounce or stride figure

#### Scenario: Vertical ratio excluded

- **WHEN** vertical ratio is excluded
- **THEN** the bounce reading carries no derivation line
