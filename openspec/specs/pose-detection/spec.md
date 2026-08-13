# pose-detection Specification

## Purpose
Provide a backend-agnostic pose-detection abstraction — a stable `PoseFrame` type and a
`createDetector`/`PoseDetector` interface — so that downstream code (robustness, heuristics,
overlay rendering) depends only on this abstraction's output, never on
`@tensorflow-models/pose-detection` or MoveNet directly.
## Requirements
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

### Requirement: MoveNet tracking-crop preprocessing

The system SHALL, when tracking-crop is enabled and a prior call produced a usable detection
(at least `minConfidentKeypoints` of the 15 `COMMON_KEYPOINT_NAMES` scoring at or above
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

### Requirement: Tracking-crop reacquisition loss falls back to full-frame detection

The system SHALL fall back to running MoveNet against the full, unmodified video frame — the
same call path used when nothing has ever been tracked — after `reacquisitionLossThreshold`
consecutive crop-mode calls fail to produce a usable detection, rather than continuing to crop
around a stale, no-longer-valid bounding box indefinitely.

#### Scenario: Sustained tracking loss falls back to full-frame detection

- **WHEN** `reacquisitionLossThreshold` consecutive crop-mode calls each fail to produce a usable
  detection (either no pose detected, or too few confident keypoints)
- **THEN** every subsequent call runs MoveNet against the full video frame, unchanged from the
  behavior of a never-tracked segment, until a full-frame call produces a usable detection again

#### Scenario: A single low-confidence frame does not drop tracking

- **WHEN** a crop-mode call fails to produce a usable detection, but fewer than
  `reacquisitionLossThreshold` consecutive such failures have occurred
- **THEN** the next call still runs in crop mode, using the most recently tracked bounding box

### Requirement: Tracking state does not leak across separate analysis runs

The system SHALL treat a call whose `video.currentTime` has dropped meaningfully below the
highest value seen so far on that detector instance as the start of a new analysis run, clearing
all tracking state before proceeding, since the app-level `PoseDetector` this backend implements
is created once and reused across every clip a user analyzes in a session — without this, a
bounding box tracked near the end of one clip would otherwise carry over and be cropped against
on a later, unrelated clip's opening frames.

#### Scenario: A new run's opening frames are not cropped against the previous run's tracked bbox

- **WHEN** tracking engaged during a previous run on this detector instance, and a subsequent
  call's `video.currentTime` drops meaningfully below the highest `currentTime` this instance has
  processed
- **THEN** that call and all tracking state are treated as a fresh cold start — no crop is
  computed from the previous run's bounding box

#### Scenario: Ordinary backward jitter within one run does not falsely trigger a reset

- **WHEN** a call's `video.currentTime` is at or only trivially below the highest value
  previously seen (not a meaningful drop)
- **THEN** tracking state is left untouched by this check

### Requirement: A never-tracked segment is behavior-identical to the untracked baseline

The system SHALL, for any segment where tracking-crop has not engaged — including the entire
clip when tracking-crop is disabled via configuration — call the underlying MoveNet detector's
`estimatePoses` with the video element directly, with no crop canvas, no coordinate remapping,
and no additional state, so this segment's behavior is provably unchanged from the pre-existing
full-frame-only implementation.

#### Scenario: A clip where tracking never engages behaves identically to today

- **WHEN** every call fails to produce a usable detection (or tracking-crop is configured
  disabled)
- **THEN** every call is `estimatePoses(video)` with no other arguments, matching the MoveNet
  backend's behavior before this capability existed

#### Scenario: Disabling tracking-crop is a total kill-switch

- **WHEN** `TrackingCropConfig.enabled` is `false`
- **THEN** no tracking state is read or written across calls, and every call runs the full-frame
  path regardless of what would otherwise have engaged or disengaged crop-mode tracking

### Requirement: Tracking-crop configuration is a single, overridable object

The system SHALL provide a `TrackingCropConfig` type with a `DEFAULT_TRACKING_CROP_CONFIG`, folded
into `PoseDetectorConfig`'s existing `trackingCrop` field and resolved by the existing
`resolvePoseDetectorConfig()`, so the existing development-only `window.__STRIDES_POSE_BACKEND_OVERRIDE__`
override (never read in a production build) covers tracking-crop alongside backend and
`movenetModelType` selection, rather than a separate override surface being introduced for this
one plane.

#### Scenario: No override present uses the default configuration

- **WHEN** a MoveNet detector is created with no development-only override present
- **THEN** its tracking-crop behavior matches `DEFAULT_TRACKING_CROP_CONFIG` exactly

#### Scenario: A development-build override is honored

- **WHEN** `window.__STRIDES_POSE_BACKEND_OVERRIDE__`'s `trackingCrop` field is set before
  detector creation, in a development build
- **THEN** the resolved `PoseDetectorConfig.trackingCrop` reflects the override, shallow-merged
  over `DEFAULT_TRACKING_CROP_CONFIG`

#### Scenario: The override has no effect in a production build

- **WHEN** `window.__STRIDES_POSE_BACKEND_OVERRIDE__` is set in a production build
- **THEN** it is not read, and detector creation uses `DEFAULT_TRACKING_CROP_CONFIG`

### Requirement: Scale-pass detector is dedicated, cached, and exempt from the backend override

The system SHALL provide the background scale pass its own detector accessor that lazily creates
a `PoseDetector` hardcoded to the `mediapipePoseLandmarker` backend, caches the instance for the
page lifetime (no per-pass creation or disposal), resolves to `null` — never throws — when
creation fails, and resets its pending state on failure so a later run can retry. The accessor
SHALL NOT read `resolvePoseDetectorConfig()` or the `__STRIDES_POSE_BACKEND_OVERRIDE__` window
override: that override selects the PRIMARY pass's backend only, and the scale pass's backend is
not configurable.

#### Scenario: One detector serves every scale pass on the page

- **WHEN** the scale-pass detector is requested for a second analysis run after a first run
  already created it
- **THEN** the cached instance is returned and the underlying `createDetector` is not called
  again

#### Scenario: The backend override does not leak into the scale pass

- **WHEN** `window.__STRIDES_POSE_BACKEND_OVERRIDE__` selects a non-MediaPipe backend and the
  scale-pass detector is requested
- **THEN** the detector is still created with `{ backend: 'mediapipePoseLandmarker' }`

#### Scenario: Creation failure degrades to null and permits a retry

- **WHEN** the scale-pass detector's creation rejects
- **THEN** the accessor resolves to `null` rather than throwing, and a subsequent request
  attempts creation again instead of returning a cached failure

