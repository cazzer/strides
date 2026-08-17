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
The system SHALL sort sampled frames by timestamp, then run the retroactive person-selection stage
over the sorted samples, then run `applyRobustness` over that stage's output, then
`computeFormHeuristics`, in that order, before reporting `phase: 'ready'`. The person-selection
stage's output SHALL be what both `applyRobustness` and the diagnostics aggregation see, so the
metrics, the overlay and the diagnostics all describe the same person.

#### Scenario: Samples are sorted before robustness processing
- **WHEN** sampling resolves with a set of samples not already in timestamp order (e.g. due to
  mid-analysis scrubbing)
- **THEN** `applyRobustness` receives the samples sorted ascending by `timestamp`

#### Scenario: Person selection runs between the sort and robustness
- **WHEN** the sorted samples contain detections belonging to more than one person and the
  selection stage is enabled
- **THEN** `applyRobustness` receives the selected subject's samples, with every other sample's
  frame replaced by `null`, and the diagnostics are computed from that same selected sequence

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
`phase: 'ready'` AND no background scale pass is in flight (`'pending'` or `'running'`) — rather
than leaving the video paused on its final frame, as sampling itself leaves it. While a scale
pass is in flight, the video is replaying for that pass's sampling (muted, unlooped); the loop
SHALL be re-armed by the same declarative condition the moment the pass reaches a terminal
status (`'done'`, `'failed'`, or `'skipped'`). The system SHALL clear the loop before starting a
new analysis run, so that run's sampling can detect the clip's natural end via the video's
`ended` event.

#### Scenario: Reaching the ready phase restarts and loops playback
- **WHEN** `phase` transitions to `'ready'` with no scale pass in flight (the pass was skipped,
  or has already concluded)
- **THEN** the video seeks to the start and begins playing, with its `loop` behavior enabled,
  with no further action required from the user

#### Scenario: The loop re-arms once the scale pass concludes
- **WHEN** `phase` is `'ready'` and the scale pass transitions from `'pending'`/`'running'` to
  `'done'`, `'failed'`, or `'skipped'`
- **THEN** the video seeks to the start and begins playing with `loop` enabled, exactly as it
  does for a run with no scale pass — the same condition owns both cases, with no scale-pass
  code re-arming the loop imperatively

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
  (saying in plain language that no real-world scale could be measured for this clip) is surfaced
  verbatim as a note, the same treatment every other null-valued metric already receives — no
  distinct error styling or wording is introduced for this metric specifically

### Requirement: Metrics panel readouts with measurability and confidence tiers

The system SHALL display, for each of the ten `MetricId`s in `FormHeuristicsResult`, its value in
plain language and a label naming the metric, partitioned into three tiers that determine how —
and whether — a value renders at all, rather than a single uniform card style for every metric.
Exclusion is reserved for metrics that are **structurally unmeasurable** — nothing was measured
(`value === null`) or the camera geometry cannot support the measurement (`viewFit ===
'unsuitable'`) — never for low confidence alone:

- **Tier 1 ("normal")**: `value` is non-null AND `viewFit` is not `'unsuitable'` AND
  `confidence >= HIGH_CONFIDENCE_THRESHOLD` (0.7). Renders as a card with its formatted value, a
  "High confidence" indicator, and any `caveat` surfaced verbatim as a note.
- **Tier 2 ("caveated")**: `value` is non-null AND `viewFit` is not `'unsuitable'` AND
  `confidence < HIGH_CONFIDENCE_THRESHOLD` — with NO lower confidence bound. Renders as a card
  with its formatted value, a confidence indicator ("Medium confidence" at
  `confidence >= LOW_CONFIDENCE_THRESHOLD` (0.4), "Low confidence" below it), and a border
  treatment structurally distinct from a tier-1 card's — paired with visible text (the confidence
  indicator and, when present, the `caveat` note), never a color-only distinction. A tier-2
  metric's `caveat` MAY be null; the card still renders visibly distinct via its border and
  confidence-indicator text alone in that case.
