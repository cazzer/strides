## MODIFIED Requirements

### Requirement: Diagnostics aggregation
The system SHALL provide a pure function that computes an `AnalysisDiagnostics` object from a
completed run's `PoseSample[]`, `RobustPoseFrame[]`, `FormHeuristicsResult`, and which sampler
(the WebCodecs sequential-decode path or the `<video>`-playback path) produced those samples —
the last of these passed in explicitly by the caller, since nothing about the samples themselves
reveals which sampler made them — without requiring any additional instrumentation of the
sampling or robustness layers.

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
