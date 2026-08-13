# analysis-diagnostics Specification

## Purpose
Aggregates machine-readable diagnostics about a completed analysis run — keypoint resolution,
view detection, sampling, and per-metric confidence inputs — and surfaces them in development
builds so low-confidence results can be diagnosed programmatically across many test clips,
instead of only through rendered end-user text.
## Requirements
### Requirement: Diagnostics aggregation
The system SHALL provide a pure function that computes an `AnalysisDiagnostics` object from a
completed run's `PoseSample[]`, `RobustPoseFrame[]`, and `FormHeuristicsResult`, without requiring
any additional instrumentation of the sampling or robustness layers or any additional input beyond
those three.

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
  a null `frame` (a per-frame detection failure)

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

