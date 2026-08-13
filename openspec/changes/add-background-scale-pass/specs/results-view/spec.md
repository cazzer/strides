## ADDED Requirements

### Requirement: Background scale pass grafts measured vertical oscillation

The system SHALL, after an analysis run reaches `phase: 'ready'` on a primary pass that measured
no real-world scale, run one background sampling pass over the same video using a dedicated
MediaPipe Pose Landmarker detector, compute form heuristics over that pass's frames through the
identical sort → robustness → presence-trim → heuristics pipeline the primary pass uses, and —
when the scale pass's `verticalOscillationCm.calibration` is non-null — replace ONLY the
displayed result's `verticalOscillationCm` with the scale pass's, carrying its `calibration` by
reference and appending a provenance sentence (naming the second, scale-aware detection pass) to
its caveat. Every other metric and the `view` result SHALL remain reference-identical to the
primary pass's, and the primary run's `diagnostics` SHALL remain the primary pass's own. The
pass SHALL be tracked as a status machine (`'idle' | 'pending' | 'running' | 'done' | 'failed' |
'skipped'`) on the analysis state; it SHALL be skipped (never started) when the primary result
already carries a measured scale (`verticalOscillationCm.calibration !== null`) or when the
scale-pass config's kill switch is off — the config being resolvable in development builds via a
`window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__` override, defaulting to enabled. Any scale-pass
failure — detector unavailable, playback or sampling failure, a wall-clock watchdog expiry of at
least `max(30s, 3 × clip duration)`, or a completed pass that measured no scale — SHALL mark the
pass `'failed'` and leave the primary result untouched. A `reset()` or a newly loaded clip SHALL
stop an in-flight scale pass, and a superseded pass's late resolution SHALL never write state,
under the same run-identity guard the primary run uses.

#### Scenario: A completed scale pass grafts the centimetre metric and nothing else

- **WHEN** the primary pass reaches `'ready'` with `verticalOscillationCm.calibration: null` and
  the background scale pass completes with a non-null `calibration`
- **THEN** the displayed heuristics' `verticalOscillationCm` becomes the scale pass's (its
  `calibration` by reference, its caveat ending with the provenance sentence), every other
  metric and `view` remain reference-identical to the primary pass's, the run's `diagnostics`
  remain the primary pass's, and the pass's status is `'done'` with the scale pass's own
  diagnostics attached

#### Scenario: The pass is skipped when the primary pass already measured scale

- **WHEN** the primary pass reaches `'ready'` with a non-null
  `verticalOscillationCm.calibration` (e.g. a mediapipe-primary dev override)
- **THEN** no scale pass starts, its status is `'skipped'` with reason `'primary-scale'`, and
  the displayed result is exactly the primary pass's

#### Scenario: The kill switch skips the pass

- **WHEN** the resolved scale-pass config has `enabled: false` (in development, via
  `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`) and a run reaches `'ready'`
- **THEN** no scale pass starts, its status is `'skipped'` with reason `'disabled'`, and the
  centimetre metric renders exactly as it would without this capability

#### Scenario: A failed scale pass leaves the primary result untouched

- **WHEN** the scale pass fails — its detector cannot be created, its sampling rejects, its
  watchdog expires, or it completes without measuring any scale
- **THEN** the pass's status is `'failed'`, and the displayed heuristics, diagnostics, and phase
  are exactly what the primary pass produced

#### Scenario: A measured-but-unfittable scale pass still grafts, with its reason

- **WHEN** the scale pass completes with a non-null `calibration` whose amplitude is `null`
  (a fit-failure reason names why)
- **THEN** the grafted `verticalOscillationCm` carries that null value and its fit-failure
  caveat plus the provenance sentence — replacing the primary's now-false "no scale was
  measured" availability caveat

#### Scenario: A superseded scale pass never writes state

- **WHEN** `reset()` is called, a new clip loads, or `start()` begins a new analysis run while
  a scale pass is `'running'`
- **THEN** the pass's sampling handle is stopped before the new run samples (a still-attached
  scale sampler must never run inference concurrently with a primary pass), and any late
  resolution of its promise writes nothing — no graft, no status change on the new run's state

#### Scenario: A user pause mid-pass fails the pass fast

- **WHEN** video playback pauses while the scale pass is `'running'` and the video has not
  reached its natural end
- **THEN** the pass is stopped and marked `'failed'` immediately (a paused replay produces no
  frames; waiting for the watchdog would leave a false "measuring" state up for tens of
  seconds), while a pause event fired by the clip's natural end is ignored

### Requirement: The centimetre card reflects scale-pass progress

The system SHALL, while a scale pass is `'pending'` or `'running'` and `verticalOscillationCm`
is excluded with a `null` value, render that metric's excluded entry with a hint that
real-world scale is being measured by a second detection pass, in place of its availability
caveat. When the pass concludes, the metric SHALL render through the existing confidence-tier
rules with no scale-pass-specific card treatment: a grafted non-null value lands in whatever
tier its own confidence puts it in (its caveat, including the provenance sentence, rendering
per that tier's existing rules). After a `'failed'` pass, a null-valued entry SHALL say that a
second pass tried but couldn't measure (the availability caveat alone would imply the
capability is absent when the app just ran it); after a `'skipped'` pass it SHALL fall back to
the metric's own caveat verbatim, exactly as it renders today. The always-visible analysis
status line (`role="status"`) SHALL narrate the pass — an in-progress sentence while
`'pending'`/`'running'` and a one-sentence outcome on `'done'` or `'failed'` — since the
excluded-list hint may sit below the fold and the status line is the panel's only
screen-reader announcement path.

#### Scenario: The excluded entry hints at the in-flight pass

- **WHEN** the scale pass is `'pending'` or `'running'` and `verticalOscillationCm.value` is
  `null`
- **THEN** the excluded section's entry for it shows the measuring-scale hint instead of the
  availability caveat

#### Scenario: A grafted value renders as an ordinary tiered card

- **WHEN** the scale pass completes and grafts a non-null `verticalOscillationCm` (measured
  values are never excluded for low confidence, per the exclude-only-unmeasurable-metrics rule)
- **THEN** the metric renders as a card in its confidence tier, its note carrying the grafted
  caveat with the provenance sentence — no new card state, styling, or tier is introduced

#### Scenario: A failed pass says the attempt happened

- **WHEN** the scale pass is `'failed'` and `verticalOscillationCm.value` is `null`
- **THEN** the excluded entry says a second pass tried to measure real-world scale for this
  clip but couldn't — not the bare availability caveat, which would imply the capability was
  never exercised

#### Scenario: A skipped pass falls back to the caveat

- **WHEN** the scale pass is `'skipped'` and `verticalOscillationCm.value` is `null`
- **THEN** the excluded entry shows the metric's own caveat verbatim, with no in-progress hint

#### Scenario: The status line narrates the pass

- **WHEN** the analysis is `'ready'` and the scale pass is `'pending'`/`'running'`, then later
  `'done'` or `'failed'`
- **THEN** the `role="status"` completion line appends an in-progress sentence while the pass
  runs and a one-sentence outcome when it concludes; a `'skipped'` pass appends nothing

## MODIFIED Requirements

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
