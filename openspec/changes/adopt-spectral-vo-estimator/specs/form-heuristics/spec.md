## ADDED Requirements

### Requirement: Vertical oscillation amplitude comes from a spectral sinusoid fit

The system SHALL compute vertical oscillation's amplitude by fitting the model
`v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²` to the resolvable hip-mid image-y samples by
ordinary least squares, once per candidate frequency `f` on the grid defined by
`spectralFitMinFrequencyHz`, `spectralFitMaxFrequencyHz` and `spectralFitFrequencyStepHz`,
selecting the frequency `f*` with the smallest residual sum of squares, and reporting
`value = 2·√(a²+b²) / torsoLengthPx` — a PEAK-TO-PEAK amplitude normalized by the same clip-median
torso length `estimateBodyScale` already provides, whose behavior is unchanged.

The system SHALL fit the samples that exist, at their real timestamps, and SHALL NOT resample or
interpolate the series onto a uniform grid before fitting.

The system SHALL gate the result on the sinusoid's PARTIAL coefficient of determination,
`1 − RSS(f*) / RSS_trendOnly`, where `RSS_trendOnly` is the residual sum of squares of the trend
terms `c + d·t + e·t²` fitted alone. When that value is below `verticalOscillationMinFitR2`, the
system SHALL report `value: null` and `confidence: 0` with a non-null caveat, and SHALL NOT report
a value derived from that fit by any other code path. The total coefficient of determination MAY be
reported as a diagnostic but SHALL NOT be used as the gate.

The system SHALL report `sampleSize` for this metric as the number of complete BOUNCE cycles
observed (one bounce per STEP, i.e. half a full gait cycle, not a full gait cycle itself),
`floor(spanSeconds × f*)`, and SHALL NOT report a value when fewer than one complete cycle was
observed.

#### Scenario: A clip with a clean bounce rhythm reports the fitted amplitude

- **WHEN** vertical oscillation is computed against a clip whose hip-mid trace oscillates cleanly
  within the configured frequency band
- **THEN** `value` is the fitted peak-to-peak amplitude divided by `torsoLengthPx`, `sampleSize` is
  the count of complete cycles the clip spans, and the reported fit diagnostics include the winning
  frequency and the sinusoid partial R²

#### Scenario: Irregular timestamps and mid-clip gaps are fitted without resampling

- **WHEN** vertical oscillation is computed against a clip whose resolvable hip samples are
  unevenly spaced, or are interrupted by one or more stretches where the hip was unresolvable
- **THEN** the amplitude is recovered from the samples that exist, with the unresolvable stretches
  contributing nothing rather than being filled in, and `frameCoverage` reflects the shortfall

#### Scenario: Camera-approach drift does not inflate the reported amplitude

- **WHEN** vertical oscillation is computed against a clip whose hip-mid trace carries slow linear
  and quadratic drift far larger than the oscillation itself (e.g. a runner approaching the camera)
- **THEN** the reported amplitude matches the amplitude that would be reported for the same
  oscillation without the drift, because the model's `c + d·t + e·t²` terms absorb it

#### Scenario: A fit below the quality threshold reports no value

- **WHEN** the best-fitting frequency's sinusoid partial R² is below `verticalOscillationMinFitR2`
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names both the measured fit quality
  and the configured minimum

#### Scenario: A clip spanning under one complete cycle reports no value

- **WHEN** the best-fitting frequency completes fewer than one full cycle within the span of the
  resolvable hip samples
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` states that the clip is too short to
  contain a complete bounce cycle

#### Scenario: A hip trace with no oscillation reports no value rather than zero

- **WHEN** vertical oscillation is computed against a clip whose hip-mid trace is constant, or is a
  pure trend the model's polynomial terms explain exactly
- **THEN** `value` is `null` with a non-null caveat, never `0` — which would falsely claim a
  measured absence of bounce rather than an inability to measure one — and never `NaN`

#### Scenario: Fit quality and observed cycle count both feed confidence

- **WHEN** vertical oscillation reports a value from a fit whose partial R² clears
  `verticalOscillationMinFitR2` but falls short of a clean-clip fit, or whose complete-cycle count
  falls below `verticalOscillationMinCycles`
- **THEN** `confidence` is reduced proportionally by each shortfall that applies, on top of the
  existing view-fit, frame-coverage and interpolation factors, and `caveat` is non-null

#### Scenario: The chart series survives every no-value path

- **WHEN** vertical oscillation reports `value: null` for any reason other than an unresolvable
  body scale
- **THEN** `series` is still populated with one timestamp-aligned entry per input frame, so the hip
  trace remains chartable even when no amplitude is reportable