- **Tier 3 ("excluded")**: `value === null` OR `viewFit === 'unsuitable'`. Excluded from the card
  grid entirely. Instead, listed in a labeled section below the grid by metric name and a reason
  (the metric's `caveat` text) ONLY — no formatted value, no confidence indicator, and no "Not
  available"/"Not measurable" placeholder of any kind render for a tier-3 metric. A metric is
  never excluded because its confidence is low — a measured value at a workable camera angle
  always renders as a card.

`HIGH_CONFIDENCE_THRESHOLD` is single-sourced, shared by the tier classification and by each
card's own confidence-indicator text, so layout and copy can never disagree about where 0.7
falls. `LOW_CONFIDENCE_THRESHOLD` feeds ONLY the indicator copy (the Medium/Low label boundary) —
it participates in no layout decision. Cards within the grid, and entries within the excluded
section, each preserve `MetricId` declaration order — never re-sorted by confidence.

#### Scenario: A high-confidence, view-primary metric renders its value and a high-confidence indicator

- **WHEN** a metric's `confidence` is `>= HIGH_CONFIDENCE_THRESHOLD` (including exactly that
  value) and its `value` is non-null — the common case a clean, well-suited (`viewFit: 'primary'`)
  clip produces
- **THEN** the panel renders it as a tier-1 card with its formatted value and a "High confidence"
  indicator, with no tier-2 border treatment

#### Scenario: A tier-2 metric renders its value with a visibly distinct border and confidence indicator

- **WHEN** a metric's `value` is non-null, its `viewFit` is not `'unsuitable'`, and its
  `confidence` is `< HIGH_CONFIDENCE_THRESHOLD` — at any confidence below that bound, with no
  lower cutoff
- **THEN** the panel renders it as a card, in the grid, with its formatted value, a confidence
  indicator reading "Medium confidence" when `confidence >= LOW_CONFIDENCE_THRESHOLD` and "Low
  confidence" below that, and a border treatment distinguishable from a tier-1 card's by more
  than color alone

#### Scenario: A tier-2 metric's caveat, when present, renders as a visible note on the card

- **WHEN** a tier-2 metric's `caveat` is non-null
- **THEN** that text renders on the card in a visibly distinct note, not the same muted styling a
  tier-1 card's caveat receives

#### Scenario: A null-value metric renders as not available, not as zero or blank

- **WHEN** a metric's `value` is `null`
- **THEN** the panel never renders a formatted number, a zero, or a silently blank field for it —
  instead it is excluded from the card grid entirely, and its name plus its `caveat` (the reason)
  appear as an explicit entry in the excluded section, distinguishing "nothing was measured" from
  every rendered card unambiguously

#### Scenario: A measured metric is never excluded for low confidence alone

- **WHEN** a metric's `value` is non-null, its `viewFit` is not `'unsuitable'`, and its
  `confidence` is `< LOW_CONFIDENCE_THRESHOLD` — however low, including near zero
- **THEN** the panel renders it as a tier-2 card in the grid with its formatted value and a "Low
  confidence" indicator — never in the excluded section; the excluded section never lists a
  metric whose exclusion would be explained by confidence rather than by a null value or an
  unsuitable view

#### Scenario: A view-unsuitable metric is visibly flagged with text, not color alone

- **WHEN** a metric's `viewFit` is `'unsuitable'`
- **THEN** it lands in the excluded section via the tier rule's explicit `viewFit` clause — an
  unsuitable camera geometry is structurally unmeasurable regardless of the metric's `value` or
  `confidence` — where its `caveat` names the camera-angle issue verbatim; the strongest possible
  non-color distinction from a rendered card is not being rendered as one at all

#### Scenario: A present caveat from the heuristics engine is surfaced verbatim

- **WHEN** a metric lands in tier 1 or tier 2 and its `caveat` is non-null
- **THEN** that text is displayed alongside the metric, on its card, verbatim

#### Scenario: The excluded section is labeled and accessible

- **WHEN** the panel has at least one tier-3 metric
- **THEN** the excluded metrics render inside a section with an accessible name (e.g. a heading
  associated via `aria-labelledby`) distinguishing it from the card grid above it

