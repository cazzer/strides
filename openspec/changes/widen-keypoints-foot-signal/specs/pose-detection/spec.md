## MODIFIED Requirements

### Requirement: Pose frame type contract
The system SHALL define a `PoseFrame` type consisting of exactly a fixed-length, fixed-order
array of keypoints — the subset common to MoveNet/COCO and BlazePose naming (shoulders, elbows,
wrists, hips, knees, ankles, nose, and ears), widened with four BlazePose/MediaPipe-only foot
keypoints (heel and foot index, each side) that MoveNet/PoseNet's COCO-17 topology cannot produce
— and a video-relative timestamp, independent of any specific pose-estimation library's types. A
`PoseFrame` MAY additionally carry optional per-frame metadata that only some backends can
measure — currently `pixelsPerMeter`, a real-world scale factor. Such a field SHALL be omitted
entirely (the key absent, never present with an `undefined` value) by any backend that does not
measure it, so that a backend which measures nothing produces exactly the same object it produced
before the field existed.

#### Scenario: Fixed-length, fixed-order keypoints
- **WHEN** a `PoseFrame` is produced by any backend
- **THEN** it contains exactly one `Keypoint` entry for each name in `COMMON_KEYPOINT_NAMES` (19
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
The system SHALL restrict `PoseFrame.keypoints` to a fixed working keypoint set
(`COMMON_KEYPOINT_NAMES`: shoulders, elbows, wrists, hips, knees, ankles, nose, left ear, right
ear, left heel, right heel, left foot index, right foot index — 19 entries), via a shared mapping
helper reused by every backend, so that a future BlazePose backend is a drop-in rather than a
rewrite. Fifteen of these names are common to MoveNet/COCO and BlazePose naming; the four foot
names (heel, foot index, each side) are BlazePose/MediaPipe-only — no COCO-based backend
(MoveNet, PoseNet) can natively produce them, and the shared mapping helper's missing-keypoint
default (below) is what lets those backends carry the widened set without special-casing it.

#### Scenario: Non-subset raw keypoints are dropped
- **WHEN** a backend's raw keypoint output includes names outside `COMMON_KEYPOINT_NAMES` (for
  example `left_eye` or `right_eye`)
- **THEN** the shared mapping helper omits them from the resulting `PoseFrame`

#### Scenario: Missing subset keypoints default to zero score
- **WHEN** a raw keypoint output is missing one of the names in `COMMON_KEYPOINT_NAMES` — for
  example every MoveNet/PoseNet frame, for the four foot-only names
- **THEN** the shared mapping helper fills that slot with `{ x: 0, y: 0, score: 0 }` rather than
  omitting it, preserving the fixed-length contract

### Requirement: MoveNet tracking-crop preprocessing

The system SHALL, when tracking-crop is enabled and a prior call produced a usable detection
(at least `minConfidentKeypoints` of the 19 `COMMON_KEYPOINT_NAMES` scoring at or above
`minKeypointConfidence`), run the next call's MoveNet inference against a padded, square crop of
the source video centered on the prior detection's bounding box — drawn into a reusable
off-screen canvas sized to the active model variant's own input resolution — remapping the
returned keypoints back into source-video pixel coordinates, rather than always running
inference against the full video frame.

#### Scenario: A usable detection engages crop-mode tracking on the next call

- **WHEN** a call's mapped `PoseFrame` has at least `minConfidentKeypoints` keypoints scoring at
  or above `minKeypointConfidence`
- **THEN** the next `estimatePose` call runs MoveNet against a cropped/upscaled canvas instead of
  the full video frame, and the returned `PoseFrame`'s keypoint coordinates are in source-video
  pixel space, matching what a full-frame call would have produced for the same detected
  position

#### Scenario: The crop is square, padded, and stays within frame bounds

- **WHEN** a crop rectangle is computed from a tracked bounding box
- **THEN** its side length is the larger of the box's width/height multiplied by
  `paddingMultiplier`, floored at `minCropSidePx` and capped at the smaller of the video's width
  or height, and its position is shifted (never shrunk) so the crop stays within
  `[0, frameWidth] × [0, frameHeight]`
