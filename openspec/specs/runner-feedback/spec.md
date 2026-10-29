# runner-feedback Specification

## Purpose
The feedback data layer under the tour and summary: a fixed grouping of metrics into focus areas,
cited why lines and non-points, cues only where a studied change applies to the value, and at most
one cue as the one thing.
## Requirements
### Requirement: Every focus area groups a fixed set of metrics

The system SHALL group the metrics into six focus areas in a fixed tour order — rhythm, arms,
posture, knees, landing, foot path — with every metric belonging to exactly one area. Each area SHALL
have a label of one or two words and SHALL list its metrics in a fixed headline-preference order.
An area's headline SHALL be the first of its metrics that is not excluded, and the area SHALL be
reported as not measured when all of its metrics are excluded. Neither the area order nor the
headline SHALL depend on the runner's values.

#### Scenario: Every metric has exactly one area
- **WHEN** the focus areas are enumerated
- **THEN** each of the thirteen metrics appears in exactly one area

#### Scenario: The preferred metric is excluded
- **WHEN** cadence is excluded and vertical oscillation in centimetres is measured
- **THEN** the rhythm area is headlined by vertical oscillation in centimetres

#### Scenario: Nothing in an area was measured
- **WHEN** every metric in an area is excluded
- **THEN** the area has no headline and is reported as not measured

### Requirement: A why line or cue is cited or absent

Every why line, cue and non-point SHALL carry an https URL from a pinned verified set, and SHALL be
absent rather than unsourced where no opened source states it. A why line SHALL be at most 14 words
and SHALL be chosen by the cue's metric when the stop has a cue, otherwise by the area's headline
metric. A cue SHALL be the cued metric's existing Try line, verbatim, with that line's own URL.

#### Scenario: The headline has no sourced why line
- **WHEN** the rhythm area is headlined by vertical ratio and has no cue
- **THEN** the area has no why line

#### Scenario: The cue comes from a supporting metric
- **WHEN** cadence reads 175 steps/min and vertical oscillation reads 10.4 cm, both at the normal tier
- **THEN** the rhythm stop's cue is the bounce Try line, unchanged, and its why line is the bounce why line

### Requirement: Feedback never grades the runner

No area label, why line, cue, non-point or one-thing text SHALL contain a grading word (good, bad,
poor, better, worse, best, worst, optimal, ideal, excessive, healthy, unhealthy, target, goal,
should, correct, incorrect, normal, abnormal).

#### Scenario: Feedback copy is checked for grading words
- **WHEN** every feedback string is scanned
- **THEN** none contains a grading word

### Requirement: A non-point stands where evidence says not to change

Where an area has no cue, the system SHALL show the cited non-point of the first measured metric in
that area that has one. A stop SHALL never show both a cue and a non-point. Non-points SHALL exist
only for metrics with no studied change.

#### Scenario: Landing has no cue
- **WHEN** overstriding is measured, or excluded with foot strike pattern measured
- **THEN** the landing stop shows the foot-strike non-point and no cue

#### Scenario: Foot path
- **WHEN** a step-width metric is measured
- **THEN** the foot-path stop shows the step-width non-point, no why line and no cue

### Requirement: Knee areas never cue lifting the knees

The knees area SHALL never carry a cue, whatever its readings and whatever Try lines the guidance
record later gains, and no knees text SHALL suggest lifting the knees.

#### Scenario: A knee reading is far outside its band
- **WHEN** knee flexion reads far below its cited band
- **THEN** the knees stop has no cue and the one thing is not a knee cue

### Requirement: A cue appears only where the studied change applies to this value

A metric SHALL earn a cue only when all of these hold: it is measured at the normal tier; its Try
line exists and is not withheld by the Try-line withholding rule; it has a renderable cited band;
and its value lies strictly beyond the band's outermost finite bound on the side its economy
consequence names as costly. An area's cue SHALL be the first
such metric in the area in the one-thing priority order, headline or supporting. An unbanded metric
SHALL never earn a cue.

#### Scenario: Bounce is already below its band
- **WHEN** the rhythm area is headlined by vertical oscillation in centimetres reading 4.42 cm
- **THEN** the stop shows the why line and no cue

#### Scenario: Cadence within the band's finite bounds
- **WHEN** cadence reads 165 or 175 steps/min at the normal tier
- **THEN** the rhythm stop has no cue

#### Scenario: Low cadence
- **WHEN** cadence reads 150 steps/min at the normal tier
- **THEN** the rhythm stop's cue is cadence's Try line

#### Scenario: An unbanded metric
- **WHEN** overstriding is measured at any value
- **THEN** the landing stop has no cue

### Requirement: The one thing is at most one cue, and never for a value within its band's finite bounds

The system SHALL choose at most one cue for the whole tour: the first metric, across all areas, in a
fixed priority (cadence, overstriding, vertical oscillation in centimetres, vertical oscillation,
then the rest in tour order) that earns an area cue — so the one thing is always a cue the reader has
already seen. With no such metric, the system SHALL report that nothing calls for a change ONLY when
every cue-capable banded metric was measured at the normal tier. Otherwise it SHALL report that the
answer is unclear, with a reason: caveated when a cue-capable reading is measured below the normal
tier; pending when a scale-pass metric is not yet measured while that pass is pending or running;
unmeasured otherwise.

#### Scenario: Low cadence and high bounce together
- **WHEN** cadence reads 150 and vertical oscillation reads 10.4 cm, both at the normal tier
- **THEN** the one thing is cadence's cue

#### Scenario: The one thing matches the area cue
- **WHEN** cadence reads 175 and vertical oscillation reads 10.4 cm, both at the normal tier
- **THEN** the one thing is the bounce cue the rhythm stop shows

#### Scenario: Every value is within its band's finite bounds
- **WHEN** every cue-capable metric is measured at the normal tier within its band's finite bounds
- **THEN** the result is that nothing calls for a change

#### Scenario: A caveated reading
- **WHEN** cadence reads 150 steps/min below the normal tier
- **THEN** the result is unclear, because the reading is caveated

#### Scenario: The scale pass is still running
- **WHEN** vertical oscillation in centimetres is not yet measured and the scale pass is pending or running
- **THEN** the result is unclear, because a measurement is pending

#### Scenario: A cue-capable metric was not measured
- **WHEN** cadence is excluded, or vertical oscillation in centimetres is absent after the scale pass ends
- **THEN** the result is unclear, because a measurement is missing

### Requirement: Each stop stays within 25 visible words

A stop's visible words — the area label, the why line, and either the cue prefix with the cue or
the non-point, counted by whitespace split and excluding the value, band and citation — SHALL be at
most 25 for every possible cue and every possible headline with its longest non-point. The
one-thing stop's label, prefix and cue SHALL be at most 25 words.

#### Scenario: The longest rhythm stop
- **WHEN** the rhythm area is cued by cadence
- **THEN** the stop is at most 25 visible words

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

