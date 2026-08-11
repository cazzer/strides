## ADDED Requirements

### Requirement: Arm swing symmetry compares per-side wrist-relative-to-shoulder swing amplitude

The system SHALL compute arm swing symmetry as `min(leftAmplitude, rightAmplitude) /
max(leftAmplitude, rightAmplitude)`, where each side's amplitude is the median torso-normalized
half-cycle amplitude of that side's wrist-y position relative to its own shoulder-y over the clip
— a `'percent'`-unit, 0-1 ratio where `1` means perfectly symmetric swing and values approaching
`0` mean one arm swings substantially more than the other.

#### Scenario: Symmetric swing scores near 1

- **WHEN** both arms show comparable, matched vertical swing amplitude across the clip
- **THEN** the returned ratio is close to `1`

#### Scenario: Asymmetric swing scores lower than a matched symmetric case

- **WHEN** one arm's swing amplitude is substantially smaller than the other's, all else equal
- **THEN** the returned ratio is meaningfully lower than the ratio computed from an otherwise-
  identical symmetric case

### Requirement: Arm swing symmetry is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for arm swing symmetry
(`viewFitTable.armSwingSymmetry.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — the mirror image of trunk lean/overstriding's side-view-primary
gating — because a side view occludes or superimposes the far arm rather than because the swing
signal itself is invisible from the side. `'ambiguous'` SHALL also be treated as unsuitable
(`multiplier: 0.2`). The system SHALL still compute and return a value when the view is `'side'`
or `'ambiguous'`, never substituting `null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** arm swing symmetry is computed against a `'front'`-classified clip with resolvable,
  separable left/right wrist and shoulder positions
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** arm swing symmetry is computed against a `'side'`-classified clip with resolvable arm
  positions
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat`

### Requirement: Arm swing symmetry follows the shared output contract

The system SHALL return a `MetricResult` for arm swing symmetry using the `'percent'` unit, with
`value: null` and `confidence: 0` whenever either arm has no resolvable shoulder/wrist position or
no complete swing cycle is detected in the clip, and SHALL NOT throw for any well-typed
`RobustPoseFrame[]` input, including an empty array.

#### Scenario: Insufficient data yields null, not a crash

- **WHEN** one or both arms have no resolvable shoulder/wrist position, or no complete swing cycle
  is detected on one or both sides
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** arm swing symmetry is computed against an empty `RobustPoseFrame[]`
- **THEN** it returns `value: null`, `confidence: 0`, without throwing