#### Scenario: No excluded metrics renders no excluded section

- **WHEN** every metric in the result lands in tier 1 or tier 2
- **THEN** no excluded section renders at all

#### Scenario: A tier-count summary line surfaces caveated and excluded counts at the top of the panel

- **WHEN** at least one metric lands in tier 2 or tier 3
- **THEN** a single summary line renders above the card grid counting metrics measured, metrics
  with caveats, and metrics not measured for this clip — so a user who never scrolls the
  results pane still learns that some metrics carry caveats or were excluded
- **WHEN** every metric lands in tier 1
- **THEN** no summary line renders

#### Scenario: Cards and excluded entries preserve declaration order within their own section

- **WHEN** the panel renders the card grid and, separately, the excluded section
- **THEN** metrics within the grid appear in `MetricId` declaration order (skipping any excluded
  metric in place), and metrics within the excluded section appear in that same declaration
  order — neither section re-sorts by confidence

### Requirement: Background scale pass grafts measured vertical oscillation

The system SHALL, after an analysis run reaches `phase: 'ready'` on a primary pass that measured
no real-world scale, run one background sampling pass over the same video using a dedicated
MediaPipe Pose Landmarker detector, compute form heuristics over that pass's frames through the
identical sort → robustness → presence-trim → heuristics pipeline the primary pass uses, and —
when the scale pass's `verticalOscillationCm.calibration` is non-null — replace the displayed
result's `verticalOscillationCm` AND `stepWidthCm` with the scale pass's own versions of each,
carrying `verticalOscillationCm.calibration` by reference (`stepWidthCm` has no such calibration
object to carry) and appending a shared provenance sentence (stating in plain language that the
number came from a second look at the same clip, naming no backend or model) to each metric's own
caveat. When the two passes' selected subjects are judged to have diverged (see "The scale pass's
selected subject is checked against the primary pass's"), the system SHALL append a further
divergence sentence to each grafted metric's caveat, AFTER the provenance sentence, and SHALL
still complete the graft and mark the pass `'done'` — divergence caveats the two grafted numbers,
it never withholds or alters them. The two grafted metrics SHALL be independent of each other: a
scale pass whose `verticalOscillationCm.calibration` is non-null but whose own `stepWidthCm`
detected no footstrikes SHALL still graft `stepWidthCm`'s null value and its own caveat, plus
provenance — never withholding a successfully-grafted `verticalOscillationCm` because the sibling
metric came up empty, and never fabricating a `stepWidthCm` result the pass didn't itself produce.
Every other metric and the `view` result SHALL remain reference-identical to the primary pass's,
and the primary run's `diagnostics` SHALL remain the primary pass's own. The pass SHALL be tracked
as a status machine (`'idle' | 'pending' | 'running' | 'done' | 'failed' | 'skipped'`) on the
analysis state; it SHALL be skipped (never started) when the primary result already carries a
measured scale (`verticalOscillationCm.calibration !== null` — the same underlying fact that gates
`stepWidthCm` too, so this single check governs whether the pass runs at all for either metric) or
when the scale-pass config's kill switch is off — the config being resolvable in development
builds via a `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__` override, defaulting to enabled. Any
scale-pass failure — detector unavailable, playback or sampling failure, a wall-clock watchdog
expiry of at least `max(30s, 3 × clip duration)`, or a completed pass that measured no scale —
SHALL mark the pass `'failed'` and leave the primary result untouched. A `reset()` or a newly
loaded clip SHALL stop an in-flight scale pass, and a superseded pass's late resolution SHALL
never write state, under the same run-identity guard the primary run uses.

#### Scenario: A completed scale pass grafts the centimetre metric and nothing else

- **WHEN** the primary pass reaches `'ready'` with `verticalOscillationCm.calibration: null` and
  the background scale pass completes with a non-null `calibration`
- **THEN** the displayed heuristics' `verticalOscillationCm` AND `stepWidthCm` both become the
  scale pass's own (the former's `calibration` by reference, both caveats ending with the
  provenance sentence), every other metric and `view` remain reference-identical to the primary
  pass's, the run's `diagnostics` remain the primary pass's, and the pass's status is `'done'`
  with the scale pass's own diagnostics attached

