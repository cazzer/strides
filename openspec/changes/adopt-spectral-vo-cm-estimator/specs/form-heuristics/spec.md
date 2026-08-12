## MODIFIED Requirements

### Requirement: Scale-calibrated vertical oscillation from integrated per-frame deltas
The system SHALL provide a calculation, separate from and not altering `computeVerticalOscillation`,
that converts the hip-midpoint vertical pixel series into real-world units using the per-frame
`RobustPoseFrame.pixelsPerMeter` scale, and reports a bounce amplitude in centimetres. The
conversion SHALL be performed by integrating per-frame *deltas* — accumulating
`(y[k-1] - y[k]) / s̄[k]`, where `s̄[k]` is the mean of the two flanking frames' scales — and
SHALL NOT divide absolute pixel positions by a per-frame scale, which fabricates enormous
excursions whenever the scale drifts (a subject approaching the camera) even though the subject
has not moved vertically at all. Integration SHALL restart from zero at every gap in the hip
series. The calculation SHALL return `null` when no frame in the input carries a scale, rather
than reporting a fabricated or zero measurement.

The amplitude SHALL be read from the shared spectral sinusoid-fit primitive, fitted to each
integration run's converted metric series independently — PER RUN, never across runs, since each
run's cumulative series restarts at its own arbitrary baseline. The reported amplitude SHALL be a
fitted PEAK-TO-PEAK amplitude in centimetres. A run SHALL contribute only when the primitive
reports a well-posed fit AND that fit's sinusoid PARTIAL coefficient of determination (against a
trend-only baseline, never the total coefficient of determination) is at or above the
calculation's documented minimum. When more than one run contributes, the reported amplitude and
every reported fit statistic SHALL come from a single contributing run's fit, selected by a
sample-count-weighted median over the contributing runs' amplitudes, so that no reported
combination of amplitude, frequency and fit quality describes a fit that never happened. The
reported sample size SHALL be the number of complete bounce cycles observed across all
contributing runs. When no run contributes, the calculation SHALL report no amplitude, no fit,
and a typed reason naming why — never a zero amplitude and never an unexplained `null`. The
calculation SHALL NOT require a resolvable body-scale reference in order to report an amplitude.

#### Scenario: Constant scale matches the pixel-path amplitude exactly
- **WHEN** the calculation runs over a gapless hip series whose `pixelsPerMeter` is the same
  constant `s` on every frame
- **THEN** the reported centimetre amplitude equals the existing pixel-path amplitude divided by
  `s` and converted to centimetres, to within floating-point tolerance, and both paths report the
  same winning fit frequency, the same fit quality, and the same number of complete cycles

#### Scenario: A drifting scale over a stationary subject fabricates no bounce
- **WHEN** the hip's pixel position is constant across the clip while `pixelsPerMeter` drifts
  substantially (for example tripling), a case in which dividing absolute positions by the
  per-frame scale would report a multi-metre excursion
- **THEN** the integrated-delta calculation reports a `null` amplitude with a sample size of zero
  and a typed reason naming the converted series as having nothing to fit

#### Scenario: A real bounce under mild drift is recovered
- **WHEN** the hip's pixel series encodes a known real-world bounce amplitude modulated by a
  mildly drifting scale
- **THEN** the reported centimetre amplitude is within ten percent of the known amplitude

#### Scenario: Camera-approach drift does not inflate the centimetre amplitude
- **WHEN** the same known bounce is measured twice — once alone, and once with a large linear and
  quadratic translation added to the hip's pixel trace, as a subject approaching the camera
  produces
- **THEN** the two reported centimetre amplitudes agree to within roughly ten percent, because the
  fit's trend terms absorb the translation instead of charging it to the bounce

#### Scenario: Amplitudes are never paired across an integration-run boundary
- **WHEN** the hip series contains an unresolvable gap splitting it into two runs whose pixel
  positions differ by a large constant offset
- **THEN** the reported amplitude reflects only within-run bounce — each run is fitted alone, so no
  amplitude is ever derived from samples spanning two runs, and nothing corresponding to that
  inter-run offset appears in the result

#### Scenario: A fit below the quality threshold reports no amplitude and names why
- **WHEN** the converted metric series carries no consistent rhythm, so its fit's partial
  coefficient of determination falls below the calculation's minimum
- **THEN** the calculation reports a `null` amplitude with no fit and a typed reason identifying
  the quality threshold as the cause, while still reporting the scale drift ratio, median
  pixels-per-metre and scale coverage it measured

#### Scenario: No scale anywhere yields no result
- **WHEN** every frame's `pixelsPerMeter` is `null` (for example every backend other than
  MediaPipe)
- **THEN** the calculation returns `null` rather than a result object with null or zero fields

#### Scenario: Partial scale coverage within a run still integrates
- **WHEN** some frames within an integration run carry a scale and others do not
- **THEN** the missing scales are filled by linear interpolation between the flanking scale
  samples (held at the nearest value at the run's edges), the reported scale coverage is less than
  one, and the reported amplitude and sample size match what fully-scaled frames would have
  produced

#### Scenario: Reported statistics are finite and self-describing
- **WHEN** the calculation returns a result with an amplitude
- **THEN** its scale-drift ratio equals the last scale sample divided by the first, its
  torso-in-metres equals the pixel torso length divided by the median scale, its reported fit
  statistics are all finite, and no reported field is `NaN` or `Infinity`
