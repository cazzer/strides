# analysis-diagnostics Specification

## Purpose
Aggregates machine-readable diagnostics about a completed analysis run — keypoint resolution,
view detection, sampling, and per-metric confidence inputs — and surfaces them in development
builds so low-confidence results can be diagnosed programmatically across many test clips,
instead of only through rendered end-user text.
## Requirements
### Requirement: Diagnostics aggregation
The system SHALL provide a pure function that computes an `AnalysisDiagnostics` object from a
completed run's `PoseSample[]`, `RobustPoseFrame[]`, `FormHeuristicsResult`, which sampler (the
WebCodecs sequential-decode path or the `<video>`-playback path) produced those samples, and the
retroactive person-selection stage's own diagnostics — the last two passed in explicitly by the
caller, since nothing about the samples themselves reveals which sampler made them nor which of
their null frames were nulled by person selection rather than missed by the detector — without
requiring any additional instrumentation of the sampling or robustness layers.

#### Scenario: Keypoint resolution is aggregated across the whole clip
- **WHEN** diagnostics are computed for a set of `RobustPoseFrame[]`
- **THEN** the result includes, per keypoint name, a count of frames where that keypoint was
  `'detected'`, `'interpolated'`, and `'unrecoverable'`, summing to the total frame count

#### Scenario: View detection diagnostics are surfaced verbatim
- **WHEN** diagnostics are computed
- **THEN** the result includes the `FormHeuristicsResult.view` object's own `view`, `confidence`,
  and `diagnostics` (`bilateralSpreadRatio`, `sagittalExcursionRatio`, `frameCoverage`) fields,
  not a recomputation of them

#### Scenario: Sampling counts distinguish detected from missing frames
- **WHEN** diagnostics are computed from the run's `PoseSample[]`
- **THEN** the result includes the total sample count and how many had a non-null `frame` versus
  a null `frame` — counted over the POST-person-selection sequence, which is what every later
  stage sees

#### Scenario: Sampling diagnostics report which sampler produced the run
- **WHEN** diagnostics are computed for a run
- **THEN** the result's sampling summary includes which sampler produced the samples —
  `'sequential'` for the WebCodecs decode-order path or `'playback'` for the
  `<video>`-`requestVideoFrameCallback` path — reflecting exactly what that run actually used

#### Scenario: Per-metric confidence inputs are included for every metric
- **WHEN** diagnostics are computed
- **THEN** the result includes, for every metric in `FormHeuristicsResult`, its `value`,
  `confidence`, `viewFit`, `frameCoverage`, `interpolatedFraction`, `sampleSize`, and `caveat` —
  the same fields already on `MetricResult`, collected in one place keyed by metric id

### Requirement: Development-only automatic console export
The system SHALL log the computed diagnostics to the console as a single JSON-serialized
message, automatically once an analysis run reaches `phase: 'ready'`, only when running in a
development build (`import.meta.env.DEV`). It SHALL NOT log, prompt, or otherwise surface
diagnostics in a production build, and SHALL NOT require any user interaction (no button, no
manual trigger) to produce the log.

#### Scenario: Diagnostics are logged automatically on completion in development
- **WHEN** `phase` transitions to `'ready'` and `import.meta.env.DEV` is `true`
- **THEN** the console receives one message containing the full `AnalysisDiagnostics` object,
  serialized as JSON, without any prior user action beyond starting the analysis

#### Scenario: Nothing is logged in a production build
- **WHEN** `phase` transitions to `'ready'` and `import.meta.env.DEV` is `false`
- **THEN** no diagnostics-related console output occurs

#### Scenario: Re-running analysis logs again
- **WHEN** a completed run is followed by "Analyze again" and that new run also reaches
  `phase: 'ready'`
- **THEN** a new diagnostics log is emitted for the new run, reflecting its own data

### Requirement: Scale-calibrated vertical oscillation appears only when measured
The system SHALL include a `scaleCalibration` block in the diagnostics object when, and only
when, the input `FormHeuristicsResult`'s `verticalOscillationCm.calibration` is non-null —
reporting the centimetre amplitude, the number of complete bounce cycles observed (both the
fractional sum across contributing runs and its floored count), the statistics
of the spectral fit the amplitude came from (or `null` when no fit produced one), the typed reason
no amplitude was produced (or `null` when one was), the scale drift ratio, the median
pixels-per-metre, the implied torso length in metres, the scale coverage, and the number of
independent integration runs that contributed — that same `calibration` value, by reference, never
a recomputation. When `verticalOscillationCm.calibration` is `null`, because the detection backend
does not measure real-world scale or no frame carried a usable scale, the key SHALL be absent from
the object entirely rather than present with a `null` or `undefined` value, so that a run on a
scale-less backend carries no trace of this block at all — the object is exactly what it would be
if this capability did not exist.

#### Scenario: Diagnostics from a scale-less backend carry no scale-calibration key
- **WHEN** diagnostics are computed from a `FormHeuristicsResult` whose
  `verticalOscillationCm.calibration` is `null`
- **THEN** the serialized diagnostics object contains no `scaleCalibration` property at all

#### Scenario: A measured calibration is surfaced verbatim
- **WHEN** diagnostics are computed from a `FormHeuristicsResult` whose
  `verticalOscillationCm.calibration` is non-null
