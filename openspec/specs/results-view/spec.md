# results-view Specification

## Purpose
Play a loaded clip back through the full analysis pipeline (pose detection → robustness →
heuristics) on an explicit user action, and present the result: a skeleton overlay drawn over the
video and kept in sync with playback at any point, plus a metrics panel showing each heuristic's
value, plain-language meaning, and confidence — including a vertical-oscillation waveform, since
that metric is inherently a timeseries, not a single number.
## Requirements
### Requirement: Explicit analysis trigger
The system SHALL require an explicit user action (an "Analyze" button) to begin sampling a loaded
clip; analysis SHALL NOT start automatically when a clip finishes loading.

#### Scenario: Analysis does not start on its own when a clip becomes ready
- **WHEN** `videoSource.status` transitions to `'ready'`
- **THEN** `VideoAnalysisState.phase` remains `'idle'` until `start()` is called

#### Scenario: The Analyze button is disabled while a run is already in progress
- **WHEN** `phase` is `'sampling'` or `'processing'`
- **THEN** the "Analyze" button is disabled

#### Scenario: The Analyze button is disabled while the quality gate is still assessing
- **WHEN** the quality gate's `status` is `'assessing'`
- **THEN** the "Analyze" button is disabled, regardless of `phase`

### Requirement: Whole-clip sampling via self-throttled frame callbacks
The system SHALL sample a loaded clip by playing it once at normal speed and driving detection
off `requestVideoFrameCallback`, starting detection for a presented frame only when no previous
detection is still in flight, and dropping (never queuing) a presented frame when one is.

#### Scenario: A new detection starts when the previous one has resolved
- **WHEN** a video frame is presented and no detection is currently in flight
- **THEN** `estimatePose` is called for that frame and the callback re-arms for the next frame

#### Scenario: A presented frame is dropped while a detection is still in flight
- **WHEN** a video frame is presented while a previous detection has not yet resolved
- **THEN** no new detection starts for that frame, and the callback still re-arms for the next
  frame

#### Scenario: Sampling produces a variable, detector-throughput-dependent frame count
- **WHEN** a clip is sampled
- **THEN** the resulting sample count is not fixed in advance — it reflects how many frames the
  detector could keep up with during playback

### Requirement: Per-frame error tolerance with a circuit breaker
The system SHALL record an isolated per-frame detection failure as `{ timestamp, frame: null }`
and continue sampling, aborting the whole run only after `maxConsecutiveErrors` consecutive
failures.

#### Scenario: A single failed detection does not abort sampling
- **WHEN** one `estimatePose` call rejects while sampling
- **THEN** that frame is recorded with `frame: null`, `consecutiveErrors` increments, and
  sampling continues for subsequent frames

#### Scenario: A successful detection resets the consecutive-error count
- **WHEN** a detection succeeds after one or more prior failures
- **THEN** the consecutive-error count resets to zero

#### Scenario: Reaching maxConsecutiveErrors aborts the run
- **WHEN** `maxConsecutiveErrors` detections fail in a row with no intervening success
- **THEN** sampling stops, no further `requestVideoFrameCallback` registrations occur, and the
  run's promise rejects

### Requirement: Analysis pipeline ordering
The system SHALL sort sampled frames by timestamp, then run `applyRobustness`, then
`computeFormHeuristics`, in that order, before reporting `phase: 'ready'`.

#### Scenario: Samples are sorted before robustness processing
- **WHEN** sampling resolves with a set of samples not already in timestamp order (e.g. due to
  mid-analysis scrubbing)
- **THEN** `applyRobustness` receives the samples sorted ascending by `timestamp`

#### Scenario: Heuristics are computed from the robustness output, not raw samples
- **WHEN** the robustness pass produces `RobustPoseFrame[]`
- **THEN** `computeFormHeuristics` is called with exactly that output

### Requirement: Analysis lifecycle and stale-run discarding
The system SHALL expose an `AnalysisPhase` (`'idle' | 'sampling' | 'processing' | 'ready' |
'error'`), support `reset()` back to `'idle'`, and discard any in-flight run's eventual result
once superseded by a `reset()` or a newly loaded clip.

#### Scenario: start() fails fast when no detector is available
- **WHEN** `start()` is called with `detector: null`
- **THEN** `phase` becomes `'error'` with `error.kind: 'detector-unavailable'`, and no sampling
  begins

#### Scenario: start() fails fast when no video is loaded
- **WHEN** `start()` is called with no attached video element or no metadata
- **THEN** `phase` becomes `'error'` with a non-null `error`, and no sampling begins

#### Scenario: A stalled/aborted sampling run surfaces as an error
- **WHEN** `sampleClip`'s returned promise rejects (e.g. the circuit breaker tripped)
- **THEN** `phase` becomes `'error'` with `error.kind: 'detection-stalled'`

#### Scenario: reset() stops an active run and returns to idle
- **WHEN** `reset()` is called while `phase` is `'sampling'` or `'processing'`
- **THEN** the active run's handle is stopped, `phase` returns to `'idle'`, and `robustFrames`/
  `heuristics` are cleared

