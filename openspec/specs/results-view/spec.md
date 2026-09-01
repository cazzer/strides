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

The system SHALL display, for each of the eleven `MetricId`s in `FormHeuristicsResult`, its value in
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

Because tier 3 admits a metric on **either** ground, the excluded section SHALL be labeled, and
SHALL be referred to in the summary line, as metrics that are **not measurable** for this clip
rather than as metrics that were not measured. A metric excluded on the `viewFit` ground has a
computed value; calling it "not measured" contradicts the entry printed directly beneath the
label. The section's own label and the summary line's fragment for it SHALL use the same wording,
so the two can never drift apart.

A card's confidence indicator SHALL be a statement about confidence and nothing else. It is only
ever rendered for tier 1 and tier 2, both of which have a non-null `value` by the tier rule, so it
SHALL NOT carry an availability branch — such a branch is unreachable, and its copy would collide
with the excluded section's availability wording while meaning something different.

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

#### Scenario: A metric excluded for its camera angle is not called unmeasured

- **WHEN** a metric carries a non-null `value` and a `viewFit` of `'unsuitable'`, so it is listed
  in the excluded section with a computed number it is not allowed to show
- **THEN** the section's label, and the summary line's fragment naming that section, describe its
  contents as not **measurable** for this clip — never as not measured, which the entry beneath
  the label contradicts

#### Scenario: No excluded metrics renders no excluded section

- **WHEN** every metric in the result lands in tier 1 or tier 2
- **THEN** no excluded section renders at all

#### Scenario: A tier-count summary line surfaces caveated and excluded counts at the top of the panel

- **WHEN** at least one metric lands in tier 2 or tier 3
- **THEN** a single summary line renders above the card grid, counting metrics measured with the
  caveated share reported inside that total, and metrics not measurable for this clip — so a user
  who never scrolls the results pane still learns that some metrics carry caveats or were excluded
- **WHEN** every metric lands in tier 1
- **THEN** no summary line renders

#### Scenario: The summary line's counts nest rather than partition

- **WHEN** a run produces metrics in all three tiers at once
- **THEN** the count of metrics measured is the number of metrics that rendered as a card — tier 1
  and tier 2 together — and the caveated count is reported as a share **of** that total rather than
  as a separate quantity beside it, so the sentence never claims fewer metrics were measured than
  the reader can see values for
- **AND** the two counts the line reports sum to the whole panel: metrics measured plus metrics not
  measurable equals every metric the panel considered

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
to sampled frames, deriving a crop rectangle, deciding which frame is the base, which is the ghost,
and at what opacities, **and deriving every annotation mark's geometry in the output image's own
coordinate space**, SHALL all be computable with no DOM, no canvas, and no video element, so that all
of it is unit-testable in an environment with no canvas implementation. Only the final draw SHALL
touch a rendering context. Annotation is inside this rule, not beside it: the unit suite runs in an
environment whose `getContext('2d')` returns `null` by deliberate choice, so any geometry decided
inside a draw call is geometry no test can reach.

The pure layer SHALL have, for every instant it plans, the information an annotation needs: the
resolved position of each keypoint the exemplar's own mark set names, each carrying whether it was
directly detected, interpolated, or unrecoverable; the transform from video-native pixels to the
output image's coordinate space; the sign of any directional quantity a mark's orientation depends
on — direction of travel, or which side of the body's midline counts as outward; and, where the
metric measures one side of the body, **which side that instant's own measurement was about**. A mark
whose orientation is guessed rather than derived is a false statement about the runner, and the plan
is the only place where it can be derived and tested.

That last one SHALL be recorded **per instant**, not per image. A metric may deliberately pair two
instants measured on opposite sides — step width's constructed opposite-foot pair is exactly that,
and an overstride range's two extremes need not share a foot either — so a single image-level side
is absent on precisely the pairs it would be needed for. The plan SHALL carry an explicit absence
where no side was stated, and a mark that needs one SHALL be omitted rather than anchored on a
guessed limb.

Timestamps SHALL be resolved against that clip's own sampled frames. The system SHALL NOT derive any
extraction timestamp from the clip's reported duration: a recorded webcam clip commonly reports an
infinite duration, and any fraction-of-duration arithmetic would silently produce a nonsensical
instant on exactly those clips.

Crop rectangles SHALL be computed in video-native pixel space, from the resolvable subset of the
exemplar's named keypoints **unioned across both frames of a pair**, then padded and clamped to the
frame bounds so that a subject near an edge or partly out of frame yields a valid rectangle rather
than a negative or out-of-bounds one. Every crop SHALL share a single aspect ratio across all
metrics, so the images read as one coherent set wherever they render. Keypoints that a given pose
backend structurally cannot produce SHALL be treated as absent rather than as positions: a crop SHALL
be well-defined from the exemplar's core keypoints alone, and an annotation SHALL omit a mark it has
no resolved position for rather than anchoring it at the coordinate origin.

An exemplar's named keypoints SHALL bound the region the image must show **at both instants of a
pair**, not at whichever instant happens to sit more comfortably inside the frame. A pair whose two
instants differ along an axis has, by construction, one instant nearer each edge on that axis; a
keypoint set that stops short of the subject therefore does not clip the pair evenly, it clips the
extreme instant. Where a metric pairs two instants that differ in the runner's vertical position,
the named keypoints SHALL reach the head, so that the instant at the top of the motion keeps it.

That is a statement about which instant is harmed, not about tidiness. The system draws one instant
solid and the other faint, and names the solid one in the caption; if the crop removes the solid
instant's head while keeping the faint one's, the image contains exactly one complete face and it
is the wrong one. A reader anchors on the face that is there, and then reads correctly-placed marks
on the other body as mis-registered.

A crop SHALL additionally carry a minimum side in native pixels, so that a degenerate keypoint box —
a seed resolving to a single point, or to a set that nearly collapses onto a line — does not produce
an empty image. That minimum is a **display** guarantee about pixel count and SHALL NOT be treated as
a statement about framing.

Where that minimum is what makes a crop wider than the subject on an axis, the system SHALL place the
crop **centred on the subject** along that axis rather than on the measured region, provided the
subject is at least as large as the crop on the other axis. The subject's extent SHALL be derived from
every keypoint that resolves at the frames the crop is drawn through, not only the ones the exemplar
named for its crop — a limb box says where the measurement was, and only the whole keypoint set says
where the runner is. Both conditions are required:

- The **minimum**, and not the padding, SHALL be what made the crop wider than the subject. A crop the
  padding sized is framed as the padding intended, and re-placing it would move an image whose
  composition nothing had inflated.
- The crop SHALL be smaller than the subject on the other axis, so that it is a detail of one body
  rather than a scene containing a whole one. When a crop already holds the entire subject, moving it
  only exchanges one region of background for another, and the system has no evidence with which to
  prefer either.

That placement SHALL change only the rectangle's position. The crop's side SHALL be exactly what the
padding, minimum and frame-bound arithmetic produced, so that everything judging a crop by its
size — including the ghosted-pair growth ratio — is unaffected.

The subject extent SHALL be treated as a **lower bound** on the subject rather than as its outline,
because a pose backend that cannot produce a keypoint contributes nothing to it: on a backend with no
foot keypoints the extent stops at the ankles while the runner's shoes continue below it. Centring
follows from that: it reserves the same margin at both ends of the axis, which is the largest margin
obtainable at either end, and is therefore the placement that best protects an extent the system
cannot observe. The system SHALL NOT infer from this box that the subject ends where it ends.

A pair whose two instants are indistinguishable — near-identical crop regions, both resolving to the
same sampled frame, or **separated by fewer sampled frame intervals than can express a difference in
gait phase** — SHALL be demoted to a single frame, or dropped when the metric has no honest
single-instant meaning. A blurred double exposure of two identical frames is worse than one clean
still.

