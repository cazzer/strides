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
Composite readings are presentation only, a grouping and never a score: they SHALL NOT change any
area's headline, its feedback (why line, cue or non-point), the one thing, or any measured value.

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

When vertical ratio is measured, the bounce reading SHALL carry one line naming vertical ratio's
own inputs, and nothing it was not computed from: the hip bounce as a share of torso length (the
relative vertical oscillation, which reads the same hip-bounce fit) divided by the stride length in
torso lengths (the relative vertical oscillation's value divided by vertical ratio's, which equals
the median stride over the median torso length because both read that fit), and the number of
strides the stride length is the median of (vertical ratio's sample size). Both figures are in
torso lengths, the stride to two decimals, so the division agrees with the displayed vertical
ratio to within its rounding. The figures SHALL be cited only when the relative vertical
oscillation is measured, comes from the same clip as vertical ratio, and was computed from the
hip-midpoint signal; otherwise the line SHALL name the inputs with no figures. The line SHALL read
"From hip bounce 15.3% of torso ÷ stride length 6.30 torsos (median of 3)", or "From hip bounce ÷
stride length (median of 3)" without figures, with "(one measurement)" for a single stride, and
SHALL use "stride" only for the length. It SHALL NOT cite vertical oscillation in centimetres,
which is a separate fit (the scale pass) that vertical ratio does not read, and SHALL NOT change
when the scale pass lands. When vertical ratio is not measured the bounce reading SHALL carry no
such line.

#### Scenario: One clip, everything measured

- **WHEN** the bounce metrics are measured on one clip, with vertical ratio over 3 strides
- **THEN** the line reads "From hip bounce <x.x>% of torso ÷ stride length <y.yy> torsos (median of
  3)", and x.x divided by y.yy agrees with the displayed vertical ratio to within 0.05 percentage
  points

#### Scenario: The scale pass lands

- **WHEN** vertical oscillation in centimetres is grafted after the line has rendered
- **THEN** the line is unchanged: it never cites the centimetre bounce

#### Scenario: Relative bounce from another clip

- **WHEN** a multi-clip session takes vertical ratio from one clip and the relative vertical
  oscillation from another
- **THEN** the line reads "From hip bounce ÷ stride length (median of N)", with no figures

#### Scenario: Vertical ratio excluded

- **WHEN** vertical ratio is excluded
- **THEN** the bounce reading carries no derivation line
