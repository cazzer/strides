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
absent rather than unsourced where no opened source states it. A why line SHALL be chosen by the
area's headline metric and SHALL be at most 14 words. A cue SHALL be the headline metric's existing
Try line, verbatim, with that line's own URL.

#### Scenario: The headline has no sourced why line
- **WHEN** the rhythm area is headlined by vertical ratio
- **THEN** the area has no why line

#### Scenario: The headline has a Try line that applies
- **WHEN** the rhythm area is headlined by cadence
- **THEN** the cue is cadence's Try line text and URL, unchanged

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

#### Scenario: Foot strike headlines the landing area
- **WHEN** overstriding is excluded and foot strike pattern is measured
- **THEN** the landing stop shows the foot-strike non-point and no cue

#### Scenario: Overstriding is measured
- **WHEN** overstriding is measured
- **THEN** the landing stop shows overstriding's cue and no non-point

### Requirement: Knee areas never cue lifting the knees

The knees area SHALL never carry a cue, whatever its readings and whatever Try lines the guidance
record later gains, and no knees text SHALL suggest lifting the knees.

#### Scenario: A knee reading is far outside its band
- **WHEN** knee flexion reads far below its cited band
- **THEN** the knees stop has no cue and the one thing is not a knee cue

### Requirement: A cue appears only where the studied change applies to this value

A cue SHALL be shown only where the existing Try-line withholding rule applies: it SHALL be withheld
when the value is already outside its band on the side the cue moves toward.

#### Scenario: Bounce is already below its band
- **WHEN** the rhythm area is headlined by vertical oscillation in centimetres reading 4.42 cm
- **THEN** the stop shows the why line and no cue

### Requirement: The one thing is at most one cue, and never for a value inside its cited band

The system SHALL choose at most one cue for the whole tour, walking a fixed priority (cadence,
overstriding, vertical oscillation in centimetres, vertical oscillation, then the rest in tour
order). A metric SHALL be eligible only at the normal tier, with a Try line that applies, a
renderable cited band, and a value strictly beyond the band's outermost finite bound on the side the
Try line moves away from — the same threshold as the Energy cost headline. Unbanded, caveated and
excluded metrics SHALL never be chosen. With nothing eligible the result SHALL be that nothing calls
for a change.

#### Scenario: Low cadence
- **WHEN** cadence reads 150 steps/min at the normal tier
- **THEN** the one thing is cadence's cue

#### Scenario: Low cadence and high bounce together
- **WHEN** cadence reads 150 and vertical oscillation reads 10.4 cm, both at the normal tier
- **THEN** the one thing is cadence's cue

#### Scenario: Every value is inside its band
- **WHEN** cadence reads 153 or 174 and every other value is inside its band
- **THEN** the result is that nothing calls for a change

#### Scenario: A caveated or unbanded reading
- **WHEN** the only reading past its band is caveated, or the reading is overstriding, which has no band
- **THEN** it is never chosen

### Requirement: Each stop stays within 25 visible words

A stop's visible words — the area label, the why line, and either the cue prefix with the cue or
the non-point, counted by whitespace split and excluding the value, band and citation — SHALL be at
most 25 for every possible headline and its longest action. The one-thing stop's label, prefix and
cue SHALL be at most 25 words.

#### Scenario: The longest rhythm stop
- **WHEN** the rhythm area is headlined by cadence with its cue
- **THEN** the stop is at most 25 visible words