Those tests are complementary and the system SHALL apply all of them. A comparison of the two
instants' crop REGIONS cannot see a pair that is merely too close in time: a bounding box is blind to
motion inside itself, so a limb swinging within its own hull changes the pose completely while barely
moving the box, and a small distant limb box changes shape a great deal between two adjacent frames
while depicting one pose. Measured on this repo's own footage, region overlap orders the two
situations backwards — the broken pair overlaps LESS than a pair that ghosts perfectly — so no
threshold on region overlap can separate them and the separation test SHALL be made on elapsed time
instead.

The separation floor SHALL be expressed in the clip's own sampled frame intervals rather than in
absolute seconds, because a sparsely sampled clip genuinely cannot resolve gait phase as finely as a
densely sampled one, and the floor should widen with the interval. It SHALL NOT be applied where no
usable interval can be derived: a guard that cannot form its own criterion must decline rather than
reject everything.

**This does not contradict the rule against measuring a too-far-apart pair by elapsed time**, because
the two ends of the range ask different questions. At the far end the question is whether two bodies
can share one legible crop — a spatial question, on which a stationary subject seconds apart ghosts
perfectly and a fast one a fraction of a second apart does not. At the near end the question is
whether the two instants are the two distinct phases the exemplar's own label names, which is a
property of the signal and is measured in time.

Whether a collapsed pair is demoted or dropped SHALL be decided by where the REPORTED NUMBER lives,
not by whether the exemplar arrived as a pair. A quantity read off a single instant — a footstrike
angle, a step width, a peak joint angle — survives losing its partner, because the surviving frame
still shows what the card reports and the annotation still draws the geometry that was measured
there. A quantity that IS a difference between two instants — an amplitude, a stride length, a range
— does not, because one frame of it depicts no part of the number, and such a pair SHALL be dropped.
Demoting is the honest outcome wherever it is available: these rules exist to REPLACE a misleading
ghost with a truthful still, so classifying a single-instant measurement as un-demotable makes them
delete evidence instead.

Extraction SHALL use a **second, detached** video element created from the clip's own source blob,
never the clip's own presented element, whose playback state belongs to the reader (it may be paused
on an arbitrary frame, or loop-playing while its preview is open). It SHALL hold at most one detached
decoder open at a time, extracting every instant for one clip in a single pass before moving
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

- **WHEN** an analysis run reaches `phase: 'ready'`, whether or not the clip's own element is
  currently presented and playing
- **THEN** evidence extraction runs against a separate detached element created from the clip's
  source blob, the clip's own element's playback state is untouched, and analysis wall-clock time is
  unchanged from a run with no extraction

#### Scenario: A webcam clip reporting an infinite duration still yields a valid plan

- **WHEN** the clip's metadata reports a non-finite duration, as recorded webcam blobs commonly do
- **THEN** the extraction plan is well-formed, because every timestamp derives from the clip's own
  sampled frames and none from its reported duration

#### Scenario: A subject near the frame edge yields a valid crop

- **WHEN** an exemplar's keypoints sit near, or partly beyond, a frame boundary
- **THEN** the crop rectangle is clamped inside the frame with a positive size and the same aspect
  ratio every other crop uses, rather than a negative or out-of-bounds rectangle

#### Scenario: A minimum-sized limb crop is placed on the runner, not on the limb

- **WHEN** an exemplar names a small limb region whose padded box falls below the crop's minimum side,
  and the runner is narrower than that minimum but taller than it
- **THEN** the crop is centred horizontally on the runner's own keypoint extent rather than on the
  limb box, so the enlargement the minimum introduced is spent on the runner instead of on whatever
  stands beside them, while the crop's side, its aspect ratio and the limb region's presence in the
  image are all unchanged

#### Scenario: A crop that already holds the whole subject is left where it is

- **WHEN** a minimum-sized crop is larger than the subject on both axes — a distant runner in a foot
  or knee close-up, say
- **THEN** the crop is not re-placed, because moving it would exchange one region of background for
  another with nothing to choose between them, and a crop that rode up the body would reframe a foot
  close-up as a whole-body shot and pull whatever stands behind the runner into the middle of it

#### Scenario: A near-identical pair is demoted rather than blended

- **WHEN** a pair's two instants produce near-identical crop regions, or both resolve to the same
  sampled frame
- **THEN** the pair is demoted to a single frame — or dropped entirely for a metric with no honest
  single-instant meaning — and no double exposure is composited

#### Scenario: A bounce pair's crop keeps the head of the instant at the top of the motion

- **WHEN** a metric pairs the highest and lowest points of the runner's vertical oscillation, and the
  higher instant is the one drawn solid
- **THEN** the crop contains both instants' heads, so the image does not present the faint instant as
  the only complete figure in it

#### Scenario: A pair a couple of sampled frames apart is demoted, not ghosted

- **WHEN** an exemplar pairs two instants separated by fewer sampled frame intervals than a change of
  gait phase can occupy, so the two depict one pose however different their crop regions are
- **THEN** the pair is demoted to a single frame with the caption that says so, rather than composited
  into an image whose caption promises a difference the picture does not contain

#### Scenario: A single-instant measurement survives demotion where a difference measurement does not

- **WHEN** a collapsed pair belongs to a metric whose reported value is read off one instant, and
  separately when it belongs to one whose reported value is the difference between two
- **THEN** the first is demoted to a single frame that still shows the measured geometry, and the
  second is dropped, because one frame of a difference depicts no part of the reported number

#### Scenario: A failed seek degrades to no evidence

- **WHEN** the detached element never reports a completed seek for a planned timestamp
- **THEN** that metric's evidence resolves to an explicit "no evidence" outcome naming extraction
  failure, and the interface renders the metric exactly as it does without evidence

#### Scenario: Missing backend keypoints do not corrupt a crop

- **WHEN** an exemplar names optional context keypoints the running pose backend structurally cannot
  produce, so they carry no position
- **THEN** those keypoints are omitted from the crop derivation and the crop is computed from the
  exemplar's core keypoints alone — never anchored at the coordinate origin

#### Scenario: A foot close-up is framed the same way whether or not the backend resolves feet

- **WHEN** the same footstrike instant is planned on a backend that produces heel and toe keypoints
  and on one that does not, so the subject's derived extent stops at the ankles on the second
- **THEN** both produce the identical crop rectangle, and neither reframes the close-up around a
  subject extent it read as an outline

#### Scenario: Annotation geometry is decided with no canvas in reach

- **WHEN** the unit suite runs in an environment where `getContext('2d')` returns `null`
- **THEN** every annotation mark's position, orientation and extent in the output image's coordinate
  space is computed and asserted, and the only untested step is the sequence of draw calls that
  paints them

#### Scenario: A directional mark is oriented from the plan, not from the drawing layer

- **WHEN** a metric's mark depends on which way the runner is travelling, or on which side of the
  midline counts as outward
- **THEN** that sign reaches the drawing layer as part of the plan, and a runner travelling
  right-to-left produces a mark oriented opposite to the same runner travelling left-to-right

#### Scenario: An unresolved keypoint drops its mark rather than moving it

- **WHEN** a keypoint an annotation mark depends on is `'unrecoverable'` at the depicted instant
- **THEN** that mark is omitted from the plan, and no mark is drawn at the coordinate origin or at a
  substituted position

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

### Requirement: Clip video elements stay mounted and playable while hidden

Sampling reads frames off a live, playing `<video>` element. The system SHALL therefore keep every
clip's video element mounted and playable for the whole life of that clip's session entry,
regardless of whether the clip is currently visible. Hiding a clip SHALL be **visual only**: the
element SHALL NOT be conditionally rendered, unmounted, moved behind a mount gate, or suppressed by
any mechanism that permits a user agent to stop rendering it, stop presenting frames from it, or
suspend its decode.

