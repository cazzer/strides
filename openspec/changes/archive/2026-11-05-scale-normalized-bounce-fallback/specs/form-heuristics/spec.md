## MODIFIED Requirements

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

The system SHALL adopt the second pass's fit only when BOTH of the following hold. Otherwise the
system SHALL proceed to the scale-normalized pass, and SHALL return the first pass's result
untouched — success or failure alike — only when that pass is not adopted either:

1. its sinusoid partial R² reaches `verticalOscillationMinFitR2`, the same shared family gate the
   first pass is judged by, so that an adopted fit is one the downstream metrics will also accept;
   and
2. its winning peak is STATISTICALLY SIGNIFICANT against an AR(1) red-noise null estimated from the
   second pass's own band, at a conventional confidence level.

The red-noise test SHALL estimate both the null's shape (its lag-1 autocorrelation) and its level
from the band's own per-candidate explained sums of squares, using an estimator robust to the
presence of a genuine peak; SHALL compare the peak against that null through the χ² distribution
the null implies; and SHALL correct that comparison for the number of INDEPENDENT frequencies the
band offers over the observed span, because the peak is selected by maximization rather than named
in advance.

A fixed partial-R² threshold SHALL NOT be the sole adoption criterion for the second pass. Its band
is where a red-noise process concentrates its power, whereas `verticalOscillationMinFitR2`'s
calibration is a white-noise floor, so a series with no rhythm at any frequency clears it there on
the large majority of trials at this corpus's own sample counts — and no threshold on any field the
fit reports separates that population from a genuine sub-floor rhythm.

Neither `verticalOscillationMinFitR2` nor `cadenceMinFitR2` SHALL be changed by this rule, and the
first pass SHALL NOT consult the red-noise null at all: a clip whose in-band fit clears the gate
SHALL receive the identical result it received before this rule existed.

Adoption SHALL be reported to callers as a single boolean on the shared bounce analysis, and SHALL
NOT introduce a further configurable frequency threshold: the human-gait floor is
`spectralFitMinFrequencyHz` itself, and the frequency comparison is a consequence of the disjoint
bands rather than a separate test.

The system SHALL route the pixel-space bounce signal and the scale-calibrated per-run metre series
through the same two-pass fit, so the vertical-oscillation family is governed by the same RULE
about whether one clip has a measurable rhythm — not necessarily the same answer, since the two
consumers fit different series. The scale-normalized pass applies to the pixel-space signal only.

#### Scenario: An in-band rhythm never reaches the second pass

- **WHEN** the hip-bounce fit is computed against a clip whose in-band fit clears
  `verticalOscillationMinFitR2`
- **THEN** the returned fit is identical to the one the single-pass search produced, the sub-floor
  band is not consulted, and the clip is not reported as retimed

#### Scenario: A sub-floor rhythm is fitted and reported as retimed

- **WHEN** the hip-bounce fit is computed against a clip whose on-screen bounce is slower than
  `spectralFitMinFrequencyHz` — retimed footage — and the sub-floor fit clears
  `verticalOscillationMinFitR2` and is significant against the red-noise null
- **THEN** the sub-floor fit is returned, the clip is flagged as retimed, and the returned frequency
  is strictly below `spectralFitMinFrequencyHz`

#### Scenario: A rhythmless correlated series is not reported as retimed

- **WHEN** the hip-bounce fit is computed against a series that has no rhythm at any frequency but
  whose samples are temporally correlated — a random walk, or any autoregressive noise — and its
  best sub-floor fit clears `verticalOscillationMinFitR2`
- **THEN** the clip is not reported as retimed and the sub-floor fit is not returned, because the
  peak is not distinguishable from that series' own noise background

#### Scenario: Rejection holds across the range of noise colour, not only at the extreme

- **WHEN** the hip-bounce fit is computed against rhythmless series spanning the range from
  uncorrelated to nearly perfectly correlated
- **THEN** the proportion reported as retimed stays at or near the complement of the null's
  confidence level across that whole range, rather than rising with correlation

#### Scenario: Neither pass clears the gate and nothing changes

- **WHEN** neither the in-band nor the sub-floor fit reaches `verticalOscillationMinFitR2`, and the
  scale-normalized pass is not adopted
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

### Requirement: Cadence is derived from the hip-bounce step frequency

The system SHALL compute cadence by fitting the resolvable hip-mid image-y samples to the shared
bounce fit (`fitBounceSpectrum`: the in-band grid — the `spectralFitMinFrequencyHz`/
`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` grid already used by vertical
oscillation — its sub-floor retry, and its scale-normalized fallback), and reporting
`value = frequencyHz × 60` — steps per minute, with no correction
factor — since this pipeline's hip-mid trace bounces once per STEP (twice per full gait cycle).
This SHALL NOT depend on footstrike detection (`detectFootstrikes`), and SHALL NOT REQUIRE a
resolvable body scale: torso length enters only through the scale-normalized fallback, which is not
attempted when no torso resolves. It SHALL reuse the identical hip-mid signal vertical oscillation
fits, via a shared extractor.

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

### Requirement: Vertical oscillation amplitude comes from a spectral sinusoid fit

