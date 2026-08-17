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
wrists, hips, knees, ankles, nose, and ears) and a media-relative timestamp, independent of any
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
- **WHEN** a `PoseFrame` is produced for a given frame
- **THEN** its `timestamp` field is in seconds on the producing clip's own media clock, not
  wall-clock time, so it means the same thing for a live webcam stream, an uploaded file's
  playback position, and a WebCodecs-decoded frame alike — sourced from
  `HTMLVideoElement.currentTime`/`requestVideoFrameCallback`'s `metadata.mediaTime` on the
  `<video>`-playback sampling path, or from a decoded `VideoFrame.timestamp` (converted from
  microseconds to seconds) on the WebCodecs sequential-decode sampling path

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
the only API downstream code depends on. `estimatePose` SHALL take a `PoseFrameSource` — `{
image: HTMLVideoElement | HTMLCanvasElement, timestampSec: number, width: number, height: number
}` — rather than a concrete `HTMLVideoElement`, so that every backend can be driven by either the
`<video>`-playback sampling path (`image` is the canonical video element) or the WebCodecs
sequential-decode sampling path (`image` is a reusable off-screen canvas a decoded `VideoFrame`
was drawn onto) through the identical call, with no backend branching on which path produced the
frame.

#### Scenario: Backend selected by config, not code branching
- **WHEN** `createDetector({ backend: 'movenet' })` is called
- **THEN** it resolves to a `PoseDetector` backed by the MoveNet implementation without the
  caller branching on backend type anywhere in application code

#### Scenario: Unknown backend rejected
- **WHEN** `createDetector` is called with an unsupported `backend` value
- **THEN** it throws synchronously with a clear error message before any async work begins

#### Scenario: The same detector call handles a video element or an off-screen canvas identically
- **WHEN** `estimatePose` is called with a `PoseFrameSource` whose `image` is the canonical
  `<video>` element (the playback sampling path) or with a `PoseFrameSource` whose `image` is an
  off-screen canvas a decoded `VideoFrame` was drawn onto (the sequential-decode sampling path)
- **THEN** the same backend code path handles both, reading pixels from `source.image` and
  metadata from `source.timestampSec`/`source.width`/`source.height` rather than from any
  `HTMLVideoElement`-specific property, and produces a `PoseFrame` in the same shape either way

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

### Requirement: Tracking-crop reacquisition loss falls back to full-frame detection

