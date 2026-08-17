# results-view (delta)

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: The scale pass's selected subject is checked against the primary pass's

The system SHALL, before grafting a completed background scale pass's metrics, compare the two
passes' independently selected subjects and record the outcome on the scale-pass state as
`subjectAgreement`, carrying a `status` of `'agreed'`, `'diverged'`, or `'no-opinion'`, a typed
`reason` (`'primary-not-selected'`, `'scale-not-selected'`, `'too-few-comparable-instants'`, or
`null`), and the `comparedInstants`/`agreeingInstants` counts the verdict was computed from.

The comparison SHALL be made **at matched timestamps**, not between aggregate statistics of the two
winners: for each pass, a bounding box SHALL be derived per robust frame from that frame's
`'detected'` keypoints alone, using the run's own resolved person-selection confidence bounds, so
the boxes are exactly those the selection stage scored. Each primary box SHALL be paired with the
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
