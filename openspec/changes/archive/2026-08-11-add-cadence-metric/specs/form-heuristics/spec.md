## ADDED Requirements

### Requirement: Cadence is computed from shared footstrike detection

The system SHALL compute cadence as `detectFootstrikes(frames, config).length` (footstrikes
across both legs, combined) divided by clip duration in minutes, where clip duration is
`frames[frames.length - 1].timestamp - frames[0].timestamp`, without reimplementing footstrike
detection.

#### Scenario: A clean side-view clip yields a resolvable cadence

- **WHEN** cadence is computed against a `'side'`-classified clip with detectable footstrikes
- **THEN** a non-null `value` in steps/minute is returned, `sampleSize` reflects the detected
  footstrike count, and `value` is within a plausible range of the clip's true underlying cadence

#### Scenario: Too few footstrikes to detect any cadence

- **WHEN** cadence is computed against frames with no detectable footstrikes (e.g. a flat,
  unchanging ankle trace)
- **THEN** `value` is `null`, `confidence` is `0`, `sampleSize` is `0`, and `caveat` is non-null

#### Scenario: No resolvable body-scale reference at all

- **WHEN** cadence is computed against frames with no resolvable shoulder/hip position anywhere in
  the clip
- **THEN** `value` is `null`, `confidence` is `0`, and a non-null `caveat` names the missing
  body-scale reference — distinct from the "too few footstrikes" caveat, matching the same
  distinction `computeOverstriding` already makes for the same underlying reason

#### Scenario: Zero-duration input never throws or produces NaN/Infinity

- **WHEN** cadence is computed against frames that span no measurable elapsed time (e.g. a single
  frame, or multiple frames sharing one timestamp)
- **THEN** `value` is `null` (not `NaN` or `Infinity`), `confidence` is `0`, and no exception is
  thrown

### Requirement: Cadence is view-tolerant, with a front-view discount steeper than vertical oscillation's

The system SHALL compute and return a cadence value for every detected view (`'side'`, `'front'`,
`'ambiguous'`) — never substituting `null` purely because the view is unsuitable — applying a
per-view confidence multiplier from `viewFitTable.cadence` (`side: 1.0`, `front: 0.8`, `ambiguous:
0.6`), since footstrike timing is a vertical-axis (ankle-y) signal that projects onto image-y
similarly regardless of camera facing direction, unlike the sagittal-plane quantities trunk lean
and overstriding measure.

#### Scenario: Front-view clip still produces a cadence value

- **WHEN** cadence is computed against a `'front'`-classified clip with detectable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'tolerated'` and confidence discounted by
  the `0.8` multiplier relative to an otherwise-identical side-view computation

#### Scenario: Ambiguous-view clip still produces a cadence value

- **WHEN** cadence is computed against an `'ambiguous'`-classified clip with detectable
  footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'tolerated'` and confidence discounted by
  the `0.6` multiplier

### Requirement: Cadence participates in the shared orchestration and output contract

The system SHALL include cadence in `computeFormHeuristics`'s result (`FormHeuristicsResult.cadence`),
computed under the same once-per-clip detected view as the other three metrics, and SHALL follow
the same output contract every other metric follows: `value` a finite number or `null` (never
`NaN`), `confidence` in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any
well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes cadence gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `cadence.viewFit` reflects the same `view.view` label present in the same
  result as `verticalOscillation`, `trunkLean`, and `overstriding`

#### Scenario: Empty frame list produces a well-formed cadence result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `cadence.value` is `null` and `cadence.confidence` is `0`, without throwing