The system SHALL fall back to running MoveNet against the full, unmodified video frame — the
same call path used when nothing has ever been tracked — after `reacquisitionLossThreshold`
consecutive crop-mode calls fail to produce a usable detection, rather than continuing to crop
around a stale, no-longer-valid bounding box indefinitely. When this fallback is reached, the
first full-frame call after the threshold is met is a multi-pose reacquisition call (see "Multi-
pose reacquisition applies regardless of tracking-crop configuration"), not a plain single-pose
call, so the fallback has a chance to reselect the same person rather than whichever person the
single-pose model's own internal saliency happens to land on next.

#### Scenario: Sustained tracking loss falls back to full-frame detection

- **WHEN** `reacquisitionLossThreshold` consecutive crop-mode calls each fail to produce a usable
  detection (either no pose detected, or too few confident keypoints)
- **THEN** the next call is a multi-pose reacquisition call scored by continuity against the last
  known bounding box; if it fails to select a usable candidate, every call after that runs the
  ordinary full-frame single-pose path, unchanged from the behavior of a never-tracked segment,
  until tracking re-engages; if it succeeds, a bounded settle-in window of crop-mode calls (see
  "Settle-in window follows a successful multi-pose selection event") follows immediately
  regardless of `TrackingCropConfig.enabled`, after which ordinary tracking (full-frame or
  continuously cropped, per `TrackingCropConfig.enabled`) resumes

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

The system SHALL, for any segment where the CONTINUOUS whole-clip tracking-crop optimization has
not engaged — including the entire clip when tracking-crop is disabled via configuration — call
the underlying MoveNet detector's `estimatePoses` with the video source directly, with no crop
canvas and no coordinate remapping, so this segment's behavior is provably unchanged from the
pre-existing full-frame-only implementation.

That call SHALL supply the frame's own timestamp, in milliseconds, as `estimatePoses`' third
argument, in the same units the crop-mode call site already uses. The underlying model applies
its built-in per-keypoint temporal smoothing only when a timestamp is available, and derives one
implicitly only when the image source exposes `currentTime` — so omitting it silently disables
smoothing for any source that is not an `HTMLVideoElement`, including the reusable canvas the
sequential-decode sampler draws into. Supplying it explicitly makes the full-frame path's
smoothing behavior identical regardless of which sampler produced the frame, and matches what the
video-element source produced implicitly before the sequential-decode sampler became the default.

This guarantee covers the continuous cropped-canvas optimization only: it does NOT extend to (a)
the multi-pose acquisition/reacquisition/re-verification path itself (see "Multi-pose acquisition
on the first detection of a run", "Multi-pose reacquisition applies regardless of tracking-crop
configuration", and "Periodic re-verification during steady-state tracking"), which runs at
acquisition, reacquisition, and periodic re-verification moments independent of whether
tracking-crop is enabled, nor (b) the bounded settle-in window of crop-mode calls that follows a
successful one of those events (see "Settle-in window follows a successful multi-pose selection
event"), which is this capability's own mechanism and is likewise independent of
`TrackingCropConfig.enabled`.

The combined kill-switch path — tracking-crop disabled AND person-of-interest disabled — is
exempt from the timestamp requirement above and SHALL continue to call `estimatePoses` with the
image source as its only argument. That path performs no new-run reset of the underlying
detector, so supplying timestamps there would hand the model's smoothing filter a non-monotonic
series across separate analysis runs; it exists to reproduce pre-capability behavior exactly, and
that includes deriving a timestamp only when the source itself carries one.

#### Scenario: A clip where tracking never engages behaves identically to today

- **WHEN** every call fails to produce a usable detection (or tracking-crop is configured
  disabled), AND no acquisition/reacquisition/re-verification event has ever succeeded (so no
  settle-in window is ever active)
- **THEN** every such call is `estimatePoses(videoSource, undefined, timestampMs)` with no crop
  canvas and no coordinate remapping, matching the MoveNet backend's full-frame behavior

#### Scenario: Disabling tracking-crop is a total kill-switch

- **WHEN** `TrackingCropConfig.enabled` is `false`
- **THEN** no crop canvas is ever used for the CONTINUOUS whole-clip crop optimization, and no
  crop-mode tracking state tied to that optimization is read or written across calls — every call
  outside an acquisition/reacquisition/re-verification moment, and outside any settle-in window
  following one, runs the full-frame path regardless of what would otherwise have engaged or
  disengaged crop-mode tracking — but the multi-pose acquisition/reacquisition/re-verification
  path still runs at the moments it is defined to run, and a bounded settle-in window of crop-mode
  calls (see "Settle-in window follows a successful multi-pose selection event") still follows a
  successful one of those events regardless of this config value, since that window is this
  capability's own mechanism, not the continuous whole-clip optimization `TrackingCropConfig`
  gates

#### Scenario: The combined kill-switch path passes no timestamp

- **WHEN** both `TrackingCropConfig.enabled` and `PersonOfInterestConfig.enabled` are `false`
- **THEN** every call is `estimatePoses(imageSource)` with no further arguments, byte-identical to
  this backend's behavior before the tracking-crop and person-of-interest capabilities existed

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

### Requirement: Multi-pose acquisition on the first detection of a run

The system SHALL, for the first call of an analysis run that has not yet produced any usable
detection (no prior bounding box exists for this run), run a multi-pose detection pass
(`MULTIPOSE_LIGHTNING`) instead of the ordinary single-pose call, and select among the returned
candidate poses using an acquisition heuristic scored by each candidate's bounding-box area
weighted by its mean keypoint confidence. The selected candidate's keypoints are mapped to the
resulting `PoseFrame`, and its bounding box seeds tracking state for subsequent calls exactly as
a usable single-pose detection would.

#### Scenario: Multiple people present at first detection

- **WHEN** the first successful multi-pose acquisition call returns more than one candidate pose
- **THEN** the candidate with the highest bbox-area-weighted-by-confidence score is selected, and
  every other candidate is discarded

#### Scenario: Exactly one person present at first detection

- **WHEN** the first successful multi-pose acquisition call returns exactly one candidate pose
- **THEN** that candidate is selected, producing a `PoseFrame` equivalent to what the single-pose
  path would have produced for the same person

#### Scenario: No candidates returned

- **WHEN** a multi-pose acquisition call returns zero candidate poses
- **THEN** `estimatePose` resolves to `null` for that call, and the next call is also treated as
  an acquisition attempt (no tracking state was seeded)

### Requirement: Multi-pose reacquisition applies regardless of tracking-crop configuration

The system SHALL treat sustained loss of confidence in the current tracked anchor as a
reacquisition trigger independent of whether `TrackingCropConfig.enabled` is `true` or `false` —
today, loss is only ever counted in crop mode, so the default (`enabled: false`) configuration
has no loss signal to trigger on at all. When the trigger fires, the system SHALL run a
multi-pose detection pass and select among the returned candidates using a reacquisition
heuristic scored by IoU/proximity continuity against the last known bounding box, rather than
allowing the next full-frame single-pose call to land on whichever person the model's own
internal saliency happens to prefer.

#### Scenario: Sustained low confidence with tracking-crop disabled triggers reacquisition

- **WHEN** `TrackingCropConfig.enabled` is `false` and a threshold number of consecutive calls
  produce a detection with too few confident keypoints to count as usable
- **THEN** the next call is a multi-pose reacquisition call, not an ordinary full-frame
  single-pose call

#### Scenario: The previously tracked person is favored over a more prominent bystander

- **WHEN** a multi-pose reacquisition call returns multiple candidates, one of which overlaps or
  sits near the last known bounding box and another of which has a larger bbox-area-weighted-by-
  confidence score
- **THEN** the candidate scored by continuity against the last known bounding box is selected,
  not the candidate the acquisition heuristic alone would prefer

#### Scenario: No candidate matches the last known position

- **WHEN** a multi-pose reacquisition call returns candidates, none of which meaningfully overlap
  or sit near the last known bounding box
- **THEN** the system falls back to the acquisition heuristic (bbox area weighted by mean
  keypoint confidence) among the returned candidates, treating this call as a fresh acquisition

### Requirement: Steady-state tracking pays for a multi-pose call only at bounded, identifiable moments

The system SHALL NOT run a multi-pose detection pass on any call where a confident anchor already
exists, the reacquisition trigger has not fired, and periodic re-verification is not yet due (see
"Periodic re-verification during steady-state tracking") — those calls remain the existing
single-pose call (optionally wrapped by tracking-crop or, within a settle-in window, by the
settle-in window's own crop-mode call), unchanged, so the multi-pose pass's additional cost is
paid only at the moments identity is genuinely ambiguous or a periodic check is due, not on every
call.

#### Scenario: Confident, recently-verified steady-state tracking issues no multi-pose call

- **WHEN** a call's tracked anchor is confident, the reacquisition trigger has not fired, and
  fewer than `REVERIFICATION_INTERVAL_FRAMES` calls have elapsed since the last (re)acquisition or
  re-verification event
- **THEN** only the ordinary single-pose call is issued for that frame (optionally in crop mode,
  per `TrackingCropConfig.enabled` or an active settle-in window); no multi-pose model is invoked

### Requirement: Settle-in window follows a multi-pose selection event that carries new identity information

The system SHALL, for `POST_ACQUISITION_SETTLE_FRAMES` calls immediately following any call where
a multi-pose acquisition selects a usable candidate, OR a reacquisition/periodic-re-verification
event selects a usable candidate that is NOT continuous with the last known anchor (its IoU and
proximity against that anchor both failed, so selection fell through to the acquisition
heuristic), run those calls in crop mode around the selected bounding box — using the same
crop-canvas mechanism `TrackingCropConfig`-driven crop-mode tracking already uses
(`computeCropRect`, the reusable crop canvas, remapping returned keypoints back to source-video
pixel space) — independent of `TrackingCropConfig.enabled`. A reacquisition or periodic
re-verification event whose selected candidate IS continuous with the last known anchor does NOT
engage or restart this window: continuity confirms the single-pose detector was already tracking
the right person, so no new identity information exists to carry forward, and forcing extra
crop-mode calls (and, per "Multi-pose reacquisition applies regardless of tracking-crop
configuration" and "Periodic re-verification during steady-state tracking", resetting the
single-pose detector's internal state) in that case would only discard working tracking
continuity for no benefit. Each settle-in call re-derives the tracked bounding box from its own
fresh detection exactly as ordinary crop-mode steady-state tracking already does, so tracking
state never goes stale during the window; the window's purpose is to give the single-pose
detector a run of calls actually centered on the just-identified person before any continuous
whole-clip crop optimization (or lack thereof) takes over, since nothing about a multi-pose
selection otherwise carries forward into the single-pose detector's own next call.

#### Scenario: A successful acquisition engages the settle-in window

- **WHEN** a multi-pose acquisition call selects a usable candidate
- **THEN** the next `POST_ACQUISITION_SETTLE_FRAMES` calls run in crop mode around the selected
  bounding box, regardless of `TrackingCropConfig.enabled`

#### Scenario: A non-continuous reacquisition or re-verification engages the settle-in window

- **WHEN** a multi-pose reacquisition or periodic-re-verification call (confidence-triggered or
  periodic) selects a usable candidate that is NOT continuous with the last known anchor
- **THEN** the next `POST_ACQUISITION_SETTLE_FRAMES` calls run in crop mode around the newly
  selected bounding box, regardless of `TrackingCropConfig.enabled`

#### Scenario: A continuous reacquisition or re-verification does not engage the settle-in window

- **WHEN** a multi-pose reacquisition or periodic-re-verification call selects a usable candidate
  that IS continuous with the last known anchor (matched by IoU or proximity)
- **THEN** no settle-in window starts or restarts — the next call runs ordinary framing (crop mode
  only if `TrackingCropConfig.enabled` or an already-active settle-in window from an earlier,
  non-continuous event says so, full-frame otherwise), unaffected by this selection beyond the
  anchor's bounding box itself being updated

#### Scenario: The settle-in window is a no-op when tracking-crop is already continuously enabled

- **WHEN** `TrackingCropConfig.enabled` is `true` at the moment a settle-in window would otherwise
  engage
- **THEN** no additional crop-mode calls are triggered beyond what the continuous whole-clip
  optimization already runs — the settle-in window never causes observably different behavior in
  this configuration

#### Scenario: The settle-in window expires after its configured length

- **WHEN** `POST_ACQUISITION_SETTLE_FRAMES` calls have elapsed since the settle-in window last
  engaged, with no intervening acquisition/reacquisition/re-verification event to restart it
- **THEN** subsequent calls return to ordinary framing — crop mode only if
  `TrackingCropConfig.enabled`, full-frame otherwise — until the window is next triggered

### Requirement: Periodic re-verification during steady-state tracking

The system SHALL, every `REVERIFICATION_INTERVAL_FRAMES` calls since the last (re)acquisition or
re-verification event, run a multi-pose detection pass and score the returned candidates for
continuity against the current tracked anchor (the same heuristic and code path confidence-
triggered reacquisition already uses), even when the anchor's confidence has not dropped below
the usability gate — since MoveNet's own saliency can drift smoothly onto a different person
without the confidence-based reacquisition trigger ever firing. A continuous match resets the
re-verification interval counter and updates the tracked bounding box, but does NOT reset the
single-pose detector's internal state or engage a settle-in window (see "Settle-in window follows
a multi-pose selection event that carries new identity information") — no new identity
information exists to act on. A non-continuous match (the multi-pose pass disagrees with what the
single-pose detector has been tracking) is treated exactly as a non-continuous confidence-
triggered reacquisition already is: the underlying single-pose detector's internal state is reset,
the anchor is re-seeded from the newly-selected candidate, and a settle-in window begins. An empty
or not-usable periodic check is a strict no-op on every piece of tracking state except the
re-verification interval counter itself, AND falls through to the ordinary, already-in-progress
single-pose call for that same sampled frame rather than resolving to no detection at all — it
must never be able to degrade steady-state tracking that was already working, in either the
tracking state it leaves behind or the frame it produces for that call.

#### Scenario: The periodic interval triggers a re-verification call

- **WHEN** `REVERIFICATION_INTERVAL_FRAMES` calls have elapsed since the last (re)acquisition or
  re-verification event, and the anchor is confident (the confidence-triggered reacquisition
  trigger has not fired)
- **THEN** the next call is a multi-pose re-verification call scored by continuity against the
  current anchor, not an ordinary single-pose call

#### Scenario: A continuous re-verification match resets the interval without disrupting tracking

- **WHEN** a periodic re-verification call selects a candidate continuous with the current anchor
  (matched by IoU or proximity)
- **THEN** the re-verification interval counter resets and the tracked bounding box updates to the
  reconfirmed candidate, but the single-pose detector's internal state is NOT reset and no
  settle-in window engages — steady-state tracking continues otherwise unaffected

#### Scenario: A non-continuous re-verification match corrects tracking onto the right person

- **WHEN** a periodic re-verification call's candidates have no meaningful IoU or proximity match
  against the current anchor, so the selection falls through to the acquisition heuristic
- **THEN** the underlying single-pose detector's internal state is reset, the anchor is re-seeded
  from the newly-selected candidate, and a settle-in window begins around it — the same treatment
  a non-continuous confidence-triggered reacquisition already receives

#### Scenario: An empty or unusable periodic check does not degrade existing tracking

- **WHEN** a periodic re-verification call returns zero candidates, or candidates none of which
  clear the usability gate
- **THEN** the current anchor, its loss counters, and the give-up budget are left completely
  untouched, and the call falls through to the ordinary, already-in-progress single-pose call for
  that same sampled frame instead of resolving to no detection — only the re-verification interval
  counter resets, so the next periodic check is attempted after another full interval rather than
  every subsequent call, and the extra multi-pose model invocation is paid only on this rare failed
  check, not on every periodic tick

### Requirement: WebCodecs sequential-decode sampling feasibility
The system SHALL determine, per loaded clip, whether that clip can be sampled via WebCodecs
sequential decode instead of `<video>`-playback sampling, via a pure feasibility check that never
throws: `VideoDecoder` must exist in the browser, a source blob must be present, the blob must
demux as an MP4 with a video track, and `VideoDecoder.isConfigSupported` must report the demuxed
codec as decodable. Any failure at any gate SHALL resolve to `false`, never an exception.

#### Scenario: A clean, decodable MP4 clip is eligible
- **WHEN** the feasibility check runs against a well-formed MP4 blob whose video track's codec
  `VideoDecoder.isConfigSupported` reports as supported
- **THEN** the check resolves `true`

#### Scenario: A non-MP4 source is not eligible
- **WHEN** the feasibility check runs against a WebM blob (for example, one produced by the
  webcam-recording path)
- **THEN** the check resolves `false` without attempting a full decode

#### Scenario: No source blob is not eligible
- **WHEN** the feasibility check runs with no blob available
- **THEN** the check resolves `false`

#### Scenario: An unsupported codec is not eligible
- **WHEN** the blob demuxes successfully but `VideoDecoder.isConfigSupported` reports the
  resulting codec as unsupported in the current browser
- **THEN** the check resolves `false`

### Requirement: MP4 demuxing for sequential decode
The system SHALL provide a pure MP4-demuxing function that, given a complete file's bytes,
extracts its first video track's codec, out-of-band decoder configuration bytes (when present),
pixel dimensions, average frame rate, duration, and every sample — in **decode order**, each
carrying its raw bitstream data, presentation timestamp, duration, and keyframe flag — without
requiring any DOM or WebCodecs global, so it is testable against real file bytes with no browser
involved. The function SHALL never hang: for any input that is not a demuxable MP4 with a video
track, it SHALL reject rather than leave its result unsettled.

#### Scenario: A well-formed MP4's track is fully demuxed
- **WHEN** demuxing runs against a complete, well-formed MP4 file's bytes
- **THEN** the result includes the video track's codec string, pixel dimensions, an average frame
  rate, the track's duration in seconds, and one sample per encoded frame, each with non-empty
  data and a positive duration

#### Scenario: Samples are returned in decode order, not presentation order
- **WHEN** the source file's video track uses frame reordering (B-frames), such that presentation
  order differs from decode order
- **THEN** the returned samples are ordered by decode order (matching what `VideoDecoder.decode()`
  requires), and their presentation timestamps are not necessarily monotonically increasing across
  the array

#### Scenario: Malformed or non-MP4 input rejects rather than hanging
- **WHEN** demuxing runs against input that is empty, uses a different container format, is
  truncated before a complete `moov` box, or otherwise cannot produce a usable video track
- **THEN** the returned promise rejects, and does so without ever leaving the caller waiting
  indefinitely

### Requirement: Frame-rate-aware sequential sampling density
The system SHALL provide a stateful frame-selection function for the sequential-decode path that
selects decoded frames by presentation-time bucket (`floor(presentationTimeSec *
targetSamplesPerSecond)`) rather than by a fixed frame-index stride, so that sampling density
stays consistent in real time regardless of variation in the source's frame spacing. A
`targetSamplesPerSecond` of `null` SHALL select every decoded frame.

#### Scenario: A null target selects every frame
- **WHEN** the frame selector is configured with `targetSamplesPerSecond: null`
- **THEN** every frame presented to it is selected

#### Scenario: A numeric target downsamples by time, not by index
- **WHEN** the frame selector is configured with a numeric `targetSamplesPerSecond` lower than the
  source's actual frame rate
- **THEN** it selects the first frame to land in each new presentation-time bucket, and this
  selection is determined by each frame's timestamp, not by its position in the sequence — so
  variable frame spacing does not bias which portions of the clip get sampled more densely

#### Scenario: A target at or above the source frame rate selects (nearly) every frame
- **WHEN** the frame selector's configured `targetSamplesPerSecond` meets or exceeds the source's
  actual frame rate
- **THEN** every, or nearly every, presented frame lands in a new bucket and is selected

### Requirement: Sequential-decode VideoFrame lifecycle discipline
The system SHALL close every decoded `VideoFrame` the sequential-decode path's frame selector
does not select immediately, within the same synchronous callback that received it from the
decoder, and SHALL hold at most one selected `VideoFrame` open at a time end-to-end — closing a
selected frame immediately after it has been drawn to a shared canvas, before requesting pose
detection for it — so that decoding an entire clip never accumulates open `VideoFrame` resources
proportional to the clip's total frame count.

#### Scenario: An unselected frame is closed immediately
- **WHEN** a decoded frame is presented to the sequential-decode path and the frame selector does
  not select it
- **THEN** that frame is closed before the decoder produces its next output, without ever being
  handed to a consumer

#### Scenario: A selected frame is closed before detection begins
- **WHEN** a decoded frame is selected
- **THEN** it is drawn to the shared canvas and closed before pose detection for that frame is
  requested — no `VideoFrame` remains open while awaiting a detection result

#### Scenario: Decoding never runs far ahead of consumption
- **WHEN** the pose detector is slower than the decoder can produce selected frames
- **THEN** the decoder's own encoded-chunk feed is throttled so that neither its internal decode
  queue nor the selected-frame handoff queue grows without bound

### Requirement: Adaptive sampling dispatch
The system SHALL provide a single sampling entry point that dispatches, per analysis run, to
either the WebCodecs sequential-decode sampler or the existing `<video>`-playback sampler, based
on a feasibility result resolved before that run starts — never by probing feasibility as part of
starting the run itself. Both samplers SHALL produce the identical output contract (a promise of
pose samples, plus a handle exposing a `stop()` that resolves the promise with whatever was
collected so far), so that every downstream consumer of a completed run's samples requires no
knowledge of which sampler produced them.

#### Scenario: A feasible clip is sampled sequentially
- **WHEN** an analysis run starts for a clip the feasibility check already resolved as eligible
- **THEN** sampling is dispatched to the WebCodecs sequential-decode sampler

#### Scenario: An ineligible or not-yet-resolved clip falls back to playback sampling
- **WHEN** an analysis run starts for a clip the feasibility check resolved as ineligible, or
  before that resolution is available
- **THEN** sampling is dispatched to the existing `<video>`-playback sampler, with no difference
  in behavior from a run where sequential decode was never attempted

#### Scenario: Stopping either sampler mid-run resolves with partial results
- **WHEN** a run in progress is stopped, regardless of which sampler is active
- **THEN** the sampler's promise resolves with whatever samples were collected up to that point,
  never left pending and never rejected solely because of the stop

### Requirement: Steady-state anchor acceptance requires continuity with the existing anchor

The system SHALL, on an ordinary steady-state call (one that did not dispatch a multi-pose
acquisition, reacquisition, or re-verification pass) that produces a usable detection while a
person-of-interest anchor already exists, accept that detection's bounding box as the new anchor
only if it is continuous with the existing anchor in BOTH position and scale. A usable detection
that is not continuous SHALL NOT become the anchor, SHALL NOT reset the reacquisition-loss
counter or any multi-pose episode state, and SHALL instead be counted as a tracking loss, so that
`reacquisitionLossThreshold` can be reached and the multi-pose reacquisition path — which scores
continuity across every simultaneously visible candidate — is given the chance to recover.

Position continuity SHALL be satisfied when the derived bounding box has non-zero
intersection-over-union with the existing anchor, OR when the distance between the two boxes'
centers is within `maxCenterSpeedSidesPerSecond` multiplied by the anchor's own side
(`max(width, height)`) and by the elapsed time since the previous call. Scale continuity SHALL be
satisfied when the ratio of the derived box's area to the anchor's area lies within
`[1 / maxAreaRatio, maxAreaRatio]`.

The call SHALL still return the `PoseFrame` it detected, whether or not the gate accepted it —
this gate governs which person the backend considers tracked, not whether a frame is emitted.

#### Scenario: A confidently detected bystander does not steal the anchor

- **WHEN** a steady-state call returns a usable detection whose bounding box neither overlaps the
  existing anchor nor lies within the elapsed-time-scaled distance bound, or whose area differs
  from the anchor's by more than `maxAreaRatio`
- **THEN** the anchor is left unchanged, the reacquisition-loss counter is incremented rather than
  reset, and the detected `PoseFrame` is still returned to the caller

#### Scenario: Sustained rejection reaches the existing reacquisition path

- **WHEN** `reacquisitionLossThreshold` consecutive steady-state calls each produce a detection
  the continuity gate rejects
- **THEN** the anchor is stale and the next call dispatches a multi-pose reacquisition scored by
  continuity against the last known bounding box, exactly as it does for any other sustained
  tracking loss

#### Scenario: Ordinary frame-to-frame motion is unaffected

- **WHEN** a steady-state call's derived bounding box overlaps the existing anchor at all, and its
  area is within `maxAreaRatio` of the anchor's
- **THEN** it is accepted as the new anchor and every counter is reset, exactly as before this
  gate existed

#### Scenario: The gate does not apply when there is nothing to be continuous with

- **WHEN** no anchor currently exists, or the person-of-interest capability is disabled, or the
  run has suspended person-of-interest disambiguation after exhausting its reacquisition budget
- **THEN** the first usable detection is accepted as the anchor unconditionally, as it was before
  this gate existed

#### Scenario: A settle-in call is held to the same continuity requirement

- **WHEN** a call inside the bounded settle-in window following a multi-pose selection event
  produces a usable detection
- **THEN** it is subject to the same continuity gate, scored against the just-selected anchor

### Requirement: A periodic re-verification match claiming continuity must be scale-plausible

The system SHALL, when a periodic re-verification pass selects a candidate whose selection was
scored as CONTINUOUS with the existing anchor, additionally require that candidate's bounding-box
area to lie within `[1 / maxAreaRatio, maxAreaRatio]` of the anchor's before adopting its box.
A claimed-continuous selection failing that check SHALL be treated exactly as the existing "raw
candidates but none usable during a periodic check" case: the anchor, the reacquisition-loss
counter, and every multi-pose episode counter are left untouched, only the re-verification
interval resets, and the call falls through to the ordinary single-pose call for that same frame.

The selection heuristic's own continuity test is intersection-over-union and centre proximity
only, with no scale term, so a candidate overlapping the anchor is scored continuous however
differently sized it is — and then replaces the anchor with its own box. A collapsed anchor is
worse than no gate at all, because the steady-state continuity gate then defends the collapsed box
and begins rejecting genuine full-size detections of the real subject.

This requirement SHALL NOT extend to a selection scored as NON-continuous. That case is an
explicit "the tracked person is gone, here is the salient one now" switch, which is the purpose
periodic re-verification exists to serve; a large scale change is expected there and is usually
the very reason the switch is happening.

#### Scenario: An overlapping but far smaller re-verification match does not collapse the anchor

- **WHEN** a periodic re-verification pass selects a candidate scored continuous with the anchor,
  whose bounding-box area differs from the anchor's by more than `maxAreaRatio`
- **THEN** the anchor is unchanged, no settle-in window starts, the underlying detector is not
  reset, the re-verification interval resets, and the call falls through to the ordinary
  single-pose call for that same frame

#### Scenario: A deliberate non-continuous identity switch is still allowed at any scale

- **WHEN** a periodic re-verification pass selects a candidate scored NON-continuous with the
  anchor, at any bounding-box area
- **THEN** it re-seeds the anchor, resets the underlying detector, and starts a settle-in window,
  exactly as it does when this gate is disabled

### Requirement: Anchor continuity gate is configurable through the existing backend override

The system SHALL expose the continuity gate's kill switch and both of its thresholds as a nested
`continuityGate` object on `PersonOfInterestConfig` — `enabled`,
`maxCenterSpeedSidesPerSecond`, and `maxAreaRatio` — resolved by the existing
`resolvePoseDetectorConfig()` so the development-only `window.__STRIDES_POSE_BACKEND_OVERRIDE__`
surface covers it alongside backend, model variant, tracking-crop, and person-of-interest
selection, rather than introducing a separate override surface. A partial override of the nested
object SHALL merge field-by-field over the defaults rather than replacing the whole object.

#### Scenario: The gate can be disabled without disabling multi-pose dispatch

- **WHEN** `personOfInterest.continuityGate.enabled` is `false` while
  `personOfInterest.enabled` is `true`
- **THEN** steady-state anchor acceptance behaves as it did before this gate existed, while
  multi-pose acquisition, reacquisition, and periodic re-verification still run

#### Scenario: A partial gate override preserves the other gate fields

- **WHEN** the development-only backend override supplies only one of the `continuityGate` fields
- **THEN** that field takes the overridden value and the remaining fields keep their defaults

