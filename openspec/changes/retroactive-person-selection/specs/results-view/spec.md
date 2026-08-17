## MODIFIED Requirements

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
