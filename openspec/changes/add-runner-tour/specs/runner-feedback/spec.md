## ADDED Requirements

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
consequence names as costly — the Energy cost headline's threshold. An area's cue SHALL be the first
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
