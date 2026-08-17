## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Person-selection diagnostics are always reported

The system SHALL include a `personSelection` block in every `AnalysisDiagnostics` object, present
unconditionally — including when the selection stage was disabled or skipped — carrying that
stage's status, its typed skip reason (or null when it selected), the resolved absolute area
floor, the pre-selection and post-selection detection counts, the counts rejected below the floor
and rejected for belonging to another segment, the total segment count, the ranked segment
summaries, and the separation ratio. The block SHALL be the value the selection stage produced, by
reference, never a recomputation. Because `sampling.detectedFrames` reflects the post-selection
sequence, the pre-selection count preserved here is what distinguishes "the detector found nothing"
from "the detector found somebody else".

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
