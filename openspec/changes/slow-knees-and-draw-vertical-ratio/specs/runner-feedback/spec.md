## MODIFIED Requirements

### Requirement: The bounce reading is headlined by vertical ratio and cites what it was derived from

When vertical ratio is measured, the bounce reading SHALL carry one line naming vertical ratio's
own inputs, and nothing it was not computed from: the hip bounce as a share of torso length (the
relative vertical oscillation, which reads the same hip-bounce fit) divided by the stride length in
torso lengths (the relative vertical oscillation's value divided by vertical ratio's, which equals
the median stride over the median torso length because both read that fit), and the number of
strides the stride length is the median of (vertical ratio's sample size). Both figures are in
torso lengths, the stride to two decimals, so the division agrees with the displayed vertical
ratio to within its rounding. The relative vertical oscillation cited SHALL be the one measured on
vertical ratio's own clip: in a multi-clip session it SHALL be read off that clip's result,
whichever clip fusion took the fused relative vertical oscillation from, and reading it SHALL NOT
change any fused value or any clip choice. The figures SHALL be cited only when that clip's
relative vertical oscillation is measured and was computed from the hip-midpoint signal; otherwise
the line SHALL name the inputs with no figures. The line SHALL read "From hip bounce 15.3% of torso
÷ stride length 6.30 torsos (median of 3)", or "From hip bounce ÷ stride length (median of 3)"
without figures, with "(one measurement)" for a single stride, and SHALL use "stride" only for the
length. It SHALL NOT cite vertical oscillation in centimetres, which is a separate fit (the scale
pass) that vertical ratio does not read, and SHALL NOT change when the scale pass lands. When
vertical ratio is not measured the bounce reading SHALL carry no such line.

#### Scenario: One clip, everything measured

- **WHEN** the bounce metrics are measured on one clip, with vertical ratio over 3 strides
- **THEN** the line reads "From hip bounce <x.x>% of torso ÷ stride length <y.yy> torsos (median of
  3)", and x.x divided by y.yy agrees with the displayed vertical ratio to within 0.05 percentage
  points

#### Scenario: The scale pass lands

- **WHEN** vertical oscillation in centimetres is grafted after the line has rendered
- **THEN** the line is unchanged: it never cites the centimetre bounce

#### Scenario: Relative bounce from another clip

- **WHEN** a multi-clip session takes vertical ratio from one clip and the fused relative vertical
  oscillation from another, and vertical ratio's clip measured a relative vertical oscillation too
- **THEN** the line cites vertical ratio's clip's hip bounce and the stride it implies, and the fused
  relative vertical oscillation, its card and its clip are unchanged

#### Scenario: No relative bounce on vertical ratio's clip

- **WHEN** vertical ratio's clip has no measured relative vertical oscillation
- **THEN** the line reads "From hip bounce ÷ stride length (median of N)", with no figures

#### Scenario: Vertical ratio excluded

- **WHEN** vertical ratio is excluded
- **THEN** the bounce reading carries no derivation line
