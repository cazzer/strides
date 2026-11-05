## ADDED Requirements

### Requirement: The diagnostics export says whether the bounce fit was scale-normalized

The system SHALL include a `scaleNormalized` boolean in `verticalOscillationFit` whenever that
object is present, `true` exactly when vertical oscillation's bounce fit was adopted from the
scale-normalized fallback and `false` otherwise. `verticalOscillationFit` SHALL remain `null`
whenever vertical oscillation reported no value. This SHALL hold for the primary
`[analysis-diagnostics]` line and for the `[analysis-diagnostics:scale-pass]` line alike.

#### Scenario: A scale-normalized fit is named in the export

- **WHEN** diagnostics are computed for a run whose vertical oscillation value came from the
  scale-normalized fallback
- **THEN** `verticalOscillationFit.scaleNormalized` is `true`

#### Scenario: An ordinary fit says so explicitly

- **WHEN** diagnostics are computed for a run whose vertical oscillation value came from the raw
  in-band or sub-floor fit
- **THEN** `verticalOscillationFit.scaleNormalized` is present and `false`

#### Scenario: No value, no fit

- **WHEN** vertical oscillation reported no value
- **THEN** `verticalOscillationFit` is `null`

#### Scenario: Both console lines carry the flag

- **WHEN** both the primary pass and the background scale pass emit diagnostics
- **THEN** the diagnostics object on each of the `[analysis-diagnostics]` and
  `[analysis-diagnostics:scale-pass]` lines carries `verticalOscillationFit.scaleNormalized`
  whenever its `verticalOscillationFit` is non-null
