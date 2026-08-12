## REMOVED Requirements

### Requirement: Cadence is computed from shared footstrike detection
**Reason**: Measured ~30% high on the track demo clip (footstrike-path median 125 spm vs.
independent ground truth 91–98 spm vs. the shared spectral fit's 93.6 spm) — spurious
prominence-confirmed ankle-y extrema shrink the median inter-footstrike interval and inflate
`60 / interval`. Every clause of this requirement (the formula, the footstrike-count sample size,
the ankle-interpolation-fraction accounting) is reversed by the replacement, not merely adjusted.
`detectFootstrikes` itself is unchanged and still serves `overstriding`/`footStrikePattern` — only
cadence stops consuming it.
**Migration**: See the new "Cadence is derived from the hip-bounce step frequency" requirement
below.

### Requirement: Cadence is view-tolerant, with a front-view discount steeper than vertical oscillation's
**Reason**: The `0.8` front-view multiplier this requirement's own title describes was justified
by ankle-occlusion risk specific to footstrike detection near a footstrike. Cadence no longer
reads ankle position at all (its input is now the identical hip-mid series vertical oscillation
reads), so that justification is falsified, not merely superseded — the title's claim of a
front-view discount "steeper than vertical oscillation's" is no longer true.
**Migration**: See the new "Cadence is view-tolerant, on the same terms as vertical oscillation"
requirement below.

## ADDED Requirements

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
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names the measured fit quality (or
  failure reason) and the `cadenceMinFitR2` threshold where applicable

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
- **THEN** the returned `caveat` names the searched frequency range, alongside any other caveat
  that applies

#### Scenario: Fit quality and step count both feed confidence

- **WHEN** cadence reports a value from a fit whose partial R² clears `cadenceMinFitR2` but falls
  short of a clean-clip fit, or whose step count falls below `MIN_CADENCE_STEPS`
- **THEN** `confidence` is reduced proportionally by each shortfall that applies, on top of the
  existing view-fit, frame-coverage and interpolation factors, and `caveat` is non-null

#### Scenario: Degenerate input never throws or produces NaN

- **WHEN** cadence is computed against an empty frame list, or frames that would otherwise produce
  a degenerate fit
- **THEN** `value` is `null` (never `NaN`), `confidence` is `0`, and no exception is thrown

### Requirement: Cadence is view-tolerant, on the same terms as vertical oscillation

The system SHALL compute and return a cadence value for every detected view (`'side'`, `'front'`,
`'ambiguous'`) — never substituting `null` purely because the view is unsuitable — applying a
per-view confidence multiplier from `viewFitTable.cadence` (`side: 1.0`, `front: 0.85`,
`ambiguous: 0.6`) that is IDENTICAL to `viewFitTable.verticalOscillation`'s, since cadence now
reads the same hip-mid vertical-axis signal vertical oscillation does and projects onto image-y
the same way regardless of camera facing direction.

#### Scenario: Front-view clip still produces a cadence value

- **WHEN** cadence is computed against a `'front'`-classified clip with a resolvable, fittable
  hip-mid bounce rhythm
- **THEN** a non-null `value` is returned with `viewFit: 'tolerated'` and confidence discounted by
  the `0.85` multiplier relative to an otherwise-identical side-view computation

#### Scenario: Ambiguous-view clip still produces a cadence value

- **WHEN** cadence is computed against an `'ambiguous'`-classified clip with a resolvable,
  fittable hip-mid bounce rhythm
- **THEN** a non-null `value` is returned with `viewFit: 'tolerated'` and confidence discounted by
  the `0.6` multiplier
