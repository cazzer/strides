# form-heuristics — plain-language caveat copy (delta)

## MODIFIED Requirements

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
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` says in plain language that the
  bounce rhythm was too irregular to measure — without quoting the measured fit statistic or the
  configured threshold

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

### Requirement: Cadence is derived from the hip-bounce step frequency

The system SHALL compute cadence by fitting the resolvable hip-mid image-y samples to the shared
spectral sinusoid primitive (`fitSpectralSinusoid`, over the `spectralFitMinFrequencyHz`/
`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` grid already used by vertical
oscillation), and reporting `value = frequencyHz × 60` — steps per minute, with no correction
factor — since this pipeline's hip-mid trace bounces once per STEP (twice per full gait cycle).
This SHALL NOT depend on footstrike detection (`detectFootstrikes`) or on `estimateBodyScale`, and
SHALL reuse the identical hip-mid signal vertical oscillation fits, via a shared extractor.

The system SHALL gate the result on the fit's sinusoid PARTIAL R² against `cadenceMinFitR2`. When
the fit fails outright, completes fewer than one cycle, or its partial R² falls below
`cadenceMinFitR2`, the system SHALL report `value: null`, `confidence: 0`, and a non-null caveat
naming the specific reason — with NO fallback to any other estimator.

The system SHALL report `sampleSize` as `floor(spanSeconds × frequencyHz)` — a STEP count — using
the UNROUNDED cycle count to compute confidence's sample-size factor.

#### Scenario: A clean side-view clip yields cadence from the fitted step frequency

- **WHEN** cadence is computed against a `'side'`-classified clip whose hip-mid trace has a clean,
  fittable bounce rhythm
- **THEN** `value` equals the fitted bounce frequency (Hz) times 60, `sampleSize` is the floored
  step count the fit observed, and `value` lands within a plausible range of the clip's true
  underlying cadence

#### Scenario: No fittable rhythm reports no value

- **WHEN** the hip-mid trace's best-fitting frequency has a sinusoid partial R² below
  `cadenceMinFitR2`, or the fit otherwise fails (too few samples, a degenerate/non-oscillating
  signal)
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` says in plain language that the
  step rhythm was too irregular to measure — or names the specific failure reason (too few
  resolvable frames; no oscillating motion) — without quoting the measured fit statistic or the
  configured threshold

#### Scenario: Under one complete step reports no value

- **WHEN** the best-fitting frequency completes fewer than one full cycle within the span of the
  resolvable hip samples
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` states the clip is too short to
  contain a complete step

#### Scenario: No resolvable hips

- **WHEN** no frame in the clip has a resolvable hip-mid position
- **THEN** `value` is `null`, `confidence` is `0`, and a non-null `caveat` names the missing hip
  position — cadence no longer requires a resolvable shoulder position the way its predecessor
  (via `estimateBodyScale`) did

#### Scenario: Dead time does not shift cadence

- **WHEN** cadence is computed against a clip where the subject enters the frame partway through
  and/or exits before the clip ends
- **THEN** `value` reflects the fitted frequency over the resolvable hip samples, not diluted by
  dead time before/after the subject's presence

#### Scenario: Mid-clip gaps are fitted without resampling

- **WHEN** cadence is computed against a clip with one or more stretches where the hip position is
  unresolvable
- **THEN** the fit is computed over the samples that exist, at their real timestamps, without
  interpolating or resampling across the gap, and `frameCoverage` reflects the shortfall

#### Scenario: A band-edge frequency is caveated

- **WHEN** the fitted frequency lands within one grid step (`spectralFitFrequencyStepHz`) of
  either `spectralFitMinFrequencyHz` or `spectralFitMaxFrequencyHz`
- **THEN** the returned `caveat` states that the detected cadence sits at the edge of the range
  the analysis can measure and the true cadence may fall outside it — without quoting the
  numeric frequency band — alongside any other caveat that applies

#### Scenario: Fit quality and step count both feed confidence

- **WHEN** cadence reports a value from a fit whose partial R² clears `cadenceMinFitR2` but falls
  short of a clean-clip fit, or whose step count falls below `MIN_CADENCE_STEPS`
- **THEN** `confidence` is reduced proportionally by each shortfall that applies, on top of the
  existing view-fit, frame-coverage and interpolation factors, and `caveat` is non-null

#### Scenario: Degenerate input never throws or produces NaN

- **WHEN** cadence is computed against an empty frame list, or frames that would otherwise produce
  a degenerate fit
- **THEN** `value` is `null` (never `NaN`), `confidence` is `0`, and no exception is thrown

### Requirement: Vertical ratio is computed from the shared hip-bounce fit and stride length

The system SHALL compute `verticalRatio.value` as `fit.peakToPeakAmplitude / stride.strideLengthPx`
— exactly this expression, with no additional scaling factor and no intermediate rounding — where
`fit` comes from `analyzeHipBounce` (the hip-pinned bounce signal, independent of the
`verticalOscillationSignal` configuration option that only affects the `verticalOscillation`
metric) and `stride` comes from `estimateStrideLength`. The reported `unit` SHALL be `'percent'` (a
dimensionless 0..1 fraction, not pre-multiplied by 100). `sampleSize` SHALL be
`stride.pairCount`. The system SHALL reuse `verticalOscillationMinFitR2` as this metric's fit-
quality gate rather than introducing a separate configurable threshold, since both metrics gate the
identical fitted amplitude. When either the hip-bounce fit or the stride-length estimate fails —
including specifically when stride length fails because travel direction is indeterminate — the
system SHALL report `value: null`, `confidence: 0`, and a non-null caveat naming the specific
reason; the travel-direction-unknown case SHALL produce a caveat whose text begins with "Direction
of travel could not be determined (no net horizontal displacement)".

Watch comparability is explicitly **PENDING**: this metric targets the same ratio concept
(bounce ÷ stride length) that consumer running watches report as "Vertical Ratio", inferred from
the user's percentage-shaped ground-truth reading during the 2026-08-12 investigation — but which
specific quantity that reading represents has not been confirmed with the user, and this pipeline
computes the ratio in pixel space (real-world scale cancels) rather than reproducing any specific
watch's calibrated centimetre-based algorithm.

#### Scenario: A clean side-view clip yields a plausible vertical-ratio value

- **WHEN** vertical ratio is computed against a `'side'`-classified clip with both a fittable
  hip-bounce rhythm and a resolvable stride length
- **THEN** `value` equals `fit.peakToPeakAmplitude / stride.strideLengthPx` exactly, `unit` is
  `'percent'`, and `sampleSize` equals the stride-length estimate's `pairCount`

#### Scenario: Indeterminate travel direction reports no value with the exact caveat prefix

- **WHEN** vertical ratio is computed against a clip where `estimateTravelDirection` returns `0`
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` begins with "Direction of travel
  could not be determined (no net horizontal displacement)"