- **THEN** the diagnostics object's `scaleCalibration` is that exact value by reference, not a
  recomputation or a rounded restatement of it

#### Scenario: A measured-but-unfittable calibration still appears, with its reason
- **WHEN** diagnostics are computed from a `FormHeuristicsResult` whose
  `verticalOscillationCm.calibration` is non-null but whose amplitude is `null` because no
  integration run produced a usable fit
- **THEN** the `scaleCalibration` key is present, carrying the null amplitude, a null fit, the
  typed failure reason, and the scale statistics that were measured — the key is omitted only when
  `calibration` itself is `null`, never merely because no amplitude could be fitted

### Requirement: Scale-pass diagnostics export under a distinct prefix

The system SHALL log, in development builds only (`import.meta.env.DEV`), a second console line
prefixed `[analysis-diagnostics:scale-pass]` exactly once per background scale pass reaching a
terminal status (`'done'`, `'failed'`, or `'skipped'`), carrying a JSON payload of the pass's
`status`, its skip `reason` (`'disabled'` or `'primary-scale'`, present only when skipped), its
`error` message (present only when failed), its `subjectAgreement` verdict (present only when the
subject-agreement check ran, i.e. on `'done'`), and — on `'done'` only — the scale pass's own full
`AnalysisDiagnostics` object (whose `scaleCalibration` block is the grafted metric's
`calibration` by reference). The `subjectAgreement` payload SHALL carry the verdict's `status`,
typed `reason`, and both instant counts, so the *margin* behind an `'agreed'`/`'diverged'` verdict
is readable on every development run rather than only the boolean outcome. The existing
`[analysis-diagnostics]` line SHALL remain unchanged in trigger, prefix, and payload shape: it
reports the PRIMARY pass only, and its `scaleCalibration` key's presence reflects whether the
PRIMARY backend measured a real-world scale — never the scale pass's measurement. Neither line
SHALL be emitted in a production build.

#### Scenario: A completed scale pass logs its own diagnostics under the distinct prefix

- **WHEN** the scale pass reaches `'done'` in a development build
- **THEN** the console receives one `[analysis-diagnostics:scale-pass]` message whose JSON
  payload has `status: 'done'` and the scale pass's full diagnostics, including a
  `scaleCalibration` block

#### Scenario: A skipped or failed pass logs its status and cause, without diagnostics

- **WHEN** the scale pass reaches `'skipped'` (with reason `'disabled'` or `'primary-scale'`) or
  `'failed'` (with an error message) in a development build
- **THEN** the console receives one `[analysis-diagnostics:scale-pass]` message carrying that
  status and its `reason` or `error`, with no `diagnostics` key

#### Scenario: The primary diagnostics line is unaffected by the scale pass

- **WHEN** a run's primary pass reaches `'ready'` and its background scale pass subsequently
  completes with a measured scale
- **THEN** exactly one `[analysis-diagnostics]` line was emitted for the run, at the same moment
  and with the same payload it would have had without any scale pass — in particular, with no
  `scaleCalibration` key when the primary backend measured none

#### Scenario: Nothing scale-pass-related is logged in a production build

- **WHEN** a scale pass reaches any terminal status and `import.meta.env.DEV` is `false`
- **THEN** no `[analysis-diagnostics:scale-pass]` console output occurs

#### Scenario: The subject-agreement verdict rides on the completed pass's line

- **WHEN** the scale pass reaches `'done'` in a development build and the subject-agreement check
  produced a verdict
- **THEN** the same `[analysis-diagnostics:scale-pass]` message carries a `subjectAgreement` key
  with the verdict's `status`, `reason`, `comparedInstants` and `agreeingInstants` — including
  when the verdict is `'no-opinion'`, so a permanently-no-opinion configuration is visible rather
  than silent

### Requirement: Person-selection diagnostics are always reported

The system SHALL include a `personSelection` block in every `AnalysisDiagnostics` object, present
unconditionally — including when the selection stage was disabled or skipped — carrying that
stage's status, its typed skip reason (or null when it selected), the resolved absolute area
floor, the pre-selection and post-selection detection counts, the counts rejected below the floor
and rejected for belonging to another segment, the count nulled for lying outside the winning
segment's evidenced interior, the total segment count, the number of cuts the splice-tolerance rule
declined, the ranked segment summaries, and the separation ratio. The block
SHALL be the value the selection stage produced, by reference, never a recomputation. Because
`sampling.detectedFrames` reflects the post-selection sequence, the pre-selection count preserved
here is what distinguishes "the detector found nothing" from "the detector found somebody else".

#### Scenario: A disabled stage still reports itself

- **WHEN** diagnostics are computed for a run in which person selection was disabled
- **THEN** the `personSelection` key is present, reporting a skipped status and the disabled
  reason, rather than being absent as `scaleCalibration` is when unmeasured

#### Scenario: The selection stage's own answer is surfaced verbatim

- **WHEN** diagnostics are computed with a person-selection diagnostics object
- **THEN** the result's `personSelection` is that exact value by reference, not a restatement

#### Scenario: Pre- and post-selection detection counts are both readable

- **WHEN** person selection nulled frames it attributed to another person
- **THEN** `sampling.detectedFrames` reports the count after that nulling and
  `personSelection.detectedSamplesIn` reports the count before it

