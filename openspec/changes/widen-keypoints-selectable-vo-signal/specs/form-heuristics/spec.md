## MODIFIED Requirements

### Requirement: Vertical oscillation is view-tolerant

The system SHALL compute vertical oscillation from the configured vertical-oscillation input
signal's vertical motion for every detected view (`'side'`, `'front'`, `'ambiguous'`), applying a
per-view confidence multiplier from `viewFitTable.verticalOscillation` (`side: 1.0`, `front: 0.85`,
`ambiguous: 0.6`) rather than withholding the value outside side view.

#### Scenario: Front-view clip still produces a value

- **WHEN** vertical oscillation is computed against a `'front'`-classified clip with resolvable
  motion in the configured signal
- **THEN** a non-null `value` is returned with `viewFit: 'tolerated'` and confidence discounted by
  the `0.85` multiplier relative to an otherwise-identical side-view computation

### Requirement: Vertical oscillation amplitude comes from a spectral sinusoid fit

The system SHALL compute vertical oscillation's amplitude by fitting the model
`v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²` to the resolvable image-y samples of the
configured vertical-oscillation input signal (`verticalOscillationSignal`; hip-mid by default) by
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

## ADDED Requirements

### Requirement: Vertical oscillation's input signal is selectable

The system SHALL expose `verticalOscillationSignal: 'hipMid' | 'earMid'` as a field of
`HeuristicsConfig`, selecting which bilateral-pair midpoint vertical oscillation's spectral fit is
computed against (`'hipMid'`: `left_hip`/`right_hip`; `'earMid'`: `left_ear`/`right_ear`),
defaulting to `'hipMid'`.

Bilateral-pair resolution within the configured signal SHALL use the same tolerant single-side
fallback every other center-of-mass proxy in this package uses (flagged `interpolated: true` when
only one side of the pair resolves). The system SHALL NOT substitute the OTHER signal's position on
any frame where the configured signal's pair is unresolvable — an unresolvable configured signal
SHALL contribute nothing to that frame (a `null` chart-series entry, and no sample handed to the
spectral fit) rather than falling back.

Every degraded-result caveat this metric produces SHALL name the signal that was actually tracked.

Torso-length normalization (`estimateBodyScale`) and the scale-calibrated centimetre calculation
(`verticalOscillationCm`) SHALL be unaffected by this setting, remaining hip/shoulder-based
regardless of `verticalOscillationSignal`'s value.

#### Scenario: Default is the hip midpoint

- **WHEN** vertical oscillation is computed without an explicit `verticalOscillationSignal`
  override
- **THEN** the spectral fit is computed against the `left_hip`/`right_hip` midpoint, identical to
  this metric's behavior before this setting existed

#### Scenario: earMid is measured from the ear midpoint

- **WHEN** vertical oscillation is computed with `verticalOscillationSignal: 'earMid'` against a
  clip with resolvable ear positions
- **THEN** the spectral fit is computed against the `left_ear`/`right_ear` midpoint instead of the
  hip midpoint, and the resulting amplitude reflects head motion rather than pelvis motion

#### Scenario: An unresolvable configured signal contributes nothing rather than falling back

- **WHEN** the configured signal's pair is unresolvable on a given frame, while the OTHER
  (unconfigured) signal's pair would have been resolvable on that same frame
- **THEN** that frame contributes a `null` entry to the chart series and no sample to the spectral
  fit — the metric never substitutes the unconfigured signal's position for the configured one

#### Scenario: A single resolvable side stands in for the pair, flagged interpolated

- **WHEN** only one side of the configured signal's pair (e.g. only the left ear, with
  `verticalOscillationSignal: 'earMid'`) resolves on a given frame
- **THEN** that single side's position stands in for the pair's midpoint on that frame, with the
  frame's contribution flagged `interpolated`, the same tolerant fallback every other bilateral
  center-of-mass signal in this package already uses

#### Scenario: The centimetre calculation is unaffected by this setting

- **WHEN** `verticalOscillationCm` is computed against a clip, regardless of what
  `verticalOscillationSignal` is set to elsewhere in the same `HeuristicsConfig`
- **THEN** its result is identical either way, since it does not read this setting and remains
  hip-based unconditionally