#### Scenario: No fittable hip-bounce rhythm reports no value

- **WHEN** the hip-bounce fit's sinusoid partial R² falls below `verticalOscillationMinFitR2`, or
  the fit otherwise fails
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` says in plain language that the
  bounce rhythm was too irregular to measure — or names the specific failure reason — without
  quoting the measured fit statistic or the configured threshold

#### Scenario: Degenerate zero bounce reports no value ahead of the stride-length check

- **WHEN** the hip-bounce fit succeeds but its amplitude is degenerate (no measurable vertical
  motion), even if stride length would otherwise be computable
- **THEN** the numerator gate is evaluated first and `value` is `null` with a caveat describing the
  degenerate bounce, not a stride-length-shaped caveat

### Requirement: Vertical oscillation in centimetres is a metric gated on measured real-world scale

The system SHALL expose vertical oscillation in centimetres as a `MetricId` (`verticalOscillationCm`),
positioned immediately after `verticalRatio` in `MetricId` and every enumeration of it. Its `value`
SHALL be the scale-calibrated calculation's reported centimetre amplitude when a real-world scale
was measured for the clip and a fit cleared the calculation's quality gate, and `null` otherwise.
When no frame in the clip carries a measured real-world scale, the system SHALL report `value:
null`, `confidence: 0`, `calibration: null`, and a caveat stating in plain language that no
real-world scale could be measured for this clip — an availability statement, not an error, naming
no backend or model — the same caveat regardless of whether the backend in use has never measured
scale or a scale-measuring backend's per-frame measurement failed everywhere on this particular
clip, since the calculation cannot distinguish the two cases. When a real-world scale WAS measured
but no integration run's fit cleared the quality gate, the system SHALL report `value: null`,
`confidence: 0`, a non-null `calibration`, and a caveat naming the specific typed reason (mirroring
the calculation's own `ScaleCalibratedFitFailureReason`) in plain language, distinct from the
not-measured-at-all caveat.

#### Scenario: A backend that doesn't measure scale reports an availability caveat

- **WHEN** `verticalOscillationCm` is computed against a clip where no frame's `pixelsPerMeter` is
  measured
- **THEN** `value` is `null`, `confidence` is `0`, `calibration` is `null`, `unit` is
  `'centimeters'`, and `caveat` states that no real-world scale could be measured for this clip
  and points the reader to the sibling bounce metrics that do not need one — naming no backend or
  model — without throwing

#### Scenario: An empty frame list is indistinguishable from a scale-less backend

- **WHEN** `verticalOscillationCm` is computed against an empty frame list
- **THEN** the result is identical in shape to the scale-less-backend case: `value: null`,
  `confidence: 0`, `calibration: null`, without throwing

#### Scenario: A measured scale that never fits reports its specific failure reason

- **WHEN** `verticalOscillationCm` is computed against a clip where every frame carries a measured
  scale, but no integration run's fit clears the calculation's quality gate
- **THEN** `value` is `null`, `confidence` is `0`, `calibration` is non-null and carries the typed
  failure reason, and `caveat` names that specific reason — distinct from the not-measured-at-all
  caveat

#### Scenario: A measured, well-fitted clip reports a value equal to the calibration's amplitude

- **WHEN** `verticalOscillationCm` is computed against a clip where a real-world scale is measured
  and at least one integration run's fit clears the quality gate
- **THEN** `value` equals `calibration.verticalOscillationCm` exactly, `unit` is `'centimeters'`,
  and `sampleSize` equals `calibration.sampleSize` exactly — the metric result is a passthrough of
  the calibration onto the shared `MetricResult` shape, not an independent recomputation
