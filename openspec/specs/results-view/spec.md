# results-view Specification

## Purpose
Play a loaded clip back through the full analysis pipeline (pose detection → robustness →
heuristics) on an explicit user action, and present the result: a skeleton overlay drawn over the
video and kept in sync with playback at any point, plus a metrics panel showing each heuristic's
value, plain-language meaning, and confidence — including a vertical-oscillation waveform, since
that metric is inherently a timeseries, not a single number.
## Requirements
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

### Requirement: Video loops with overlay once analysis is ready
The system SHALL restart video playback from the beginning and loop it continuously, with the
skeleton overlay kept in sync per the existing overlay-sync requirement, once analysis reaches
`phase: 'ready'` — rather than leaving the video paused on its final frame, as sampling itself
leaves it. The system SHALL clear the loop before starting a new analysis run, so that run's
sampling can detect the clip's natural end via the video's `ended` event.

#### Scenario: Reaching the ready phase restarts and loops playback
- **WHEN** `phase` transitions to `'ready'`
- **THEN** the video seeks to the start and begins playing, with its `loop` behavior enabled, with
  no further action required from the user

#### Scenario: The overlay stays in sync through the loop
- **WHEN** the video is looping after `phase` became `'ready'`
- **THEN** the skeleton overlay continues to redraw for the current playback position on every
  loop pass, the same as it does during any other playback (per the existing overlay-sync
  requirement) — including immediately after the loop seeks back to the start

#### Scenario: Looping does not block browser autoplay policy
- **WHEN** the loop-restart's `play()` call is issued outside the original "Analyze" click's
  synchronous call stack
- **THEN** the video is muted before that `play()` call, so the browser's autoplay policy does not
  block it

#### Scenario: Starting a new run clears the loop first
- **WHEN** `start()` is called to begin a new analysis run (e.g. via "Analyze again") while the
  video is still looping from a previous run
- **THEN** the video's loop behavior is cleared before `start()` begins playback for sampling, so
  the video reaches a genuine `ended` event at the end of the new sampling pass instead of looping
  through it

### Requirement: Automatic analysis start
The system SHALL automatically start sampling a loaded clip once `videoSource.status` reaches
`'ready'` for that clip and a detector is available, without requiring an explicit user action.
The "Analyze"/"Analyze again" control SHALL remain available so the user can manually (re-)start
a run — for a clip whose auto-start didn't fire because no detector was available yet, or to
re-run analysis on the same clip.

#### Scenario: Analysis starts automatically once a clip becomes ready
- **WHEN** `videoSource.status` transitions to `'ready'` and a detector is available
- **THEN** `VideoAnalysisState.phase` transitions to `'sampling'` without any explicit `start()`
  call from the user

#### Scenario: Analysis does not auto-start without an available detector
- **WHEN** `videoSource.status` is `'ready'` but the detector is `null`
- **THEN** `phase` remains `'idle'` until the user manually activates "Analyze", which then
  surfaces the normal `detector-unavailable` error

#### Scenario: The Analyze control remains available to manually (re-)start a run
- **WHEN** `phase` is `'idle'`, `'ready'`, or `'error'`
- **THEN** activating the "Analyze"/"Analyze again" control calls `start()`

#### Scenario: The Analyze button is disabled while a run is already in progress
- **WHEN** `phase` is `'sampling'` or `'processing'`
- **THEN** the "Analyze" button is disabled

### Requirement: Low-confidence results banner
The system SHALL display a non-modal, non-blocking banner once `phase` is `'ready'` when at least
one computed metric (vertical oscillation, trunk lean, overstriding) is flagged as low-confidence
— its `value` is `null`, its `confidence` is below the metrics panel's low-confidence threshold,
or its `viewFit` is `'unsuitable'` — using the identical condition the metrics panel already uses
to visually flag that same metric's card. The system SHALL render nothing when no metric is
flagged.

#### Scenario: A flagged metric triggers the banner
- **WHEN** `phase` is `'ready'` and at least one metric meets the low-confidence condition
- **THEN** a banner is rendered naming the affected metric(s)

#### Scenario: No flagged metrics renders no banner
- **WHEN** `phase` is `'ready'` and every metric fails the low-confidence condition
- **THEN** no banner is rendered

#### Scenario: The banner's flagged condition matches the metrics panel's own
- **WHEN** a given metric's `value`/`confidence`/`viewFit` would visually flag its card in the
  metrics panel
- **THEN** that same metric is included among the banner's flagged metrics — the two are never
  inconsistent with each other

### Requirement: The vertical-oscillation family's cards name what each number is relative to

The system SHALL render `verticalOscillation`, `verticalRatio`, and `verticalOscillationCm` each
with description text stating what its number is relative to — torso length, stride length, or
nothing at all (an absolute physical quantity) — so a reader can tell the three cards apart by
what they measure against, not just by their numeric values. The `verticalOscillationCm` card
SHALL render its value in centimetres with one decimal place and no percent sign, and SHALL render
as unavailable, with its availability caveat, when its `value` is `null` rather than as an error or
a blank field.

#### Scenario: The three cards each state their own denominator

- **WHEN** the metrics panel renders `verticalOscillation`, `verticalRatio`, and
  `verticalOscillationCm` from a fully-populated result
- **THEN** each card's description text names its own denominator (torso length for
  `verticalOscillation`, stride length for `verticalRatio`, no denominator at all for
  `verticalOscillationCm`), distinguishing the three from each other

#### Scenario: A resolved centimetre value renders with one decimal place, no percent sign

- **WHEN** `verticalOscillationCm.value` is a finite number, for example `4.79`
- **THEN** the panel renders it as `"4.8 cm"` — one decimal place, a `cm` unit suffix, and no `%`
  character, distinct from every other metric's formatting

#### Scenario: An unavailable centimetre card reads as an availability statement, not an error

- **WHEN** `verticalOscillationCm.value` is `null`
- **THEN** the card renders "Not available" in place of a formatted value, and its `caveat` text
  (naming what pose-detection capability would be needed) is surfaced verbatim as a note, the same
  treatment every other null-valued metric already receives — no distinct error styling or
  wording is introduced for this metric specifically

