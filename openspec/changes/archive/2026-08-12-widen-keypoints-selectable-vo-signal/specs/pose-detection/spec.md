## MODIFIED Requirements

### Requirement: Pose frame type contract
The system SHALL define a `PoseFrame` type consisting of exactly a fixed-length, fixed-order
array of keypoints (the subset common to MoveNet/COCO and BlazePose naming: shoulders, elbows,
wrists, hips, knees, ankles, nose, and ears) and a video-relative timestamp, independent of any
specific pose-estimation library's types. A `PoseFrame` MAY additionally carry optional per-frame
metadata that only some backends can measure — currently `pixelsPerMeter`, a real-world scale
factor. Such a field SHALL be omitted entirely (the key absent, never present with an
`undefined` value) by any backend that does not measure it, so that a backend which measures
nothing produces exactly the same object it produced before the field existed.

#### Scenario: Fixed-length, fixed-order keypoints
- **WHEN** a `PoseFrame` is produced by any backend
- **THEN** it contains exactly one `Keypoint` entry for each name in `COMMON_KEYPOINT_NAMES` (15
  today), in that fixed order, never sparse

#### Scenario: Timestamp reflects video playback position
- **WHEN** a `PoseFrame` is produced for a given video frame
- **THEN** its `timestamp` field equals the source `HTMLVideoElement`'s `currentTime`, not
  wall-clock time, so it means the same thing for a live webcam stream and an uploaded file's
  playback position

#### Scenario: Optional metric scale is absent unless measured
- **WHEN** a `PoseFrame` is produced by a backend that does not measure real-world scale (for
  example MoveNet), or by a scale-measuring backend on a frame where the measurement was
  unavailable
- **THEN** the frame has no `pixelsPerMeter` key at all, rather than a `pixelsPerMeter` of
  `undefined`, `null`, or `0`

#### Scenario: A measured metric scale is a strictly positive finite number
- **WHEN** a `PoseFrame` does carry `pixelsPerMeter`
- **THEN** its value is a finite number strictly greater than zero, never `NaN`, `Infinity`, or a
  non-positive value

### Requirement: Common keypoint subset restricts backend surface
The system SHALL restrict `PoseFrame.keypoints` to the subset common to MoveNet/COCO and
BlazePose naming (`COMMON_KEYPOINT_NAMES`: shoulders, elbows, wrists, hips, knees, ankles, nose,
left ear, right ear — 15 entries), via a shared mapping helper reused by every backend, so that a
future BlazePose backend is a drop-in rather than a rewrite.

#### Scenario: Non-subset raw keypoints are dropped
- **WHEN** a backend's raw keypoint output includes names outside `COMMON_KEYPOINT_NAMES` (for
  example `left_eye` or `right_eye`)
- **THEN** the shared mapping helper omits them from the resulting `PoseFrame`

#### Scenario: Missing subset keypoints default to zero score
- **WHEN** a raw keypoint output is missing one of the names in `COMMON_KEYPOINT_NAMES`
- **THEN** the shared mapping helper fills that slot with `{ x: 0, y: 0, score: 0 }` rather than
  omitting it, preserving the fixed-length contract