The DOM element the analysis pipeline holds a reference to SHALL remain the same element across
every visibility transition, so that revealing a clip is a change of appearance and never a change
of identity.

This guarantee SHALL be verified by running a real analysis in a browser and comparing the resulting
sampled/detected frame counts against the same clips analysed before the change on the same machine.
Neither type checking nor the unit suite can observe a violation: the test environment has no media
pipeline and no frame-callback implementation, so a hidden element that never presents a frame looks
identical to a working one.

#### Scenario: A clip that is never displayed still analyses

- **WHEN** a clip is loaded while its video element is hidden from the page body and no preview of
  it is open
- **THEN** its analysis reaches `phase: 'ready'` with a detected-frame count consistent with the
  same clip analysed while visible, rather than stalling, timing out, or completing with a
  degenerate sample count

#### Scenario: Revealing a clip does not change which element analysis holds

- **WHEN** a clip's preview is opened and then closed
- **THEN** the video element reference the clip's analysis and skeleton overlay hold is the same DOM
  element throughout — no second element is created for the clip, and the existing one is neither
  remounted nor recreated

#### Scenario: Removing a clip is the only thing that unmounts its element

- **WHEN** a clip is removed from the session, or the whole session is reset
- **THEN** that clip's video element is unmounted and its resources released — the one case where
  the element legitimately goes away

### Requirement: Clip playback loops only while that clip is presented

The system SHALL restart a clip's video from the beginning and loop it continuously, muted, with the
skeleton overlay kept in sync per the existing overlay-sync requirement, exactly while all three of
the following hold: that clip's analysis is at `phase: 'ready'`, no background scale pass for it is
in flight (`'pending'` or `'running'`), and that clip is currently **presented** to the reader. The
three conditions SHALL be one declarative condition owning both arming and re-arming — no
presentation code, and no scale-pass code, SHALL arm or clear the loop imperatively.

When any of the three ceases to hold — the preview is dismissed, a new run starts, or a scale pass
begins — the system SHALL clear `loop` and leave the clip's playback stopped, so that a hidden clip
is never decoding.

While a clip's analysis is at `'sampling'` or `'processing'`, or its scale pass is `'pending'` or
`'running'`, presenting or dismissing that clip SHALL be **purely observational**: it SHALL NOT
start playback, stop playback, seek, arm or clear `loop`, or change `muted`. The analysis pipeline
owns the element's playback state for that whole window, and a presentation-driven write into it
would corrupt a run in progress — a looping element never fires the `ended` event sampling resolves
on, a seek rewinds the sampler, and a pause both stalls sampling and fails an in-flight scale pass.

The system SHALL clear the loop before starting a new analysis run, unconditionally and regardless
of presentation, so that run's sampling can detect the clip's natural end via the video's `ended`
event.

#### Scenario: Presenting a ready clip restarts and loops it

- **WHEN** a clip whose `phase` is `'ready'` with no scale pass in flight is presented
- **THEN** its video seeks to the start and begins playing with `loop` enabled, with no further
  action required from the reader

#### Scenario: Reaching the ready phase while not presented leaves the clip paused

- **WHEN** `phase` transitions to `'ready'` with no scale pass in flight and no preview of that clip
  is open
- **THEN** the clip's video does not begin playing and `loop` is not armed — it stays stopped until
  the clip is presented

#### Scenario: Dismissing a preview stops that clip's playback

- **WHEN** an open preview of a `'ready'` clip is dismissed
- **THEN** that clip's `loop` is cleared and its playback stops, leaving no hidden clip decoding

#### Scenario: The loop re-arms once the scale pass concludes on a presented clip

- **WHEN** a presented clip is `'ready'` and its scale pass transitions from `'pending'`/`'running'`
  to `'done'`, `'failed'`, or `'skipped'`
- **THEN** its video seeks to the start and begins playing with `loop` enabled, exactly as it does
  for a presented clip with no scale pass — the same condition owns both cases, with no scale-pass
  code re-arming the loop imperatively — while a clip that is not presented stays stopped

#### Scenario: The overlay stays in sync through the loop

- **WHEN** a presented clip's video is looping after its `phase` became `'ready'`
- **THEN** the skeleton overlay continues to redraw for the current playback position on every loop
  pass, the same as it does during any other playback (per the existing overlay-sync requirement) —
  including immediately after the loop seeks back to the start

#### Scenario: Looping does not block browser autoplay policy

- **WHEN** the loop-restart's `play()` call is issued outside the synchronous call stack of the
  interaction that presented the clip
- **THEN** the video is muted before that `play()` call, so the browser's autoplay policy does not
  block it

#### Scenario: Starting a new run clears the loop first

- **WHEN** a new analysis run begins for a clip whose video is still looping from a previous run
- **THEN** the video's loop behavior is cleared before that run begins playback for sampling, so the
  video reaches a genuine `ended` event at the end of the new sampling pass instead of looping
  through it — regardless of whether the clip is presented at the time

#### Scenario: Presenting a clip mid-analysis does not disturb the run

- **WHEN** a clip is presented, and then dismissed, while its analysis is `'sampling'` or
  `'processing'` or its scale pass is in flight
- **THEN** the run's playback state is untouched — no seek, no play, no pause, no change to `loop`
  or `muted` — and the run completes exactly as it would have with no preview opened

### Requirement: A clip preview presents that clip's own video with its skeleton overlay

The system SHALL let a reader open a preview of any clip in the session, showing that clip's video
with the pose skeleton overlay drawn over it, and SHALL present the clip's **already-mounted**
element rather than creating a second one. The preview SHALL be dismissible, SHALL trap focus while
open, SHALL be marked as a modal dialog to assistive technology, and SHALL return focus to the
control that opened it when dismissed. The overlay canvas SHALL remain hidden from assistive
technology, as it is today.

A preview SHALL be offered for a clip whose analysis has not produced frames yet — showing the video
with no overlay — rather than being withheld: a reader inspecting a clip mid-analysis is a reasonable
thing to do, and is made safe by the observational rule above.

#### Scenario: Opening a preview shows the clip's video and overlay

- **WHEN** the reader activates a clip's entry in the clip strip and that clip's analysis is
  `'ready'` with frames available
- **THEN** a modal preview opens showing that clip's video with the skeleton overlay drawn over it,
  in sync with playback and on seek while paused, per the existing overlay-sync requirement

#### Scenario: A preview opened before analysis finishes shows the video without an overlay

- **WHEN** the reader opens a preview of a clip whose analysis has not reached `'ready'`
- **THEN** the preview opens and shows that clip's video with no skeleton overlay, and the clip's
  in-flight run is unaffected

#### Scenario: The preview is keyboard-operable and returns focus

- **WHEN** a preview is open
- **THEN** it is marked as a modal dialog, focus is trapped inside it, pressing Escape dismisses it,
  and focus returns to the clip strip entry that opened it

### Requirement: Session status stays a single announced line while per-clip progress moves to the clips

The always-visible analysis status line (`role="status"`) SHALL continue to report the **session**'s
status — including the background scale pass's narration required by "The centimetre card reflects
scale-pass progress" — while the per-clip sampling/processing progress it used to render moves onto
each clip's own entry in the clip strip. Per-clip progress SHALL NOT be duplicated in the session
status line, and the session status line SHALL NOT be replaced by per-clip announcements.

At most one live region SHALL announce clip analysis progress for the whole session, so that a
session with several clips does not produce several live regions announcing over each other.

#### Scenario: The session line survives the move

- **WHEN** every clip in the session reaches `'ready'` and a background scale pass runs
- **THEN** the `role="status"` session line still reads that analysis is complete and still narrates
  the scale pass exactly as specified by "The centimetre card reflects scale-pass progress"

