## MODIFIED Requirements

### Requirement: Person-selection diagnostics are always reported

The system SHALL include a `personSelection` block in every `AnalysisDiagnostics` object, present
unconditionally — including when the selection stage was disabled or skipped — carrying that
stage's status, its typed skip reason (or null when it selected), the resolved absolute area
floor, the pre-selection and post-selection detection counts, the counts rejected below the floor
and rejected for belonging to another segment, the total segment count, the number of cuts the
splice-tolerance rule declined, the ranked segment summaries, and the separation ratio. The block
SHALL be the value the selection stage produced, by
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