The system SHALL compute vertical oscillation's amplitude by fitting the model
`v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²` to the resolvable image-y samples of the
configured vertical-oscillation input signal (`verticalOscillationSignal`; hip-mid by default) — or,
when the scale-normalized pass is adopted, to that signal's scale-normalized series (see "An
approaching runner's bounce is refitted on a scale-normalized series as a last resort") — by
ordinary least squares, once per candidate frequency `f` on the two-pass grid defined by
`spectralFitMinFrequencyHz`, `spectralFitMaxFrequencyHz`, `spectralFitFrequencyStepHz` and
`MAX_RETIMING_FACTOR` (see "A bounce rhythm below the human-gait floor is fitted on a second pass
and reported as retimed footage"),
selecting the frequency `f*` with the smallest residual sum of squares, and reporting
`value = 2·√(a²+b²) / torsoLengthPx` — a PEAK-TO-PEAK amplitude normalized by the same clip-median
torso length `estimateBodyScale` already provides, whose behavior is unchanged.

The system SHALL fit the samples that exist, at their real timestamps, and SHALL NOT resample or
interpolate the series onto a uniform grid before fitting.

The system SHALL gate the result on the ADOPTED fit's sinusoid PARTIAL coefficient of determination,
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

## ADDED Requirements

### Requirement: An approaching runner's bounce is refitted on a scale-normalized series as a last resort

The system SHALL consult a third, scale-normalized pass of the shared hip-bounce fit ONLY when
neither the in-band pass nor the sub-floor pass was adopted. Its purpose is a runner whose on-screen
size changes several-fold within the clip — approaching a handheld camera — whose pixel bounce grows
with them and whose perspective descent the fit's trend cannot follow, so that the raw in-band fit
can find the right frequency and still fall below the gate.

The system SHALL build the scale-normalized series from the same per-frame signal y the raw fit
uses, keeping only frames whose signal resolves AND whose local torso length (the median torso
length over a fixed ±0.5 s time window) is finite and positive. The first kept frame SHALL be 0; each
later kept frame SHALL add the change in image y since the previous kept frame divided by the mean of
the two frames' local torso lengths, with the image-y sign kept and no reset across gaps; and every
value SHALL be multiplied by the clip-median torso length, so the fitted amplitude reads in pixels at
the clip's typical scale.

The system SHALL fit that series on the in-band grid only — never the sub-floor grid — and SHALL
adopt it only when its sinusoid partial R² reaches `verticalOscillationMinFitR2`, the same gate as
the first pass. This SHALL NOT introduce a new configurable threshold, and SHALL NOT change the gate,
the frequency grid, or the result of any clip whose first or second pass is adopted. When adopted,
the clip SHALL NOT be reported as retimed, and the adoption SHALL be reported to callers as a single
boolean on the shared bounce analysis, distinct from the retimed flag.

Vertical ratio SHALL withhold its value when the adopted bounce fit is scale-normalized, because
that fit's amplitude is at the clip-median torso scale while its stride-length denominator is in
raw pixels.

#### Scenario: An approaching runner's bounce is recovered from the scale-normalized series

- **WHEN** the hip-bounce fit is computed against a clip whose runner grows several-fold in frame
  while bouncing at a human-gait rhythm, whose raw in-band fit falls below
  `verticalOscillationMinFitR2`, and whose sub-floor fit is not adopted
- **THEN** the scale-normalized fit is returned and flagged as scale-normalized, its frequency is
  the runner's bounce frequency, cadence reports that frequency × 60 without a slow-motion caveat,
  and vertical oscillation reports a value near the true torso-relative bounce

#### Scenario: A clip whose raw fit is adopted never reaches the scale-normalized pass

- **WHEN** the hip-bounce fit is computed against a clip whose in-band fit clears
  `verticalOscillationMinFitR2`, or whose sub-floor fit is adopted
- **THEN** the scale-normalized series is never built, the returned result is identical to the one
  the two-pass fit produced before this rule existed, and the fit is not flagged as
  scale-normalized

#### Scenario: The scale-normalized fit must clear the same gate

- **WHEN** the scale-normalized pass is consulted and its in-band fit falls below
  `verticalOscillationMinFitR2`, or fails outright
- **THEN** the first pass's result is returned untouched and the fit is not flagged as
  scale-normalized

#### Scenario: No resolvable torso, no fallback

- **WHEN** the scale-normalized pass would be consulted but no frame resolves a torso length, or the
  frames are not in presentation (non-decreasing timestamp) order
- **THEN** the pass is not attempted, nothing throws, and the first pass's result is returned
  untouched

#### Scenario: The scale-calibrated metre series does not take the fallback

- **WHEN** the scale-calibrated vertical-oscillation per-run metre series is fitted
- **THEN** no scale-normalized pass is consulted, because that series is already integrated from
  per-frame deltas divided by a per-frame scale

#### Scenario: The chart trace stays raw

- **WHEN** a clip's bounce fit is adopted from the scale-normalized pass
- **THEN** the per-frame signal trace the shared bounce analysis reports, and the vertical
  oscillation series charted from it, are the raw pixel y values, not the normalized series

#### Scenario: The vertical-oscillation fit names its normalization

- **WHEN** vertical oscillation reports a value
- **THEN** its fit carries a `scaleNormalized` boolean that is `true` exactly when the bounce fit
  was adopted from the scale-normalized pass, in which case its peak-to-peak amplitude is in pixels
  at the clip-median torso scale rather than raw image pixels

#### Scenario: Vertical ratio does not mix scales

- **WHEN** vertical ratio is computed against a clip whose bounce fit was adopted from the
  scale-normalized pass
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` says in plain language that the
  runner's distance from the camera changed too much to compare bounce height with stride length