#### Scenario: Several clips do not produce several live regions

- **WHEN** a session holds more than one clip and they are in different analysis phases
- **THEN** each clip's own progress is available to assistive technology as text on that clip's
  entry, but no more than one live region announces clip progress

### Requirement: Evidence renders as annotated thumbnails inside the metric card

The system SHALL render a metric's extracted evidence **inside that metric's own card**, as small
annotated thumbnails, and SHALL render no standalone evidence gallery and no link from a card to one.
The picture and the number it explains SHALL be visible together.

Placement within the card SHALL be: after the metric's description, **below** it when the card is
narrow and **beside** it when the card is wide. The narrow/wide decision SHALL be a function of the
**card's own width**, not the viewport's; a viewport-width rule would place a thumbnail beside a
description in a card with no room for it. The placement SHALL be correct at every card width the
panel produces.

The card grid SHALL be a **single column at every viewport width**. This is a layout decision, not
an artifact: a full-width card is what leaves the description enough room for its thumbnails to sit
beside it on a desktop, which is the placement this requirement asks for. At two- or three-column
density a desktop card is narrow enough that the card-width rule above correctly stacks the
thumbnail, and "beside the description on a desktop" would stop happening at any viewport. The
system SHALL NOT carry column-count utilities that do not take effect; keying the split off the
card's own width rather than the viewport's remains correct regardless, and is what would keep this
placement rule sound if the density were ever revisited.

Thumbnails SHALL be sized for a card rather than for a gallery figure. Display size SHALL remain a
presentation decision expressed in the layout: the system SHALL NOT extract a second copy of an image
at a second resolution to serve a second display size, and every image SHALL share the single aspect
ratio the planning requirement fixes, so a card carrying two thumbnails and a card carrying one read
as the same set.

Each thumbnail SHALL be captioned well enough to be interpretable on its own: which metric it is
evidence for, which side where the metric is per-side, and — for a blended image — which two instants
were blended, in the metric's own words, and when in the clip they occurred. The caption SHALL NOT
additionally state that the two visible positions are one runner rather than two people. Every blended
label this system emits already says one instant is *ghosted against* another, which names a single
subject at two moments; a second sentence restating it is boilerplate in a card that already carries a
description, a value, a confidence line and a caveat, and captions were written for a standalone
gallery figure that no longer exists.

Each thumbnail SHALL carry a text alternative describing what it shows, since the image itself carries
no text. The text alternative MAY state the one-runner framing the caption omits, because alt text is
read out of context and reaches a reader who has none of the card around it. For a blended image the
text alternative SHALL additionally say which of the two instants is the emphasised one, because that
emphasis is carried only by pixels: the photograph is weighted toward its base instant and the base's
marks are drawn solid against the ghost's faded ones, so a reader who cannot see the image learns from
neither. Where more than one clip is present, the card SHALL indicate which clip its evidence came
from.

The rendered image SHALL be the extracted canvas element itself, adopted into the document. The
system SHALL NOT introduce a data URL, blob, object URL, download affordance, or any other
serialization of a thumbnail in order to display it inside a card.

Extraction SHALL run at most once per clip, and whatever component owns it SHALL hold at most one
detached decoder open at a time and SHALL release the detached element, its object URL, and every
retained image when the results unmount or the session resets. Moving the imagery into the cards
SHALL NOT weaken any of those.

#### Scenario: A thumbnail sits below the description in a narrow card and beside it in a wide one

- **WHEN** a metric with evidence renders as a card
- **THEN** its thumbnails render after the card's description — stacked below it while the card is
  narrow, and alongside it once the card is wide enough

#### Scenario: The card's own width drives the split, not the viewport's

- **WHEN** the same card is rendered at a viewport narrow enough that the full-width card is itself
  narrow, and again at a desktop viewport where it is wide
- **THEN** its thumbnails stack below the description in the first case and sit beside it in the
  second, decided by the card's measured width rather than by any viewport breakpoint

#### Scenario: The card grid is one column at every width

- **WHEN** the results render at a narrow, a medium, and a wide viewport
- **THEN** the card grid resolves to a single column at all three, each card spanning the panel's
  full width, and the panel carries no responsive column-count utility that never takes effect

#### Scenario: A ghosted thumbnail says it is one runner, not two people

- **WHEN** a card's evidence is a blended pair
- **THEN** its caption conveys the one-runner framing through the metric's own label alone — one
  instant *ghosted against* another — followed by when in the clip the two instants occurred, and
  carries no further sentence spelling out that the image is not two people; its text alternative
  names the metric, where the metric is per-side the side, and which of the two blended instants is
  shown emphasised rather than faded

#### Scenario: No gallery and no deep link remain

- **WHEN** the results render with evidence for several metrics
- **THEN** no separate evidence section renders anywhere on the page, no card carries a link to one,
  and every image is inside the card for the metric it is evidence for

#### Scenario: Nothing is retained after the results go away

- **WHEN** the results unmount or the session is reset
- **THEN** no detached video element, object URL, or extracted image is retained

### Requirement: Evidence thumbnails annotate the runner's own measured geometry and never a reference posture

A thumbnail SHALL be annotated. The system SHALL draw, over the extracted image, the **detected
joints** the exemplar is about and the **measurement geometry** the metric was derived from — the
segments, reference rays, angle arcs, plumb lines, calipers and midlines that the metric's own
calculation forms. An unannotated photograph shows a moment; an annotated one shows what was measured
in it, which is the question a reader has about a number they did not compute.

Every mark SHALL be derived from **this runner's own keypoints in the depicted frames**. The system
SHALL NOT overlay a reference posture, an ideal, a target, a model or template skeleton, a
"correct-form" outline, or any other geometry the runner did not produce. Where a metric measures a
delta, the only delta shown SHALL be the runner against themself — two instants of one run — never
the runner against a standard. This application holds no reference-form data, and SHALL NOT
synthesize one in order to draw it: a picture of a target implies the system knows what correct form
is, which is a claim this product does not make and cannot support.

The joint layer SHALL preserve the pipeline's own certainty distinction: a keypoint the detector
found directly SHALL read as more certain than one the robustness layer interpolated, and an
unrecoverable keypoint SHALL be drawn not at all rather than faintly. The joint layer SHALL be drawn
only for the keypoints the exemplar's own mark set names — not for the whole skeleton, most of which
falls outside a metric's crop.

The joint layer and the measurement layer SHALL be visually distinguishable from each other, so a
reader can tell "these are the joints the pipeline found" from "this is the thing that was measured".
Annotation SHALL remain legible at the thumbnail's real display size; stroke weights, mark sizes and
any text SHALL be sized against the image the reader actually sees, not inherited from a full-size
video overlay.

A fraction of the canvas is not on its own enough to satisfy that. A fraction fixes a mark's
*apparent* size, but it fixes it at whatever that fraction was worth when it was chosen, and these
images are drawn into a box far smaller than the canvas they are painted on. Any feature whose whole
job is to be **seen as a separate thing** — as opposed to merely to be present — SHALL therefore
carry a floor stated in **display** pixels, resolved against the size the card actually renders the
thumbnail at, in addition to any canvas-pixel floor. A canvas-pixel floor scales with the canvas and
so cannot detect this class of failure at all: the mark stays correctly proportioned right up to the
point where the compositor averages it out of the delivered image entirely. The display size SHALL be
a parameter with a default rather than a constant, so that a larger surface relaxes the floors
instead of inheriting a size only the smallest surface needed.

Separation from the photograph SHALL be carried by a **dark boundary drawn beneath every mark**,
and that boundary is the only mechanism available: the mark colours are light, so their contrast
against a bright photograph is below the 3:1 a reader needs at *any* stroke width and *any* opacity,
while a dark edge between the mark and the photograph reaches it against light and dark ground alike.
The boundary SHALL be present in the **delivered** pixels rather than merely in the canvas — a
boundary thinner than a display pixel is averaged into the mark on one side and the photograph on the
other, so the edge it exists to create is not in the image the reader is served.

