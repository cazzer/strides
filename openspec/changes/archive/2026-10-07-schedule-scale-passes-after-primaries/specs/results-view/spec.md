## MODIFIED Requirements

### Requirement: Background scale pass grafts measured vertical oscillation

The system SHALL, after an analysis run reaches `phase: 'ready'` on a primary pass that measured
no real-world scale, and once that clip's session allows it (see `multi-clip-analysis`, "At most
one scale pass runs, and none while a primary is outstanding"), run one background sampling pass
over the same video using a dedicated MediaPipe Pose Landmarker detector, compute form heuristics over that pass's frames through the
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
never write state, under the same run-identity guard the primary run uses. A pass that is due
but not yet allowed SHALL stay `'pending'`, sampling nothing, until it is allowed; and withdrawing
that allowance once a pass has started SHALL NOT stop or alter it. A clip analysed on its own is
always allowed, so its pass starts as soon as its primary is `'ready'`.

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


#### Scenario: A queued pass waits for the session's scale-pass lane

- **WHEN** a clip's primary pass reaches `'ready'` with its scale pass `'pending'` while its session
  has not yet allowed that clip a scale pass (another clip's primary is outstanding, or another
  clip's scale pass is running)
- **THEN** the pass stays `'pending'` and samples nothing, the primary result is displayed
  unchanged, and the pass starts once the session allows it — and if the allowance is withdrawn
  after the pass has started, the pass is neither stopped nor failed and completes as it would have
