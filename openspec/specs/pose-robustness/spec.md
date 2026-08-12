# pose-robustness Specification

## Purpose
Wrap the raw per-frame pose-detection stream in a robustness layer that tolerates missing or
low-confidence keypoint detections — via a bounded-window interpolation strategy — without
crashing or feeding garbage into downstream heuristics, so that heuristics and the results view
consume this layer's output type instead of the raw pose-detection output.
## Requirements
### Requirement: Per-keypoint confidence classification
The system SHALL classify each of the 12 fixed keypoints in a pose sample as `'present'` or
`'missing'` against a configurable confidence threshold, treating a `null` frame as all 12
keypoints missing.

#### Scenario: Score at or above threshold is present
- **WHEN** a keypoint's `score` is greater than or equal to `minKeypointConfidence`
- **THEN** it is classified `'present'`

#### Scenario: Score below threshold is missing
- **WHEN** a keypoint's `score` is strictly less than `minKeypointConfidence`
- **THEN** it is classified `'missing'`

#### Scenario: Null frame yields all-missing classification
- **WHEN** a `PoseSample`'s `frame` is `null`
- **THEN** all 12 keypoints for that sample are classified `'missing'`, with no separate code
  path from the low-score case

### Requirement: Bounded-window linear interpolation of gaps
The system SHALL gap-fill a run of missing classifications for a given keypoint by linear
interpolation between the nearest real detections before and after the run, only when both
anchors exist and the real time elapsed between them does not exceed `maxGapSeconds`.

#### Scenario: Isolated short gap is interpolated
- **WHEN** a keypoint has a run of missing samples bounded on both sides by present detections,
  and the timestamp gap between those two detections is less than or equal to `maxGapSeconds`
- **THEN** each missing sample in the run is assigned `status: 'interpolated'` with `x`, `y`, and
  `score` linearly interpolated between the two bounding detections at the sample's relative
  position in time

#### Scenario: Gap exceeding the maximum window is unrecoverable
- **WHEN** a keypoint has a run of missing samples bounded on both sides by present detections,
  but the timestamp gap between those detections exceeds `maxGapSeconds`
- **THEN** each missing sample in the run is assigned `status: 'unrecoverable'`, `x: null`,
  `y: null`, `score: 0`

#### Scenario: Out-of-order anchor timestamps are unrecoverable
- **WHEN** the computed gap between the before-anchor and after-anchor timestamps is negative
- **THEN** the run is treated as unrecoverable rather than interpolated with a fraction outside
  `[0, 1]`

### Requirement: No extrapolation past a missing anchor
The system SHALL NOT extrapolate a keypoint's position when a run of missing samples lacks a real
detection on one side (the start or end of the sequence), regardless of how short the run is.

#### Scenario: Leading gap with no prior anchor is unrecoverable
- **WHEN** a keypoint is missing from the start of the sample sequence up to its first present
  detection
- **THEN** every sample in that leading run is assigned `status: 'unrecoverable'`, even if the
  run is a single sample long

#### Scenario: Trailing gap with no following anchor is unrecoverable
- **WHEN** a keypoint is missing from its last present detection through the end of the sample
  sequence
- **THEN** every sample in that trailing run is assigned `status: 'unrecoverable'`, even if the
  run is a single sample long

### Requirement: Independent per-keypoint channels
The system SHALL gap-fill each of the 12 keypoints independently, as its own 1-D time series
across the sample sequence, rather than treating a frame as an atomic unit.

#### Scenario: One keypoint's gap does not affect another's status
- **WHEN** one keypoint is missing across a run of samples while a different keypoint remains
  present across those same samples
- **THEN** the present keypoint's status for those samples is unaffected by the other keypoint's
  gap

### Requirement: Fully-missing frames never throw
The system SHALL process a `PoseSample` whose `frame` is `null` without throwing, producing a
`RobustPoseFrame` with `source: 'missing'` and each keypoint resolved per the same interpolation
rule as any other missing classification.

#### Scenario: Null frame mid-sequence degrades gracefully
- **WHEN** a `PoseSample` in the middle of a sequence has `frame: null`, with present detections
  both before and within `maxGapSeconds` after it
- **THEN** `applyRobustness` does not throw, the corresponding output frame has
  `source: 'missing'`, and its keypoints are `'interpolated'` per the surrounding anchors

### Requirement: Output preserves one frame per input sample
The system SHALL produce exactly one `RobustPoseFrame` per input `PoseSample`, in the same order,
never dropping or merging frames.

#### Scenario: Output length equals input length
- **WHEN** `applyRobustness` is called with a sequence of `PoseSample`s of length `n`
- **THEN** the returned array has length `n`

### Requirement: Unrecoverable keypoints use a null sentinel, never a fabricated coordinate
The system SHALL represent an unrecoverable keypoint's position as `x: null, y: null`, never as
`(0, 0)` or any other fabricated coordinate, and SHALL never silently drop an unrecoverable
keypoint from the output.

#### Scenario: Unrecoverable keypoint has null coordinates
- **WHEN** a keypoint's status resolves to `'unrecoverable'`
- **THEN** its `x` and `y` fields are `null` and its `score` is `0`, and it is still present as
  one of the 12 entries in `RobustPoseFrame.keypoints`

### Requirement: Configurable threshold and window
The system SHALL expose `minKeypointConfidence` and `maxGapSeconds` as fields of an overridable
`RobustnessConfig`, defaulting to `0.3` and `0.5` respectively when no config is supplied.

#### Scenario: Default config applies when none is given
- **WHEN** `applyRobustness` is called without a `config` argument
- **THEN** it behaves as if called with `minKeypointConfidence: 0.3, maxGapSeconds: 0.5`

#### Scenario: Caller-supplied config overrides defaults
- **WHEN** `applyRobustness` is called with a `config` argument specifying different values
- **THEN** classification and interpolation use the supplied values instead of the defaults

### Requirement: Per-frame metric scale passes through unmodified
The system SHALL copy a sample's optional `PoseFrame.pixelsPerMeter` verbatim onto the
corresponding `RobustPoseFrame` as a required, nullable `pixelsPerMeter: number | null`, using
`null` wherever the sample carried no frame or the frame carried no scale. It SHALL NOT
interpolate, extrapolate, smooth, or otherwise synthesize a scale value for any frame, even where
it interpolates that frame's keypoint positions — a fabricated scale would silently corrupt every
real-world measurement derived from it, in a way a fabricated keypoint position does not, because
the scale is the conversion factor rather than the signal.

#### Scenario: A detected frame's scale reaches the robust frame
- **WHEN** a `PoseSample` carries a frame with a `pixelsPerMeter` value
- **THEN** the corresponding `RobustPoseFrame`'s `pixelsPerMeter` equals that exact value

#### Scenario: A missing frame yields a null scale
- **WHEN** a `PoseSample`'s `frame` is `null`
- **THEN** the corresponding `RobustPoseFrame`'s `pixelsPerMeter` is `null`

#### Scenario: An interpolated frame is never given a fabricated scale
- **WHEN** a sample's keypoints are gap-filled by interpolation from flanking detections that
  themselves carried `pixelsPerMeter` values
- **THEN** that frame's `pixelsPerMeter` is `null`, not a value interpolated from its neighbours

#### Scenario: A scale-less backend yields null throughout
- **WHEN** every sample's frame comes from a backend that does not measure scale
- **THEN** every `RobustPoseFrame` has `pixelsPerMeter: null`, and no other output field differs
  from what it would have been