The boundary SHALL NOT be scaled by the mark's own opacity. A mark's opacity states how far a reader
should trust it — a ghost instant's marks are weaker than the base's, an interpolated joint weaker
than a detected one — and separability is not part of that statement. A fainter mark needs its
boundary more, not less, because it has less contrast of its own to spend. Emphasis ordering SHALL
continue to be carried by the marks' own colour, so the base still reads ahead of the ghost.

Where a mark's meaning is carried by a **gap** — the dash pattern that separates a construction the
calculation formed from a segment it measured — the gap SHALL be floored in display pixels the same
way, and SHALL be measured on the gap that survives the boundary rather than on the dash pattern
handed to the renderer. The two differ: one path stroked twice means the boundary pass draws the same
dashes at a greater width, and a round cap extends every dash at both ends, so a gap that is adequate
on paper can be closed completely in the image.

Compositing SHALL be explicit: annotation SHALL be drawn at its own intended opacity and SHALL NOT
inherit the ghost's blend opacity by accident, so a ghosted pair's marks are as solid as a single
frame's.

#### Scenario: A metric's own measurement geometry is drawn, not just its joints

- **WHEN** a metric whose quantity is an angle produces evidence
- **THEN** the thumbnail carries that metric's own vertex, its two rays, and the arc between them,
  in addition to the joints the pipeline detected

#### Scenario: No reference or ideal posture is ever drawn

- **WHEN** any metric's evidence renders, for any value, confidence, or camera view
- **THEN** every drawn mark traces positions taken from this runner's own detected keypoints in the
  depicted frames, and no target line, model skeleton, ideal outline, or "correct" posture is drawn
  or offered

#### Scenario: An interpolated joint reads as less certain than a detected one

- **WHEN** a depicted frame carries a mix of directly-detected and interpolated keypoints
- **THEN** the interpolated ones are visibly weaker than the detected ones, and any keypoint the
  robustness layer could not recover is absent rather than drawn

#### Scenario: Only the exemplar's own keypoints are drawn

- **WHEN** a metric's crop covers one limb
- **THEN** the joints drawn are the ones that metric's exemplar names, not every keypoint the pose
  backend emits

#### Scenario: A ghosted pair's annotation is not drawn at the ghost's opacity

- **WHEN** a thumbnail composites a base frame and a ghost frame
- **THEN** the annotation over it is drawn at its own opacity, not at the ghost blend's

#### Scenario: A mark's dark boundary survives being drawn into the card's thumbnail box

- **WHEN** an annotation is sized for a canvas that the card renders into a much smaller box
- **THEN** the boundary beneath every mark resolves to at least the display-pixel floor once scaled
  into that box, on every canvas side the crop planner produces, rather than to a fraction of a
  display pixel that the compositor averages away

#### Scenario: Halving the canvas still halves every weight

- **WHEN** the same annotation is sized for a canvas half as wide
- **THEN** every stroke weight, radius and boundary width is half what it was, because the
  display-pixel floors are themselves proportional to the canvas side, so the proportional sizing the
  fractions exist to provide is preserved rather than replaced

#### Scenario: A weaker mark keeps the same boundary as a stronger one

- **WHEN** a thumbnail draws a ghost instant's marks and an interpolated joint alongside the base
  instant's detected marks
- **THEN** every one of them carries a boundary of the same strength, while the marks themselves keep
  their differing opacities, so the weakest mark is still separable from the photograph and the base
  still reads as the stronger of the two instants

#### Scenario: A construction line still reads as dashed once its boundary is wide enough to see

- **WHEN** a construction line is drawn with a boundary wide enough to survive the downscale
- **THEN** the gap left between its dashes after that boundary's caps have extended them is still at
  least the display-pixel floor, so the line reads as dashed rather than as one continuous bar

#### Scenario: A larger display surface is not given the smallest surface's weights

- **WHEN** the same canvas is sized for a display box substantially larger than the metric card's
  thumbnail
- **THEN** the display-pixel floors bind less or not at all, and the weights fall back to the
  canvas fractions, rather than every surface inheriting the width only the smallest one required

### Requirement: An annotation depicts what was measured at the depicted instant, never the card's reported value

An annotation SHALL depict a quantity that is genuinely present in the frame or pair it is drawn on,
and SHALL be described as **what was measured at that instant**. The system SHALL NOT label a mark
with the metric's reported value unless the drawn quantity and the reported value are the same
quantity, arrived at the same way, over the same instants.

For most metrics they are not, and the gap is structural rather than incidental:

- The vertical-oscillation family (`verticalOscillation`, `verticalOscillationCm`, `verticalRatio`)
  reports an amplitude taken from a **whole-clip least-squares spectral sinusoid fit with a
  `c + d·t + e·t²` trend removed**. The pixel gap between the two ghosted midpoints in the image is a
  two-sample difference that still contains the whole-body translation the fit deliberately subtracts
  — it is not that fitted amplitude. The depicted cycle is chosen as the best-supported one, not the
  largest, so it is not even the clip's biggest bounce. `verticalOscillationCm` is further removed
  still: its fit runs over integrated metre deltas from one winning integration run, so no pixel
  distance in any image is its unit.
- `verticalRatio` reports a quotient formed across two **different** exemplars — a bounce cycle and a
  stride pair. Each image shows one factor of it; neither image shows the quotient.
- `armSwingSymmetry` reports a ratio **between** its two images, one per side. Neither image shows it.
- `overstriding` and `footStrikePattern` divide a drawable pixel offset by a **clip-median torso
  length**. The numerator is drawable; the denominator exists in no single frame.
- `stepWidth` divides its drawable offset by a **clip-median hip width**. The hip-to-hip segment is
  drawable in the frame, but the segment in the picture is that frame's hip width, not the clip median
  the value was divided by — a drawable-looking denominator that is still not the one used.
- `trunkLean` and `overstriding` deliberately select the **extreme** instants while their cards report
  a **median**, so the drawn geometry is by construction not the reported number. `kneeFlexion`'s
  reported value is likewise a median across swing-phase peaks, not the one peak depicted.
- `kneeFlexion` reports `180° − interiorAngle`, so an arc drawn on the interior angle at the knee is
  the **supplement** of the reported value.
- `trunkLean`'s reported value is multiplied by the direction of travel, so on a runner moving
  right-to-left the **sign** of the tilt visible on screen is the opposite of the sign the card
  reports. A mark that reads as "leaning this way" must not be equated with a signed number that means
  "leaning forward" in the runner's own frame of reference.

Where the drawn quantity differs from the reported value, the mark SHALL be captioned as the
per-instant measurement it is, and SHALL NOT be captioned with, annotated with, or visually equated to
the card's number. Where a metric's reported quantity has **no** honest single-still depiction, the
thumbnail SHALL carry the joint layer and whatever per-instant geometry is honestly drawable, and
SHALL carry no numeric label at all — never an invented, approximated, or back-computed one. An
instant carried purely for legibility, that no measurement was taken at, SHALL NOT be captioned as
measured.

`cadence` SHALL emit no evidence. It is a property of a sequence, and no still or pair of stills
depicts a rate. That decision SHALL be enforced independently both at the point the metric would emit
an exemplar and at the point evidence is planned, so that removing either enforcement alone cannot
cause a cadence thumbnail to appear.

This requirement is what keeps the reference-posture prohibition above meaningful. A picture that
silently restates a number it cannot show is already claiming more than it can support; a picture that
went on to show a target as well would be claiming to know what correct form is.

#### Scenario: A fitted amplitude is not labelled on the ghost that illustrates it

