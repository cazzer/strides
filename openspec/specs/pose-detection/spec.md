# pose-detection Specification

## Purpose
Provide a backend-agnostic pose-detection abstraction — a stable `PoseFrame` type and a
`createDetector`/`PoseDetector` interface — so that downstream code (robustness, heuristics,
overlay rendering) depends only on this abstraction's output, never on
`@tensorflow-models/pose-detection` or MoveNet directly.
## Requirements
### Requirement: Pose frame type contract
The system SHALL define a `PoseFrame` type consisting of exactly a fixed-length, fixed-order
array of 12 keypoints (the subset common to MoveNet/COCO and BlazePose naming: shoulders,
elbows, wrists, hips, knees, ankles) and a video-relative timestamp, independent of any specific
pose-estimation library's types.

#### Scenario: Fixed-length, fixed-order keypoints
- **WHEN** a `PoseFrame` is produced by any backend
- **THEN** it contains exactly 12 `Keypoint` entries, one for each name in
  `COMMON_KEYPOINT_NAMES`, in that fixed order, never sparse

#### Scenario: Timestamp reflects video playback position
- **WHEN** a `PoseFrame` is produced for a given video frame
- **THEN** its `timestamp` field equals the source `HTMLVideoElement`'s `currentTime`, not
  wall-clock time, so it means the same thing for a live webcam stream and an uploaded file's
  playback position

### Requirement: Backend-agnostic detector abstraction
The system SHALL expose a `createDetector` factory that selects a pose-detection backend via a
single config parameter and returns a `PoseDetector` whose `estimatePose`/`dispose` methods are
the only API downstream code depends on.

#### Scenario: Backend selected by config, not code branching
- **WHEN** `createDetector({ backend: 'movenet' })` is called
- **THEN** it resolves to a `PoseDetector` backed by the MoveNet implementation without the
  caller branching on backend type anywhere in application code

#### Scenario: Unknown backend rejected
- **WHEN** `createDetector` is called with an unsupported `backend` value
- **THEN** it throws synchronously with a clear error message before any async work begins

### Requirement: No-detection distinct from low-confidence detection
The system SHALL distinguish "no person detected in frame" from "a person detected with
low-confidence keypoints" by returning `null` in the former case and a `PoseFrame` (carrying
per-keypoint scores) in the latter, so a future robustness layer can tell "nothing to analyze"
apart from "keep analyzing, filter by score."

#### Scenario: Empty pose result yields null
- **WHEN** the underlying model's pose estimation returns an empty array for a frame
- **THEN** `estimatePose` resolves to `null`, not a `PoseFrame` with zeroed-out keypoints

#### Scenario: Low-confidence result yields a PoseFrame
- **WHEN** the underlying model returns at least one pose with low per-keypoint scores
- **THEN** `estimatePose` resolves to a `PoseFrame` carrying those low scores, leaving
  score-thresholding to downstream consumers

### Requirement: MoveNet SinglePose Lightning backend
The system SHALL provide a MoveNet backend that runs SinglePose Lightning on the TF.js WebGL
backend and maps its raw output into the common `PoseFrame` shape.

#### Scenario: Detector initializes WebGL backend and SinglePose Lightning model
- **WHEN** the MoveNet backend's detector-creation function is called
- **THEN** it sets the TF.js backend to WebGL, awaits TF.js readiness, and creates a
  `pose-detection` detector for the MoveNet model using the SinglePose Lightning model type

#### Scenario: Same call estimates pose for both webcam and uploaded video
- **WHEN** `estimatePose(video)` is called with a live `srcObject`-backed video element or a
  `src`-backed uploaded video element
- **THEN** the same code path is used to estimate the pose, with no branching on video source
  type

#### Scenario: Resource cleanup
- **WHEN** `dispose()` is called on the MoveNet-backed `PoseDetector`
- **THEN** it delegates to the underlying TF.js detector's `dispose()`, releasing WebGL
  resources

### Requirement: Common keypoint subset restricts backend surface
The system SHALL restrict `PoseFrame.keypoints` to the 12-point subset common to MoveNet/COCO
and BlazePose naming, via a shared mapping helper reused by every backend, so that a future
BlazePose backend is a drop-in rather than a rewrite.

#### Scenario: Non-subset raw keypoints are dropped
- **WHEN** a backend's raw keypoint output includes names outside `COMMON_KEYPOINT_NAMES` (for
  example `nose` or `left_eye`)
- **THEN** the shared mapping helper omits them from the resulting `PoseFrame`

#### Scenario: Missing subset keypoints default to zero score
- **WHEN** a raw keypoint output is missing one of the 12 common names
- **THEN** the shared mapping helper fills that slot with `{ x: 0, y: 0, score: 0 }` rather than
  omitting it, preserving the fixed-length contract

