## ADDED Requirements

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