- **WHEN** a vertical-oscillation-family metric's evidence renders as a ghosted pair of bounce
  instants
- **THEN** the marks show the two midpoint positions and the gap between them at those instants, and
  neither the marks nor the caption labels that gap with the card's reported amplitude

#### Scenario: A ratio between two images is labelled on neither

- **WHEN** a metric's reported value is a ratio formed across its two exemplars
- **THEN** each image is captioned with what it shows on its own, and neither carries the ratio

#### Scenario: An angle arc is not labelled with a value it is the supplement of

- **WHEN** `kneeFlexion`'s evidence draws the interior angle at the knee
- **THEN** the arc is not labelled with the card's reported flexion value, because the reported value
  is that angle's supplement

#### Scenario: An extreme instant is not captioned as the reported median

- **WHEN** a metric that reports a median selects its most extreme instant as its exemplar
- **THEN** the annotation is captioned as the measurement at that instant, and never as the metric's
  reported value

#### Scenario: A screen-relative tilt is not equated with a travel-signed value

- **WHEN** `trunkLean`'s evidence renders for a runner travelling right-to-left, so the on-screen tilt
  and the reported value carry opposite signs
- **THEN** the drawn torso vector, vertical reference and arc are captioned as the tilt measured at
  that instant, and are not labelled with the card's signed value

#### Scenario: A ratio with an unshowable denominator carries no number

- **WHEN** a metric normalizes a drawable pixel offset by a clip-median body scale
- **THEN** the offset is drawn as the per-instant geometry it is, and no normalized figure is
  rendered on the image

#### Scenario: A legibility-only instant is not captioned as measured

- **WHEN** an exemplar carries a second instant purely so the first is readable, and no value was
  measured at that second instant
- **THEN** that instant's geometry is not captioned or labelled as a measurement

#### Scenario: Cadence renders no thumbnail, and two independent guards say so

- **WHEN** an analysis run completes with a measured cadence
- **THEN** the cadence card renders no thumbnail, and removing either the metric-side or the
  planning-side guard on its own still leaves the other one refusing it

### Requirement: A metric card without evidence is unchanged, and an excluded metric gets none

A metric card whose metric has no evidence SHALL render exactly as it does without this capability —
no thumbnail, no link, no placeholder, no empty frame, no reserved space, and no layout shift. A card
with evidence and a card without SHALL differ only by the presence of the imagery itself. Evidence
coverage varies per clip by design, so the no-evidence card is the common case, not the exception.

Evidence SHALL be offered only for metrics that render as a card. A metric excluded from the card
grid — because nothing was measured, or because the camera geometry cannot support the measurement —
SHALL have no thumbnail and no imagery anywhere, whatever exemplars it may carry: imagery for a
measurement the system declined to report would be a picture explaining a number that is not on
screen.

#### Scenario: A card without evidence is the card it was before this capability

- **WHEN** a metric renders as a card but has no evidence
- **THEN** the card renders with no thumbnail and no placeholder, identically to a build without this
  capability, and its position and height in the grid are unaffected

#### Scenario: An excluded metric gets no thumbnail

- **WHEN** a metric is excluded from the card grid because its value is null or its view fit is
  unsuitable
- **THEN** no thumbnail is rendered for it anywhere, whatever exemplars it may carry

### Requirement: A ghosted pair is judged on the crop it demands, not the crop the frame can supply

The system SHALL reject a two-instant evidence exemplar whose two instants are too far apart to
share one legible image, and SHALL make that judgement on the crop each side **demands** — the
subject's own box, padded, floored against a degenerate box — and SHALL NOT let the frame's own
`min(width, height)` cap enter the comparison.

The rejection criterion is a ratio: the crop the pair demands divided by the crop the better-framed
of its two instants demands alone, which is the factor by which ghosting shrinks the subject on
screen. Clamping the numerator to what the frame can supply destroys that quantity precisely where
it matters: once the pair's demand exceeds the frame, the numerator stops growing while the
separation does not, so every pair past that point — including one at opposite edges of the frame —
reports the same number as one at half the separation.

The two clamps SHALL be treated differently, because they are different. A floor binds from below
and genuinely cancels: a pair whose union the floor already frames costs the reader nothing a single
would not also have paid, and SHALL read as no growth. A cap binds from above and does not cancel;
it SHALL be excluded from the measure.

Excluding the cap SHALL NOT be implemented as, or degenerate into, a test of whether a crop reached
the cap. On a small source the cap binds on every crop, so such a test would delete every ghost on
every webcam clip. The retained floor is what keeps a small source safe: the union's long side
cannot exceed the frame's own larger dimension, so with the denominator resting on the floor the
ratio is bounded, and on a frame small enough that bound sits below the rejection threshold for every
pair the source can produce.

A pair rejected on this criterion SHALL be dropped rather than demoted to one of its instants. Every
paired caption this system emits is a statement about two instants, and no surviving half carries it.

The crop rectangle that is actually drawn SHALL be unchanged by this: the drawn crop remains padded,
squared and clamped to the frame bounds. Only the judgement changes.

#### Scenario: Opposite edges of a large frame are distinguished from adjacent instants

- **WHEN** a metric emits a pair on a 3840×2160 clip whose subject box is a full-body 320×1240, at
  three separations — adjacent, half a frame apart, and at opposite edges of the frame
- **THEN** the three readings are distinct and strictly increasing, and the opposite-edge pair is
  rejected, rather than all three passing on readings that differ by under a tenth

#### Scenario: A runner who crossed the frame produces no evidence image at all

- **WHEN** a metric's two extreme instants put the runner at opposite edges of the frame, so their
  union crop would saturate at the frame's own dimension and centre on background with neither
  runner inside it
- **THEN** the pair is dropped and that metric reports no evidence, rather than rendering a crop of
  empty background captioned as a measurement

#### Scenario: An ordinary pair on a small source is still ghosted

- **WHEN** a clip is small enough that every crop reaches the frame cap — a 320×240 webcam
  recording — and a metric emits an ordinary pair on it, at any separation the source can produce
  and for any subject size the frame can hold
- **THEN** the pair is ghosted normally, because the retained floor bounds the ratio below the
  rejection threshold there, and no ghost on that clip is deleted

#### Scenario: The drawn crop is unaffected by the change of measure

- **WHEN** a pair passes the criterion and is ghosted
- **THEN** the rectangle both instants are drawn through is exactly the padded, squared,
  frame-clamped rectangle it was before, so no surviving image changes

#### Scenario: The development-only coverage output reports the reading it was judged on

- **WHEN** an evidence run completes in a development build and emits its separately-prefixed
  evidence coverage output
- **THEN** each exemplar record carries the growth reading for the image it produced, as a number
  beside the crop side already reported, and an explicit absence for a single-instant exemplar and
  for a pair demoted to its base
- **AND** that output remains parseable as JSON and carries nothing image-shaped — no canvas, blob,
  object URL or data URI

### Requirement: An undrawable exemplar falls back to the next-best pair before the metric loses its evidence

When an exemplar offers ranked alternative pairs, the system SHALL walk that list in order and plan
the **first pair it can actually render**, and SHALL report that the metric has no evidence only
once every offered pair has failed. Dropping the metric on the strength of its first pair alone
makes coverage hinge on the geometry of one frame pair, which is the same defect as scoring a
single pre-chosen instant instead of ranking many — one level up.

The walk SHALL fall back on **any** reason the pair could not be rendered, not only on the two
instants being too far apart to share a crop. A pair whose ghost does not resolve to a sampled
frame, whose two instants land on the same frame, whose boxes are near-identical, or which has no
derivable crop region, is as undrawable as one that is too far apart, and a lower-ranked pair may
suffer from none of them.

