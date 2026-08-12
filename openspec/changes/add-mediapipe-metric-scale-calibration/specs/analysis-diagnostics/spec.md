## MODIFIED Requirements

### Requirement: Diagnostics aggregation
The system SHALL provide a pure function that computes an `AnalysisDiagnostics` object from a
completed run's `PoseSample[]`, `RobustPoseFrame[]`, and `FormHeuristicsResult`, plus an optional
scale-calibration result, without requiring any additional instrumentation of the sampling or
robustness layers. The optional input SHALL be genuinely optional: omitting it produces the same
object the function produced before that input existed.

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

## ADDED Requirements

### Requirement: Scale-calibrated vertical oscillation appears only when measured
The system SHALL include a `scaleCalibration` block in the diagnostics object when, and only
when, a scale-calibrated vertical-oscillation result was actually computed — reporting the
centimetre amplitude, the half-cycle sample size, the scale drift ratio, the median
pixels-per-metre, the implied torso length in metres, the scale coverage, and the number of
independent integration runs. When no such result exists, because the detection backend does not
measure real-world scale or no frame carried a usable scale, the key SHALL be absent from the
object entirely rather than present with a `null` or `undefined` value, so that a run on a
scale-less backend serializes to exactly the JSON it did before this capability existed.

#### Scenario: Diagnostics from a scale-less backend carry no scale-calibration key
- **WHEN** diagnostics are computed without a scale-calibration result, or with an explicitly
  absent one
- **THEN** the serialized diagnostics object contains no `scaleCalibration` property at all

#### Scenario: A measured calibration is surfaced verbatim
- **WHEN** diagnostics are computed with a scale-calibration result
- **THEN** the diagnostics object's `scaleCalibration` is that result's fields unchanged, not a
  recomputation or a rounded restatement of them
