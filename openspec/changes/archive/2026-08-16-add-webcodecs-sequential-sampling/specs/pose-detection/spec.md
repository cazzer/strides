## MODIFIED Requirements

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

## ADDED Requirements

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