Falling back SHALL NOT weaken any drop rule. Each candidate pair SHALL be planned by exactly the
same rules the winner is planned by, including the emission-quality gate, so a fallback pair can
only be rendered on terms the winner would also have had to meet. In particular, a pair too far
apart SHALL still be dropped rather than demoted to one of its instants — the fallback replaces
the pair, it never rescues half of one.

The rendered result SHALL describe the pair that was actually drawn. The instants, the quality and
the growth reading reported for the image SHALL be the selected pair's own, so that a reader —
and the development-only evidence coverage output — is never told about a pair the image does not
show.

The per-metric image budget SHALL be applied after the walk, unchanged: a fallback consumes the
slot its exemplar already owned and SHALL NOT let one metric render more images than before.

#### Scenario: An un-croppable winner is replaced rather than dropped

- **WHEN** a metric's best-scoring pair puts the subject at opposite edges of the frame, so ghosting
  the two would shrink the subject past legibility, and a lower-ranked pair sits close enough
  together to share a crop
- **THEN** the lower-ranked pair is rendered, and the metric reports evidence rather than reporting
  that all its candidates were gated out

#### Scenario: A drawable winner is untouched

- **WHEN** a metric's best-scoring pair can be rendered
- **THEN** it is rendered and no alternative is examined, so the image, its instants, its quality
  and its growth reading are exactly what they were before alternatives existed

#### Scenario: No offered pair is drawable

- **WHEN** every pair a metric offers fails to render, whatever the reason
- **THEN** the metric reports no evidence with the same reason it reported before, rather than
  rendering a pair that failed a drop rule

#### Scenario: The reported image describes the pair that was drawn

- **WHEN** a fallback pair is rendered in place of the winner
- **THEN** the reported instants, quality and growth reading are the fallback pair's own, not the
  rejected winner's

#### Scenario: Falling back does not enlarge the per-metric image budget

- **WHEN** a metric's exemplars each fall back to an alternative pair
- **THEN** the metric renders no more images than the per-metric budget already allowed, because
  the alternatives belong to the exemplars rather than adding to them

### Requirement: A ghosted evidence photograph is weighted toward its base instant

The system SHALL composite a ghosted pair so that the base instant contributes **strictly more** of
the resulting image than the ghost does, and SHALL keep the ghost heavy enough to remain identifiable
as a body at the thumbnail's real display size.

The reason is that the other two layers of the same image already pick a winner and the photograph
must not contradict them. The annotation layer is asymmetric by requirement — a ghosted pair's marks
are as solid as a single frame's, while the ghost's are weaker — and the caption names one instant
*ghosted against* another. A photograph that picks no winner, under an annotation and a caption that
both do, is a picture contradicting its own labels, and a reader resolves that contradiction from
whatever cue happens to be strongest in that particular image, which is not reliably the base.

The photographic weight and the annotation mark opacity SHALL be **separate decisions carried by
separate constants**. The annotation layer SHALL NOT derive its mark opacity from the plan's
photographic blend value: they answer different questions, and one number serving both means moving
either one silently moves the other.

The weighting SHALL be chosen by looking at rendered thumbnails **at the size the reader actually
sees**, across more than one clip, rather than by taste. A ghost's visibility is a function of that
clip's own subject-against-background contrast — on a static camera the shared background reproduces
at full contrast whatever the blend, while each body's contrast scales with its own weight — so a
weighting that reads well on one clip is not evidence about another.

#### Scenario: A ghosted thumbnail's base instant reads as the foreground body

- **WHEN** an exemplar naming two instants renders as a single ghosted thumbnail
- **THEN** the base instant contributes strictly more of the composited image than the ghost, and at
  the thumbnail's real display size the base body reads as the foreground body rather than the two
  reading as equals

#### Scenario: The ghost stays visible as a body

- **WHEN** a ghosted thumbnail is viewed at its real display size
- **THEN** the ghost instant is still identifiable as a second position of the same body, not a
  smudge — the delta the image exists to show survives the weighting

#### Scenario: Photographic weight and annotation opacity are independent

- **WHEN** the photographic blend weight of a ghost is changed
- **THEN** the opacity of the ghost's annotation marks is unchanged, because the two are carried by
  different constants and the annotation layer never reads the plan's photographic blend value

### Requirement: A measurement mark that needs a per-instant side is drawn on every instant that states one

Where a mark builder needs to know which side of the body an instant was measured on before it can
place a mark, it SHALL draw that mark for **every** instant whose side is resolvable, and SHALL
resolve that side from the instant's own per-instant statement before falling back to the
exemplar's clip-level one. An exemplar whose two halves were measured on different sides is the
case this exists for: reading one side for the whole exemplar draws the second half's mark from the
wrong limb, or — where the builder refuses a mismatch — draws nothing on that half at all.

A metric SHALL NOT be exempted from this by its identity. Two metrics reporting the same per-side
quantity in different units SHALL draw the same measurement geometry: a unit conversion is not a
reason for one thumbnail to lose the mark its sibling keeps, and a reader comparing the two cards is
comparing the same measurement.

Where a mark is directional, its orientation SHALL be read from the plan the mark is drawn from —
the frames, travel direction and per-instant signs that plan carries — and never from the metric's
identity. A directional mark whose orientation is not derivable from its own plan
(`travelDirection` indeterminate, or a degenerate per-instant sign) SHALL still draw its measured
span, unoriented; withholding a direction SHALL NOT withhold the measurement. There SHALL be no
set of metric ids whose polarity is suppressed independently of what their plan supports: a metric
whose evidence is planned from the pass that measured it has a derivable, correct polarity, and
withholding it would withhold a correct answer while leaving the reader no way to tell that from a
genuinely underivable one.

This is the rendering half of `form-heuristics`'s per-instant-side contract, and it is stated
because the two halves failed independently: a metric can satisfy its own contract's letter while
the mark that depends on it is never drawn, and nothing between them notices. Concretely, the
ankle-offset caliper is the whole of what a step-width image has to show — the hip-width segment and
the hip-midline plumb are context for it — so a step-width thumbnail without its caliper is a
picture of everything except the measurement.

#### Scenario: An opposite-side pair draws its measurement mark on both halves

- **WHEN** a step-width metric's evidence renders as a ghosted pair of opposite-foot plants
- **THEN** the ankle-offset caliper is drawn on both the base and the ghost, each measured from the
  ankle that half's own strike was measured from

#### Scenario: A unit sibling draws the same measurement mark as the metric it mirrors

- **WHEN** two metrics report the same per-side quantity in different units and both plan evidence
  for the same clip
- **THEN** both thumbnails carry the same measurement geometry, and neither is reduced to its
  context marks alone

#### Scenario: An unresolvable side drops only the marks that need it

- **WHEN** an instant's measured side cannot be resolved from anything the metric stated
- **THEN** the marks that do not depend on a side are still drawn, and the side-dependent mark is
  omitted rather than anchored on a guessed limb

#### Scenario: A suppressed polarity still draws the span

- **WHEN** a directional mark's orientation is not derivable from its own plan
- **THEN** the measured span is still drawn, unoriented, and only its direction indicator is
  withheld — withholding a direction never withholds the measurement

#### Scenario: A grafted metric orients its marks from the pass that measured it

- **WHEN** a metric grafted from the background scale pass plans a directional mark, and that
  plan's frames are the scale pass's own
- **THEN** the mark is oriented from that plan exactly as its non-grafted unit sibling would be,
  and its polarity is not withheld on account of the metric's identity

### Requirement: A grafted metric's evidence is planned from the frames that measured it

Where a completed background scale pass has replaced metrics on the displayed result, the system
SHALL retain that pass's own robust frames alongside the metrics it grafted, and SHALL plan those
metrics' evidence — the frames their timestamps resolve against, the crop derived from them, every
joint position an annotation draws, and every directional sign a mark's orientation is read from —
against **those** frames, not against the primary pass's.

