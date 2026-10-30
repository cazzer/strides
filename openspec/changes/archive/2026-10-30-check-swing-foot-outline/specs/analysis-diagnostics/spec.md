## ADDED Requirements

### Requirement: Outline-pass diagnostics export under a distinct prefix

In a development build the system SHALL log one `[analysis-diagnostics:outline-pass]` line per
terminal outline-pass transition, carrying its status, its skip reason or error, and on `done` the
outline reading (windows, floor, per-side values, counts), the metric's final value, confidence and
caveat, the frames segmented, the median segmentation time and the pass's total time. The primary
`[analysis-diagnostics]` line and the scale-pass line SHALL be unchanged in shape. A
`[perf-timings]` `analysis-pass` line with `pass: 'outline'` SHALL record the pass's cost.

#### Scenario: A front clip's outline pass completes
- **WHEN** the outline pass reaches done in a development build
- **THEN** exactly one `[analysis-diagnostics:outline-pass]` line with `status: "done"` and the reading is logged

#### Scenario: A side clip
- **WHEN** a side clip reaches ready
- **THEN** one outline-pass line with `status: "skipped"` and `reason: "not-front"` is logged