#### Scenario: The two grafted metrics succeed or fail independently

- **WHEN** the scale pass completes with a non-null `verticalOscillationCm.calibration` but its own
  `stepWidthCm` detected no footstrikes (a null value with its own caveat)
- **THEN** the displayed `verticalOscillationCm` grafts a non-null value with the provenance
  sentence appended, AND the displayed `stepWidthCm` grafts a null value with its own
  no-footstrikes caveat plus the provenance sentence — neither metric's outcome is suppressed or
  altered by the other's

#### Scenario: The pass is skipped when the primary pass already measured scale

- **WHEN** the primary pass reaches `'ready'` with a non-null
  `verticalOscillationCm.calibration` (e.g. a mediapipe-primary dev override)
- **THEN** no scale pass starts, its status is `'skipped'` with reason `'primary-scale'`, and
  the displayed result is exactly the primary pass's for both metrics

#### Scenario: The kill switch skips the pass

- **WHEN** the resolved scale-pass config has `enabled: false` (in development, via
  `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`) and a run reaches `'ready'`
- **THEN** no scale pass starts, its status is `'skipped'` with reason `'disabled'`, and both
  centimetre metrics render exactly as they would without this capability

#### Scenario: A failed scale pass leaves the primary result untouched

- **WHEN** the scale pass fails — its detector cannot be created, its sampling rejects, its
  watchdog expires, or it completes without measuring any scale
- **THEN** the pass's status is `'failed'`, and the displayed heuristics, diagnostics, and phase
  are exactly what the primary pass produced for both metrics

#### Scenario: A measured-but-unfittable scale pass still grafts, with its reason

- **WHEN** the scale pass completes with a non-null `calibration` whose amplitude is `null`
  (a fit-failure reason names why)
- **THEN** the grafted `verticalOscillationCm` carries that null value and its fit-failure
  caveat plus the provenance sentence — replacing the primary's now-false "no scale could be
  measured" availability caveat

#### Scenario: A superseded scale pass never writes state

- **WHEN** `reset()` is called, a new clip loads, or `start()` begins a new analysis run while
  a scale pass is `'running'`
- **THEN** the pass's sampling handle is stopped before the new run samples (a still-attached
  scale sampler must never run inference concurrently with a primary pass), and any late
  resolution of its promise writes nothing — no graft of either metric, no status change on the
  new run's state

#### Scenario: A user pause mid-pass fails the pass fast

- **WHEN** video playback pauses while the scale pass is `'running'` and the video has not
  reached its natural end
- **THEN** the pass is stopped and marked `'failed'` immediately (a paused replay produces no
  frames; waiting for the watchdog would leave a false "measuring" state up for tens of
  seconds), while a pause event fired by the clip's natural end is ignored

#### Scenario: The divergence sentence composes after the provenance sentence

- **WHEN** a completed scale pass grafts a `verticalOscillationCm` that already carries its own
  caveat, and the two passes' selected subjects are judged to have diverged
- **THEN** the grafted metric's caveat reads as the metric's own caveat, then the provenance
  sentence, then the divergence sentence, in that order, space-joined — and a metric with no
  caveat of its own carries the provenance sentence followed by the divergence sentence with no
  leading space

### Requirement: The centimetre card reflects scale-pass progress

