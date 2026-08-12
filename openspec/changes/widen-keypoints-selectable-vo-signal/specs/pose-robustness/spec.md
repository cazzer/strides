## MODIFIED Requirements

### Requirement: Per-keypoint confidence classification
The system SHALL classify each of the fixed keypoints (one per `COMMON_KEYPOINT_NAMES` entry) in
a pose sample as `'present'` or `'missing'` against a configurable confidence threshold, treating
a `null` frame as every keypoint missing.

#### Scenario: Score at or above threshold is present
- **WHEN** a keypoint's `score` is greater than or equal to `minKeypointConfidence`
- **THEN** it is classified `'present'`

#### Scenario: Score below threshold is missing
- **WHEN** a keypoint's `score` is strictly less than `minKeypointConfidence`
- **THEN** it is classified `'missing'`

#### Scenario: Null frame yields all-missing classification
- **WHEN** a `PoseSample`'s `frame` is `null`
- **THEN** every keypoint for that sample is classified `'missing'`, with no separate code path
  from the low-score case

### Requirement: Independent per-keypoint channels
The system SHALL gap-fill each keypoint (one per `COMMON_KEYPOINT_NAMES` entry) independently, as
its own 1-D time series across the sample sequence, rather than treating a frame as an atomic
unit.

#### Scenario: One keypoint's gap does not affect another's status
- **WHEN** one keypoint is missing across a run of samples while a different keypoint remains
  present across those same samples
- **THEN** the present keypoint's status for those samples is unaffected by the other keypoint's
  gap

### Requirement: Unrecoverable keypoints use a null sentinel, never a fabricated coordinate
The system SHALL represent an unrecoverable keypoint's position as `x: null, y: null`, never as
`(0, 0)` or any other fabricated coordinate, and SHALL never silently drop an unrecoverable
keypoint from the output.

#### Scenario: Unrecoverable keypoint has null coordinates
- **WHEN** a keypoint's status resolves to `'unrecoverable'`
- **THEN** its `x` and `y` fields are `null` and its `score` is `0`, and it is still present as
  one of the `RobustPoseFrame.keypoints` entries, one per `COMMON_KEYPOINT_NAMES` name
