## MODIFIED Requirements

### Requirement: Vertical oscillation amplitude comes from a spectral sinusoid fit

The system SHALL compute vertical oscillation's amplitude by fitting the model
`v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²` to the resolvable image-y samples of the
configured vertical-oscillation input signal (`verticalOscillationSignal`; hip-mid by default) by
ordinary least squares, once per candidate frequency `f` on the two-pass grid defined by
`spectralFitMinFrequencyHz`, `spectralFitMaxFrequencyHz`, `spectralFitFrequencyStepHz` and
`MAX_RETIMING_FACTOR` (see "A bounce rhythm below the human-gait floor is fitted on a second pass
and reported as retimed footage"),
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
two-pass bounce fit (`fitBounceSpectrum`, over the `spectralFitMinFrequencyHz`/
`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` grid already used by vertical
oscillation, and its sub-floor retry), and reporting `value = frequencyHz × 60` — steps per minute,
with no correction
factor — since this pipeline's hip-mid trace bounces once per STEP (twice per full gait cycle).
This SHALL NOT depend on footstrike detection (`detectFootstrikes`) or on `estimateBodyScale`, and
SHALL reuse the identical hip-mid signal vertical oscillation fits, via a shared extractor.

When the fit was adopted from the sub-floor pass — the clip's bounce is slower than any human gait,
so the footage is retimed — the system SHALL report `value: null` and `confidence: 0` with a
non-null caveat naming the retiming, and SHALL do so regardless of how well that fit scores. Cadence
SHALL be the only metric withheld on this basis, because it is the only one whose value carries time
in its units.

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

#### Scenario: A retimed clip's rate is withheld and the retiming is named

- **WHEN** cadence is computed against a clip whose bounce fit was adopted from the sub-floor pass
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` says in plain language that the clip
  looks like slow-motion footage and that a steps-per-minute figure would be wrong by however much
  it was slowed — explicitly NOT the "too irregular to measure" wording, since the rhythm was
  measured cleanly, and without quoting any factor or asking the reader to supply one

## ADDED Requirements

### Requirement: A bounce rhythm below the human-gait floor is fitted on a second pass and reported as retimed footage

The system SHALL fit the shared hip-bounce sinusoid in two passes. The first pass SHALL search the
band `[spectralFitMinFrequencyHz, spectralFitMaxFrequencyHz]` exactly as before. The system SHALL
consult a second pass ONLY when the first pass fails to produce a fit whose sinusoid partial R²
reaches `verticalOscillationMinFitR2`, and that second pass SHALL search the band
`[spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR, spectralFitMinFrequencyHz −
spectralFitFrequencyStepHz]`.

The two bands SHALL be disjoint, so that a sub-floor candidate is structurally incapable of
displacing a winning in-band peak: a clip whose ordinary fit clears the gate SHALL be unaffected by
the existence of the second pass, and SHALL receive the identical fit it received before.

The system SHALL adopt the second pass's fit only when it too reaches
`verticalOscillationMinFitR2`, and SHALL otherwise return the first pass's result untouched —
success or failure alike. Adoption SHALL be reported to callers as a single boolean on the shared
bounce analysis, and SHALL NOT introduce a further configurable threshold: the human-gait floor is
`spectralFitMinFrequencyHz` itself, and the frequency comparison is a consequence of the disjoint
bands rather than a separate test.

The system SHALL route the pixel-space bounce signal and the scale-calibrated per-run metre series
through the same two-pass fit, so the vertical-oscillation family cannot reach different verdicts
about whether one clip has a measurable rhythm.

#### Scenario: An in-band rhythm never reaches the second pass

- **WHEN** the hip-bounce fit is computed against a clip whose in-band fit clears
  `verticalOscillationMinFitR2`
- **THEN** the returned fit is identical to the one the single-pass search produced, the sub-floor
  band is not consulted, and the clip is not reported as retimed

#### Scenario: A sub-floor rhythm is fitted and reported as retimed

- **WHEN** the hip-bounce fit is computed against a clip whose on-screen bounce is slower than
  `spectralFitMinFrequencyHz` — retimed footage — and the sub-floor fit clears
  `verticalOscillationMinFitR2`
- **THEN** the sub-floor fit is returned, the clip is flagged as retimed, and the returned frequency
  is strictly below `spectralFitMinFrequencyHz`

#### Scenario: Neither pass clears the gate and nothing changes

- **WHEN** neither the in-band nor the sub-floor fit reaches `verticalOscillationMinFitR2`
- **THEN** the in-band result is returned exactly as it would have been without the second pass, and
  the clip is not reported as retimed

#### Scenario: Retiming beyond the supported factor keeps today's behaviour

- **WHEN** a clip's bounce is slower than `spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR`
- **THEN** no fit below that floor is reported, and the clip keeps whatever no-value result it had
  before — it is not fitted onto the nearest representable candidate and presented as a slower gait

#### Scenario: A retimed clip's factor-independent metrics all publish

- **WHEN** form heuristics are computed against a clip whose bounce fit was adopted from the
  sub-floor pass
- **THEN** every metric whose value does not carry time in its units — the vertical-oscillation
  family, trunk lean, overstriding, foot strike pattern, knee flexion, knee drive, step width —
  reports its value on the same terms as any other clip, and footstrike timing is derived from the
  fitted bounce phase rather than falling back to the ankle-difference detector