The system SHALL, while a scale pass is `'pending'` or `'running'` and either `verticalOscillationCm`
or `stepWidthCm` is excluded with a `null` value, render that metric's excluded entry with a hint,
in plain language, that real-world scale is still being measured by a second look at the clip, in
place of its availability caveat. When the pass concludes, each metric SHALL render through the
existing confidence-tier rules with no scale-pass-specific card treatment: a grafted non-null
value lands in whatever tier its own confidence puts it in (its caveat, including the
provenance sentence, rendering per that tier's existing rules). After a `'failed'` pass, a
null-valued entry for either metric SHALL say that a second look at the clip couldn't measure
real-world scale (the availability caveat alone would imply the capability is absent when the app
just ran it); after a `'skipped'` pass it SHALL fall back to the metric's own caveat verbatim,
exactly as it renders today. The always-visible analysis status line (`role="status"`) SHALL
narrate the pass — a count-agnostic in-progress sentence while `'pending'`/`'running'` (since how
many of the two scale-pass-backed metrics will end up gaining a value isn't known until the pass
concludes) and a one-sentence outcome on `'done'` or `'failed'`, each in plain language naming no
backend, model, or detection machinery — since the excluded-list hint may sit below the fold and
the status line is the panel's only screen-reader announcement path. The `'done'` outcome SHALL
count how many of the two scale-pass-backed metrics actually gained a non-null value (`0`, `1`, or
`2`) and pluralize its wording off that count — `0` reads as couldn't-add (never as a metric
having been added), `1` reads as singular ("1 more metric"), `2` reads as plural ("2 more
metrics") — never assuming a fixed count of exactly one.

#### Scenario: The excluded entry hints at the in-flight pass

- **WHEN** the scale pass is `'pending'` or `'running'` and `verticalOscillationCm.value` is
  `null`, or `stepWidthCm.value` is `null`
- **THEN** the excluded section's entry for that metric shows the measuring-scale hint instead of
  the availability caveat

#### Scenario: A grafted value renders as an ordinary tiered card

- **WHEN** the scale pass completes and grafts a non-null `verticalOscillationCm` or `stepWidthCm`
  value (measured values are never excluded for low confidence, per the
  exclude-only-unmeasurable-metrics rule)
- **THEN** that metric renders as a card in its confidence tier, its note carrying the grafted
  caveat with the provenance sentence — no new card state, styling, or tier is introduced

#### Scenario: A failed pass says the attempt happened

- **WHEN** the scale pass is `'failed'` and `verticalOscillationCm.value` is `null`, or
  `stepWidthCm.value` is `null`
- **THEN** that metric's excluded entry says a second look at the clip couldn't measure
  real-world scale — not the bare availability caveat, which would imply the capability was never
  exercised

#### Scenario: A skipped pass falls back to the caveat

- **WHEN** the scale pass is `'skipped'` and a metric's `value` is `null`
- **THEN** the excluded entry shows that metric's own caveat verbatim, with no in-progress hint

#### Scenario: The status line narrates the pass

- **WHEN** the analysis is `'ready'` and the scale pass is `'pending'`/`'running'`, then later
  `'done'` or `'failed'`
- **THEN** the `role="status"` completion line appends a count-agnostic in-progress sentence
  while the pass runs, and on conclusion a one-sentence outcome that names how many of the two
  scale-pass-backed metrics actually gained a value — singular wording at exactly one, plural
  wording at two, the couldn't-add sentence at zero; a `'skipped'` pass appends nothing

### Requirement: The step-width card renders as an absolute centimetre quantity, unavailable when scale wasn't measured

The system SHALL render `stepWidthCm` with description text stating that its number is a real
distance with no denominator, distinguishing it from every other metric on the panel except
`verticalOscillationCm`. The card SHALL render its value in centimetres with one decimal place and
no percent sign — the same formatting `verticalOscillationCm` uses, since both share the
`'centimeters'` unit — and SHALL render as excluded, with its availability caveat, when its
`value` is `null` rather than as an error or a blank field.

#### Scenario: A resolved step-width value renders with one decimal place, no percent sign

- **WHEN** `stepWidthCm.value` is a finite number, for example `8.2`
- **THEN** the panel renders it as `"8.2 cm"` — one decimal place, a `cm` unit suffix, and no `%`
  character

#### Scenario: An unavailable step-width card reads as an availability statement, not an error

- **WHEN** `stepWidthCm.value` is `null`
- **THEN** the metric is excluded from the card grid, and its `caveat` text (saying in plain
  language what would be needed) is surfaced verbatim in the excluded section, the same treatment
  every other null-valued metric already receives — no distinct error styling or wording is
  introduced for this metric specifically

### Requirement: The scale pass's selected subject is checked against the primary pass's

The system SHALL, before grafting a completed background scale pass's metrics, compare the two
passes' independently selected subjects and record the outcome on the scale-pass state as
`subjectAgreement`, carrying a `status` of `'agreed'`, `'diverged'`, or `'no-opinion'`, a typed
`reason` (`'primary-not-selected'`, `'scale-not-selected'`, `'too-few-comparable-instants'`, or
`null`), and the `comparedInstants`/`agreeingInstants` counts the verdict was computed from.

The comparison SHALL be made **at matched timestamps**, not between aggregate statistics of the two
winners: for each pass, a bounding box SHALL be derived per robust frame from that frame's
`'detected'` keypoints alone, using the run's own resolved person-selection confidence bounds —
reproducing the boxes the selection stage scored whenever the robustness and person-selection
keypoint-confidence floors agree, as they do by default. Each primary box SHALL be paired with the
nearest scale-pass box in time; a pair separated by more than a bounded pairing tolerance SHALL not
be compared at all. A compared pair SHALL count as agreeing when it satisfies the same
bounding-box continuity predicate the person-selection stage itself uses, with the run's own
bounds and the primary box as the reference. **No new geometric threshold SHALL be introduced** —
the predicate's area-ratio and centre-speed bounds SHALL be the run's already-resolved
person-selection bounds, so a development override that loosens continuity loosens this check
identically.

Divergence SHALL be declared only when a strict majority of comparable instants disagree, and only
when at least a minimum number of instants were comparable at all; below that floor the verdict
SHALL be `'no-opinion'`, never `'diverged'`. When either pass reports
`personSelection.status !== 'selected'`, the verdict SHALL be `'no-opinion'` with the
corresponding reason and zero compared instants — no pass that committed to no subject can be
said to have selected a different one. The comparison SHALL be pure: it SHALL NOT mutate either
input, and it SHALL NOT add any field to the person-selection, analysis, or clip-pipeline
diagnostics types.

On `'diverged'` the system SHALL still graft both scale-derived metrics and mark the pass
`'done'`, adding only a caveat sentence to each grafted metric (see "Background scale pass grafts
measured vertical oscillation"). On `'agreed'` and on `'no-opinion'` the graft SHALL be
byte-identical to what it would have been without this check.

#### Scenario: Both passes selected the same subject

- **WHEN** the two passes' surviving bounding boxes at matched timestamps satisfy the continuity
  predicate on at least half of the comparable instants, and the number of comparable instants
  clears the minimum
- **THEN** `subjectAgreement.status` is `'agreed'` with `reason: null`, and the grafted result is
  byte-identical to what the graft alone would have produced

#### Scenario: The scale pass selected a different subject

- **WHEN** a strict majority of the comparable instants fail the continuity predicate — the scale
  pass's boxes sitting elsewhere in the frame, or at a wildly different apparent size, from the
  primary pass's at the same instants — and the number of comparable instants clears the minimum
- **THEN** `subjectAgreement.status` is `'diverged'`, both grafted metrics' caveats carry the
  divergence sentence, the pass's status is still `'done'`, and every other metric and `view`
  remain reference-identical to the primary pass's

#### Scenario: Either pass's person selection was skipped

- **WHEN** either pass reports `personSelection.status: 'skipped'` for any reason (`'disabled'`,
  `'unknown-frame-size'`, `'no-detections'`, or `'no-detection-above-floor'`)
- **THEN** `subjectAgreement.status` is `'no-opinion'` with `reason` naming which side
  (`'primary-not-selected'` or `'scale-not-selected'`), `comparedInstants` is `0`, and the graft
  proceeds unchanged with no divergence sentence

#### Scenario: Too few instants were comparable to form an opinion

- **WHEN** both passes selected a subject but fewer instants than the minimum could be paired
  within the pairing tolerance — including the case where every pair, had it been compared, would
  have disagreed
- **THEN** `subjectAgreement.status` is `'no-opinion'` with
  `reason: 'too-few-comparable-instants'`, and the graft proceeds unchanged with no divergence
  sentence

### Requirement: Evidence frames are planned purely, then extracted from a detached video element

The system SHALL, only after an analysis run has reached `phase: 'ready'`, extract a small number of
still frames from the analyzed clip at the timestamps its metrics reported as exemplars, crop each to
the region of the frame that exemplar names, and — for an exemplar naming two instants — composite
the two into a single alpha-blended image.

The decision half SHALL be **pure**: turning an exemplar into timestamps, resolving those timestamps
to sampled frames, deriving a crop rectangle, and deciding which frame is the base, which is the
ghost, and at what opacities, SHALL all be computable with no DOM, no canvas, and no video element,
so that all of it is unit-testable in an environment with no canvas implementation. Only the final
draw SHALL touch a rendering context.

Timestamps SHALL be resolved against that clip's own sampled frames. The system SHALL NOT derive any
extraction timestamp from the clip's reported duration: a recorded webcam clip commonly reports an
infinite duration, and any fraction-of-duration arithmetic would silently produce a nonsensical
instant on exactly those clips.

Crop rectangles SHALL be computed in video-native pixel space, from the resolvable subset of the
exemplar's named keypoints **unioned across both frames of a pair**, then padded and clamped to the
frame bounds so that a subject near an edge or partly out of frame yields a valid rectangle rather
than a negative or out-of-bounds one. Every crop SHALL share a single aspect ratio across all
metrics, so the gallery reads as one coherent set. Keypoints that a given pose backend structurally
cannot produce SHALL be treated as absent rather than as positions: a crop SHALL be well-defined from
the exemplar's core keypoints alone.

A pair whose two instants are indistinguishable — near-identical crop regions, or both resolving to
the same sampled frame — SHALL be demoted to a single frame, or dropped when the metric has no honest
single-instant meaning. A blurred double exposure of two identical frames is worse than one clean
still.

Extraction SHALL use a **second, detached** video element created from the clip's own source blob,
never the visible element, which is loop-playing once analysis is ready. It SHALL hold at most one
detached decoder open at a time, extracting every instant for one clip in a single pass before moving
to the next. It SHALL own and release the object URL it creates, and SHALL NOT reuse or release the
one the video source hook holds privately. After a seek reports completion it SHALL wait for the new
frame to be presented before drawing, since seek completion does not imply the new frame is
composited. A seek that never completes SHALL degrade that metric to "no evidence" rather than
leaving the interface waiting.

Extracted images SHALL be held in memory for the session only. The system SHALL NOT serialize them to
a data URL or blob, offer a download, or persist them to any storage.

A metric with no evidence SHALL be distinguishable, in the extraction result, from a metric whose
evidence has not been computed yet — an explicit outcome the interface can branch on, carrying the
reason (the metric emitted no exemplars, every candidate was gated out, the metric is not being
reported at all, the clip's frames are unavailable, or extraction failed).

#### Scenario: Extraction happens after analysis and never disturbs the visible playback

- **WHEN** an analysis run reaches `phase: 'ready'` and the visible video begins looping
- **THEN** evidence extraction runs against a separate detached element created from the clip's
  source blob, the visible element's playback state is untouched, and analysis wall-clock time is
  unchanged from a run with no extraction

#### Scenario: A webcam clip reporting an infinite duration still yields a valid plan

- **WHEN** the clip's metadata reports a non-finite duration, as recorded webcam blobs commonly do
- **THEN** the extraction plan is well-formed, because every timestamp derives from the clip's own
  sampled frames and none from its reported duration

#### Scenario: A subject near the frame edge yields a valid crop

- **WHEN** an exemplar's keypoints sit near, or partly beyond, a frame boundary
- **THEN** the crop rectangle is clamped inside the frame with a positive size and the same aspect
  ratio every other crop uses, rather than a negative or out-of-bounds rectangle

#### Scenario: A near-identical pair is demoted rather than blended

- **WHEN** a pair's two instants produce near-identical crop regions, or both resolve to the same
  sampled frame
- **THEN** the pair is demoted to a single frame — or dropped entirely for a metric with no honest
  single-instant meaning — and no double exposure is composited

#### Scenario: A failed seek degrades to no evidence

- **WHEN** the detached element never reports a completed seek for a planned timestamp
- **THEN** that metric's evidence resolves to an explicit "no evidence" outcome naming extraction
  failure, and the interface renders the metric exactly as it does without evidence

#### Scenario: Missing backend keypoints do not corrupt a crop

- **WHEN** an exemplar names optional context keypoints the running pose backend structurally cannot
  produce, so they carry no position
- **THEN** those keypoints are omitted from the crop derivation and the crop is computed from the
  exemplar's core keypoints alone — never anchored at the coordinate origin

### Requirement: An evidence gallery renders below the results, grouped by metric

The system SHALL present extracted evidence in a dedicated gallery rendered **below** the metric
cards, spanning the full width of the results layout rather than nested inside either column, so that
imagery is not confined to half the page width inside a scrolling container.

The gallery SHALL group images by metric and caption each one well enough to be interpretable on its
own: which metric it is evidence for, which side where the metric is per-side, and — for a blended
image — that the two visible positions are the **same runner at two instants**, never two people.
Images SHALL carry alt text describing what the exemplar shows.

A ghosted image SHALL be a photographic opacity blend only. The system SHALL NOT draw a skeleton,
angle arc, reference line, or any other annotation over an extracted image, and SHALL NOT overlay any
reference or ideal posture — the only delta shown is the runner against themself.

The gallery SHALL be usable at narrow viewport widths, not only at wide ones, and SHALL drive
extraction at most once per clip, releasing the detached element and any retained images when it
unmounts or the session resets.

#### Scenario: A ghosted image shows one runner at two instants

- **WHEN** a metric's evidence is a blended pair
- **THEN** the rendered image is a photographic blend of the two frames with no drawn annotation of
  any kind, and its caption states that both positions are the same runner at two moments

#### Scenario: The gallery reads as one set

- **WHEN** several metrics produce evidence with different crop regions
- **THEN** every rendered image shares the same aspect ratio

#### Scenario: Nothing is retained after the gallery goes away

- **WHEN** the gallery unmounts or the session is reset
- **THEN** no detached video element, object URL, or extracted image is retained

### Requirement: Metric cards deep-link to their evidence, and are otherwise unchanged

A metric card whose metric has evidence SHALL gain a link that moves the reader to that metric's
section of the evidence gallery, reachable by keyboard. A metric card whose metric has no evidence
SHALL render exactly as it does today — no link, no placeholder, no empty frame, and no layout shift
relative to a build without this capability.

Evidence SHALL be offered only for metrics that render as a card. A metric excluded from the card
grid — because nothing was measured, or because the camera geometry cannot support the measurement —
SHALL have no gallery section and no link: there is no card to link from, and imagery for a
measurement the system declined to report would be a picture explaining a number that is not on
screen.

#### Scenario: A card without evidence is byte-for-byte today's card

- **WHEN** a metric renders as a card but has no evidence
- **THEN** the card renders with no evidence link and no placeholder, identically to a build without
  this capability

#### Scenario: An excluded metric gets no evidence

- **WHEN** a metric is excluded from the card grid because its value is null or its view fit is
  unsuitable
- **THEN** no gallery section and no link are rendered for it, whatever exemplars it may carry

### Requirement: Evidence never enters the analysis diagnostics payload

The development-only analysis diagnostics payload SHALL remain free of exemplar data, extracted
images, canvases, and blob URLs. That payload is serialized to the console and parsed by the
live-verification harness, so its shape is a contract; adding a metric's exemplars to it — even as
timestamps or counts — would change that shape for every run.

Any development-time reporting of evidence coverage SHALL therefore use its own separately-prefixed
console output rather than widening the existing diagnostics payload.

#### Scenario: The diagnostics payload is unchanged by exemplars

- **WHEN** a run's metrics emit exemplars
- **THEN** the serialized analysis diagnostics payload is identical to what the same run would emit
  with no exemplars, and contains no image data, canvas, or blob URL

