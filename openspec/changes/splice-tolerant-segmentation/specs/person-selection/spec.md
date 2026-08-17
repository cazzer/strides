## MODIFIED Requirements

### Requirement: Segments are cut at position, scale, and time discontinuities

The system SHALL start a new segment whenever a surviving detection fails a continuity test
against the previous surviving detection — where continuity is the SAME predicate the online
anchor gate uses (bounding-box overlap OR a centre displacement within a per-second speed bound,
AND a bounding-box area ratio inside a symmetric band) — or whenever more than a configured number
of seconds separates them, since across a long enough gap a speed bound permits any displacement
at all and stops meaning anything.

The system SHALL NOT cut at a surviving detection when the surviving detections immediately
before and after it pass that same test — including its time-gap term — against each other. One
collapsed detection is a measurement failure on a single frame, not evidence of a second subject,
and cutting on it strands every frame before it in a losing segment. The tolerance SHALL span
exactly one surviving detection: two consecutive failures still cut. The system SHALL report how
many cuts were declined this way.

#### Scenario: A large scale change at the same position cuts a segment

- **WHEN** two consecutive surviving detections sit at the same centre but differ in area by more
  than the configured ratio
- **THEN** a segment boundary is cut between them, even though they overlap completely

#### Scenario: A position jump cuts only when it is too fast to be real

- **WHEN** two consecutive surviving detections are separated by a displacement that exceeds the
  speed bound for the elapsed time between them
- **THEN** a segment boundary is cut — and the SAME displacement over a long enough elapsed time,
  within the time-gap tolerance, does NOT cut

#### Scenario: A long silence cuts a segment regardless of geometry

- **WHEN** two consecutive surviving detections are geometrically continuous but separated by more
  than the configured maximum continuity gap in seconds
- **THEN** a segment boundary is cut between them

#### Scenario: An interior stretch of undetected frames does not cut a segment

- **WHEN** a run of samples with no detection separates two surviving detections that are
  continuous with each other and within the time-gap tolerance
- **THEN** no boundary is cut and both belong to the same segment

#### Scenario: A single collapsed detection between two continuous ones does not cut

- **WHEN** one surviving detection fails the continuity test against both the surviving detection
  before it and the one after it, but those two pass the test against each other
- **THEN** no boundary is cut at it, all three belong to the same segment, the collapsed detection
  is kept and contributes its area, and the count of declined cuts records exactly one event —
  because declining the cut in front of it also stops the cut behind it from ever being evaluated

#### Scenario: A declined cut is refused when the surrounding detections are too far apart in time

- **WHEN** the surviving detections either side of an offending one are geometrically continuous
  with each other but separated by more than the configured maximum continuity gap in seconds
- **THEN** the cut is made rather than declined, and the count of declined cuts stays at zero

#### Scenario: Two consecutive discontinuous detections still cut

- **WHEN** two surviving detections in a row each fail continuity against the last detection the
  segment was anchored to
- **THEN** boundaries are cut and the count of declined cuts stays at zero, so the tolerance can
  never chain across a sustained bad stretch
