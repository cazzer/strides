## MODIFIED Requirements

### Requirement: Pose frame type contract
The system SHALL define a `PoseFrame` type consisting of exactly a fixed-length, fixed-order
array of 12 keypoints (the subset common to MoveNet/COCO and BlazePose naming: shoulders,
elbows, wrists, hips, knees, ankles) and a video-relative timestamp, independent of any specific
pose-estimation library's types. A `PoseFrame` MAY additionally carry optional per-frame
metadata that only some backends can measure — currently `pixelsPerMeter`, a real-world scale
factor. Such a field SHALL be omitted entirely (the key absent, never present with an
`undefined` value) by any backend that does not measure it, so that a backend which measures
nothing produces exactly the same object it produced before the field existed.

#### Scenario: Fixed-length, fixed-order keypoints
- **WHEN** a `PoseFrame` is produced by any backend
- **THEN** it contains exactly 12 `Keypoint` entries, one for each name in
  `COMMON_KEYPOINT_NAMES`, in that fixed order, never sparse

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

## ADDED Requirements

### Requirement: MediaPipe world-landmark metric scale
The MediaPipe Pose Landmarker backend SHALL compute a per-frame `pixelsPerMeter` scale as the
ratio of the pixel-space torso length to the world-space torso length, where torso length is the
distance from the shoulder midpoint (landmark indices 11 and 12) to the hip midpoint (landmark
indices 23 and 24), the pixel-space distance is the 2D distance measured in the same
already-denormalized pixel space as the frame's keypoints, and the world-space distance is the
**3D** (x, y, z) distance measured in `PoseLandmarkerResult.worldLandmarks[0]`. The world
landmarks SHALL be used for scale only and never as a positional signal, because they are
hip-centered — translation is removed by construction, so any body-translation measurement taken
from them would be identically zero.

#### Scenario: Scale is derived from the 3D world torso, not its xy projection
- **WHEN** the world shoulder midpoint and hip midpoint differ in `z` as well as `x`/`y`
- **THEN** the world torso length used for the scale is the full 3D distance including the `z`
  component, not the xy-projected distance

#### Scenario: Scale is omitted when world landmarks are unavailable
- **WHEN** a detection result has no `worldLandmarks`, or an empty `worldLandmarks` array
- **THEN** the produced `PoseFrame` omits `pixelsPerMeter` entirely, and every other field of the
  frame is unchanged from what it would have been

#### Scenario: Scale is omitted for a degenerate torso measurement
- **WHEN** the world-space shoulder and hip midpoints coincide (zero-length torso), or either
  torso measurement is not a finite number
- **THEN** the produced `PoseFrame` omits `pixelsPerMeter` rather than emitting `Infinity`, `NaN`,
  or `0`
