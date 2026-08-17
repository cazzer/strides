## ADDED Requirements

### Requirement: Step width reports the signed per-footstrike lateral offset from the hip midline

The system SHALL compute step width as the median, across all detected footstrikes, of each
footstrike's signed lateral offset of the landing ankle from the hip-midline, as a fraction of hip
width (`'percent'` unit). The sign SHALL be resolved per-footstrike from that same frame's own-side
hip position relative to hip-mid — `positive = landed on its own anatomical side, negative =
crossed to the opposite side` — never from a clip-wide constant (such as a `travelDirection`-style
signal, which resolves a different, fore-aft ambiguity and has no defined relationship to the
mediolateral axis this metric reads).

#### Scenario: A clean, own-side gait scores positive

- **WHEN** step width is computed against a clip where every footstrike lands on its own
  anatomical side of the hip midline
- **THEN** the returned value is positive

#### Scenario: A crossover gait scores negative

- **WHEN** step width is computed against a clip where footstrikes cross the body's midline toward
  or past the opposite side
- **THEN** the returned value is negative, and the result carries a non-null caveat naming the
  crossover pattern

#### Scenario: Naive unsigned combination is rejected as structurally incapable of reporting crossover

- **WHEN** per-footstrike lateral offsets are combined without per-footstrike sign correction
  (raw `ankle.x - hipMid.x`, taken as-is across both legs)
- **THEN** the combined result cancels toward zero for any symmetric gait regardless of stride
  width, and cannot report a negative (crossover) value even when one leg's footstrikes genuinely
  cross the midline — this is why the shipped implementation performs the per-footstrike sign
  correction described above rather than combining raw offsets directly

### Requirement: Step width is front/rear-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for step width
(`viewFitTable.stepWidth.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as unsuitable
(`multiplier: 0.1`) — mirroring `armSwingSymmetry`'s view-fit row, since a side-on camera looks
straight along the mediolateral axis step width measures, collapsing it toward a degenerate
reading. `'ambiguous'` SHALL also be treated as unsuitable (`multiplier: 0.2`). The system SHALL
still compute and return a value when the view is `'side'` or `'ambiguous'`, never substituting
`null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** step width is computed against a `'front'`-classified clip with resolvable footstrikes
  and hip positions
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** step width is computed against a `'side'`-classified clip with resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null caveat

### Requirement: Step width follows the shared output contract

The system SHALL return a `MetricResult` for step width using the `'percent'` unit, with `value:
null` and `confidence: 0` whenever there is no resolvable hip-width reference (left/right hip) or
no footstrikes can be detected in the clip, and SHALL NOT throw for any well-typed
`RobustPoseFrame[]` input, including an empty array.

#### Scenario: No hip-width reference yields null, not a crash

- **WHEN** left/right hip position never resolves anywhere in the clip
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: No footstrikes yields null, not a crash

- **WHEN** hip position resolves but no footstrikes are detected in the clip
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** step width is computed against an empty `RobustPoseFrame[]`
- **THEN** it returns `value: null`, `confidence: 0`, without throwing