Every metric the graft did not replace SHALL continue to be planned against the primary pass's
frames, unchanged. A run with no completed graft SHALL plan every metric exactly as it did before
this rule existed.

The scale pass's frames SHALL be committed in the **same** state write as the grafted metrics, so
that "these metrics came from the scale pass" and "here are the frames that measured them" are one
fact rather than two that can be observed apart. Their **presence** SHALL be what tells the planner
a graft occurred; the planner SHALL NOT infer it from a metric's identity alone, because a primary
pass that measures real-world scale itself grafts nothing and its centimetre metrics are already
planned against the frames that measured them.

Retaining those frames SHALL NOT change what the interface displays as the run's own frames: the
skeleton overlay, and every non-grafted metric, still read the primary pass's.

This is a statement about which detector's estimate an image asserts, not about tidiness. A frame
carries the joint positions an annotation draws AND the left/right ordering of the hips that a
lateral caliper's polarity is read from, and two detectors watching the same runner at the same
instant can order those hips oppositely — measured on this repo's own footage at 26% of the
side-view clip's instants and 17% of the multi-person clip's, against 0% of the front-approach
clip's, the difference tracking how far apart the two hips sit on screen. A polarity read off the
wrong pass's frame labels a crossover strike as landing on its own side.

The existing subject-agreement check SHALL NOT be treated as covering this. That check compares the
two passes' bounding boxes to decide whether they selected the same **person**; a bounding box is a
hull and is identical under a left/right relabelling, so the same run can report agreement on a
large majority of instants while a quarter of those instants order the hips oppositely. The two
answer different questions and both are required.

#### Scenario: A grafted metric's polarity comes from its own pass

- **WHEN** the two passes resolve the same instant with the runner's two hips ordered oppositely,
  and a grafted metric's exemplar names that instant
- **THEN** the planned instant's outward sign is the one the grafting pass's frame yields, and a
  metric the graft did not replace still carries the sign the primary pass's frame yields

#### Scenario: A grafted metric's joints are drawn where its own pass estimated them

- **WHEN** the two passes place the same joint at materially different positions at a shared instant
- **THEN** the grafted metric's planned keypoint positions, and the crop derived from them, are the
  grafting pass's

#### Scenario: A run with no graft plans exactly as it did before

- **WHEN** no background scale pass has completed — because it was skipped, failed, or because the
  primary pass measured real-world scale itself and no graft was needed
- **THEN** no scale-pass frames are carried, and every metric including the centimetre ones is
  planned against the primary pass's frames

#### Scenario: An instant only the grafting pass sampled still yields evidence

- **WHEN** a grafted exemplar names an instant that the grafting pass sampled and the primary pass
  did not
- **THEN** that instant resolves against the grafting pass's own frames and the evidence is planned,
  rather than being refused for want of a primary frame it never needed

### Requirement: Evidence already on screen survives a re-extraction

An analysis result is not final when it first renders: the background scale pass grafts its
centimetre metrics into the fused heuristics one clip-replay later, which legitimately changes what
some metrics' evidence should depict. The system SHALL absorb that second arrival without taking the
first arrival's imagery off the screen.

The system SHALL decide whether a clip's already-extracted evidence can be reused by comparing the
inputs that **determine the pixels** — the clip's extraction plan and the source blob the frames are
decoded from — and SHALL NOT key that decision on the identity of an upstream object that merely
contains them. A graft that replaces two of a result's metrics leaves the other metrics' plans
unchanged, and re-decoding a clip to reproduce images that were already correct is work whose only
observable effect is to remove them from the screen while it runs.

While a re-extraction is in flight for an unchanged set of clips, the system SHALL continue to
render the evidence produced by the previous pass, and SHALL replace it only when the new pass
settles. Evidence SHALL be withheld entirely only when none has ever been produced for the current
session.

Carrying evidence forward SHALL be conditional on the set of clips being unchanged. A section
addresses its source clip by position in the session's clip list, so a clip added or removed
invalidates that addressing; in that case the system SHALL withhold evidence rather than render an
image attributed to the wrong clip.

#### Scenario: The scale-pass graft does not blank the thumbnails

- **WHEN** a clip's evidence has been extracted and rendered, and the background scale pass then
  completes and grafts its centimetre metrics into that clip's heuristics
- **THEN** the thumbnails already on screen remain rendered continuously, and the cards' layout does
  not collapse and reflow, whether or not the graft causes a new extraction to run

#### Scenario: An unchanged plan re-decodes nothing

- **WHEN** an evidence input changes in a way that leaves every metric's extraction plan and the
  clip's source blob identical to the ones the cached evidence was extracted from
- **THEN** the cached images are reused, no detached decoder is opened for that clip, and the
  rendered evidence is the same set of images rather than an equivalent freshly-decoded set

#### Scenario: A changed plan re-extracts without a visible gap

- **WHEN** the graft changes a metric's plan, so that clip genuinely requires a new extraction pass
- **THEN** the previous pass's images stay on screen for the duration of the new pass, and are
  replaced by the new pass's images only once it settles

#### Scenario: Adding or removing a clip withholds evidence rather than mis-attributing it

- **WHEN** a clip is added to, or removed from, the session while evidence is on screen
- **THEN** the previous sections are not carried forward, because a section's clip index addresses a
  position in the clip list that the change has invalidated

### Requirement: A pair's joint layer draws each instant's own measured limb while the crop frames both

Where a ghosted pair's two instants were measured on different sides, the joint layer SHALL draw, at
each instant, the keypoints THAT instant's own measurement was about — and SHALL NOT draw the other
instant's. This is the sibling of "A measurement mark that needs a per-instant side is drawn on every
instant that states one": that requirement makes the amber measurement mark per-instant, and this one
makes the cyan joint layer per-instant, so the two layers of one image agree about which limb the
picture is about. A joint layer drawn from the union states that both limbs were measured at both
moments, in the same colour as the correct joints, with nothing on the image distinguishing them.

The drawn set SHALL be resolved from the exemplar's per-instant statement where the metric made one,
falling back to `cropKeypoints` where it did not — which is correct by construction on an exemplar
whose two sets coincide. It SHALL NOT be derived by filtering `cropKeypoints` downstream, because a
crop set legitimately names context belonging to neither instant's measurement.

**Narrowing the drawn set SHALL NOT remove any measurement mark.** A mark builder resolves its inputs
against the drawn set alone and returns nothing for a name that is absent — indistinguishably from a
keypoint the robustness layer lost — so a caliper, line or midpoint whose endpoint left the set would
be dropped silently, with no error and no coverage field recording it. Every mark the measurement
layer drew from the union SHALL still be drawn from the per-instant set, on every instant that drew
it before.

**The crop rectangle SHALL be unaffected.** The image must still contain both instants, so the crop
continues to be derived from the union across the pair. A change to which joints are drawn SHALL NOT
move, resize or re-aim the crop, and SHALL NOT change which exemplar or which pair was selected.

#### Scenario: Each half of a mixed-foot ghost shows only its own leg

- **WHEN** a ghosted pair whose two instants were measured on opposite feet is annotated
- **THEN** the base instant's joint marks name that instant's measured ankle and the hips, the ghost
  instant's name the other ankle and the hips, and no bone drawn at either instant touches the side
  that instant was not measured on

#### Scenario: Every measurement mark survives the narrowing

- **WHEN** the same pair is annotated from a plan carrying the per-instant sets and from one carrying
  only the crop set
- **THEN** the measurement-layer marks are the same roles on the same instants in both, and only the
  joint and bone marks differ

#### Scenario: The crop is unchanged by the per-instant sets

- **WHEN** a plan is built from an exemplar carrying per-instant annotation sets and from the same
  exemplar with those sets removed
- **THEN** the two plans' crop rectangles are identical