#### Scenario: A new clip abandons a stale run
- **WHEN** `videoSource.metadata` changes identity (a new clip finished loading) while a run is
  active
- **THEN** the active run is stopped and `phase` returns to `'idle'` for the new clip, and any
  late resolution of the abandoned run's promise does not overwrite subsequent state

### Requirement: Skeleton overlay rendering
The system SHALL draw, for whatever video frame is nearest the current playback time, a point per
resolvable keypoint and an edge per connected keypoint pair defined in `SKELETON_EDGES`.

#### Scenario: A point is drawn for each detected or interpolated keypoint
- **WHEN** a keypoint's status is `'detected'` or `'interpolated'`
- **THEN** a point draw operation is produced at that keypoint's position

#### Scenario: An unrecoverable keypoint is skipped entirely
- **WHEN** a keypoint's status is `'unrecoverable'`
- **THEN** no point draw operation is produced for it, and no edge touching it is drawn

#### Scenario: The nearest frame to the current playback time is used
- **WHEN** the video's current time falls between two sampled frames' timestamps
- **THEN** the frame with the closer timestamp is used for drawing

### Requirement: Overlay distinguishes detected from interpolated keypoints
The system SHALL render interpolated points and edges at visibly reduced opacity relative to
directly-detected ones, so a user can see where the analysis is less certain.

#### Scenario: A detected point renders at full opacity
- **WHEN** a keypoint's status is `'detected'`
- **THEN** its draw operation's opacity is the full/detected opacity constant

#### Scenario: An interpolated point renders at reduced opacity
- **WHEN** a keypoint's status is `'interpolated'`
- **THEN** its draw operation's opacity is strictly less than the detected opacity constant

#### Scenario: An edge takes the weaker of its two endpoints' opacity
- **WHEN** an edge connects a detected keypoint and an interpolated keypoint
- **THEN** the edge's draw operation opacity equals the interpolated (lower) opacity, not the
  detected (higher) one

### Requirement: Overlay stays synced at any point in playback, not just a full run
The system SHALL keep the overlay's drawn frame current both during active playback and while
paused/scrubbing, without requiring a full start-to-finish analysis pass to have just completed.

#### Scenario: The overlay redraws continuously while the video plays
- **WHEN** the video is playing
- **THEN** the overlay redraws on an animation-frame cadence tied to actual playback, using
  `video.currentTime` at each redraw

#### Scenario: The overlay redraws immediately on seek while paused
- **WHEN** the video is paused and the user seeks (drags the scrubber and releases, or the
  scrubber fires a time-update while being dragged)
- **THEN** the overlay redraws once for the new `video.currentTime` without requiring playback to
  resume

#### Scenario: The overlay does not run an animation loop while idle
- **WHEN** the video is paused and not being scrubbed
- **THEN** no animation-frame loop is scheduled

### Requirement: Metrics panel readouts with confidence/applicability indicators
The system SHALL display, for each of vertical oscillation, trunk lean, and overstriding: its
value in plain language, a label naming the metric, and a confidence/applicability indicator that
visibly differs — not by color alone — for a low-confidence or view-unsuitable result.

#### Scenario: A high-confidence, view-primary metric renders its value and a high-confidence indicator
- **WHEN** a metric's `confidence` is high and `viewFit` is `'primary'`
- **THEN** its formatted value and a "high confidence" indicator are shown, with no
  camera-angle caveat text

#### Scenario: A null-value metric renders as not available, not as zero or blank
- **WHEN** a metric's `value` is `null`
- **THEN** the panel shows an explicit "not available"/"not measurable" indication, never a
  formatted number

#### Scenario: A view-unsuitable metric is visibly flagged with text, not color alone
- **WHEN** a metric's `viewFit` is `'unsuitable'`
- **THEN** the panel shows text stating the metric isn't reliable from the detected camera angle,
  independent of any color/styling difference

#### Scenario: A present caveat from the heuristics engine is surfaced verbatim
- **WHEN** a metric's `caveat` is non-null
- **THEN** that text is displayed alongside the metric

### Requirement: Vertical oscillation timeseries chart
The system SHALL render vertical oscillation as a chart over its `series` (a timeseries), not
only as a single aggregate value, breaking the plotted line at any `null` entry rather than
interpolating across it.

#### Scenario: A fully-resolved series renders as one continuous line
- **WHEN** every entry in `series` has a non-null `value`
- **THEN** the chart renders a single unbroken line through all points

#### Scenario: A series with gaps renders as separate line segments
- **WHEN** `series` contains one or more `null`-valued entries between resolved entries
- **THEN** the chart renders separate line segments on either side of each gap, with no segment
  bridging across a `null` entry

#### Scenario: An empty or fully-null series renders a fallback, not an empty chart
- **WHEN** `series` is empty or every entry's `value` is `null`
- **THEN** the chart renders a textual fallback message instead of an empty/broken plot

#### Scenario: The chart is accessible without relying on visual reading alone
- **WHEN** the chart is rendered
- **THEN** it exposes an accessible name/description (e.g. `role="img"` with a title, plus a text
  caption) sufficient to convey its content without seeing the plotted line

