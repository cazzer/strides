## ADDED Requirements

### Requirement: Scale-calibrated vertical oscillation from integrated per-frame deltas
The system SHALL provide a calculation, separate from and not altering `computeVerticalOscillation`,
that converts the hip-midpoint vertical pixel series into real-world units using the per-frame
`RobustPoseFrame.pixelsPerMeter` scale, and reports the median half-cycle bounce amplitude in
centimetres. The conversion SHALL be performed by integrating per-frame *deltas* — accumulating
`(y[k-1] - y[k]) / s̄[k]`, where `s̄[k]` is the mean of the two flanking frames' scales — and
SHALL NOT divide absolute pixel positions by a per-frame scale, which fabricates enormous
excursions whenever the scale drifts (a subject approaching the camera) even though the subject
has not moved vertically at all. Integration SHALL restart from zero at every gap in the hip
series, and amplitudes SHALL be paired only between consecutive opposite-kind extrema found
within a single integration run, never across a run boundary — each run's cumulative series has
its own arbitrary baseline, so a cross-run pair would report the difference between two unrelated
baselines as if it were a bounce. The calculation SHALL return `null` when no frame in the input
carries a scale, rather than reporting a fabricated or zero measurement.

#### Scenario: Constant scale matches the pixel-path amplitude exactly
- **WHEN** the calculation runs over a gapless hip series whose `pixelsPerMeter` is the same
  constant `s` on every frame
- **THEN** the reported centimetre amplitude equals the existing pixel-path amplitude divided by
  `s` and converted to centimetres, to within floating-point tolerance, over the same number of
  half-cycles

#### Scenario: A drifting scale over a stationary subject fabricates no bounce
- **WHEN** the hip's pixel position is constant across the clip while `pixelsPerMeter` drifts
  substantially (for example tripling), a case in which dividing absolute positions by the
  per-frame scale would report a multi-metre excursion
- **THEN** the integrated-delta calculation reports no detected half-cycle: a `null` amplitude
  with a sample size of zero

#### Scenario: A real bounce under mild drift is recovered
- **WHEN** the hip's pixel series encodes a known real-world bounce amplitude modulated by a
  mildly drifting scale
- **THEN** the reported centimetre amplitude is within ten percent of the known amplitude

#### Scenario: Amplitudes are never paired across an integration-run boundary
- **WHEN** the hip series contains an unresolvable gap splitting it into two runs whose pixel
  positions differ by a large constant offset
- **THEN** no reported amplitude corresponds to that inter-run offset; every amplitude comes from
  a pair of extrema within one run

#### Scenario: No scale anywhere yields no result
- **WHEN** every frame's `pixelsPerMeter` is `null` (for example every backend other than
  MediaPipe)
- **THEN** the calculation returns `null` rather than a result object with null or zero fields

#### Scenario: Partial scale coverage within a run still integrates
- **WHEN** some frames within an integration run carry a scale and others do not
- **THEN** the missing scales are filled by linear interpolation between the flanking scale
  samples (held at the nearest value at the run's edges), the reported scale coverage is less than
  one, and the amplitude is close to what fully-scaled frames would have produced

#### Scenario: Reported statistics are finite and self-describing
- **WHEN** the calculation returns a result
- **THEN** its scale-drift ratio equals the last scale sample divided by the first, its
  torso-in-metres equals the pixel torso length divided by the median scale, and no reported field
  is `NaN` or `Infinity`

## MODIFIED Requirements

### Requirement: Metrics are computed over a presence-trimmed window, not the raw clip

The system SHALL compute `FormHeuristicsResult` from a frame sequence trimmed to the span
between the first and last frame where the subject is trackable at all (shoulder-mid and
hip-mid both resolvable), rather than the full, untrimmed clip — so that `frameCoverage` and
`bodyScale`'s `sampleCoverage` (both computed as `resolvedFrameCount / consideredFrameCount`)
reflect how well the subject was tracked *while actually in frame*, not diluted by stretches
where there was nothing to track at all (e.g. the subject hasn't entered frame yet, or has
already left it). A frame only starts or ends the presence window once a short run of
consecutive trackable frames confirms it, so a single spurious detection cannot anchor the
window on its own. This trim applies only to the frames handed to `computeFormHeuristics` — the
canonical `RobustPoseFrame[]` used for the skeleton overlay, and the development-only analysis
diagnostics, both continue to reflect the full, untrimmed clip, with one carve-out: the
diagnostics' scale-calibration block is computed over the same trimmed window
`computeFormHeuristics` receives, so that its figures are directly comparable to the metrics
alongside which they are reported rather than being measured over a different span.

#### Scenario: A clip with the subject absent at the start and end trims to the presence window

- **WHEN** a clip's first and last several frames have no resolvable shoulder/hip position, but a
  contiguous middle span does
- **THEN** `computeFormHeuristics` computes every metric's `frameCoverage`/confidence as if the
  input were just that middle span, not the full clip

#### Scenario: A single spurious detection does not anchor the presence window

- **WHEN** a single frame near the start or end of an otherwise-absent stretch has a resolvable
  shoulder/hip position, isolated (not part of a short consecutive run)
- **THEN** that frame does not by itself extend the presence window to include it

#### Scenario: A clip with the subject present throughout is unaffected

- **WHEN** every frame (or all but a short consecutive run at either edge) has a resolvable
  shoulder/hip position
- **THEN** the presence window spans the full clip and every metric's `frameCoverage`/confidence
  is unchanged from computing against the untrimmed frames

#### Scenario: The skeleton overlay and diagnostics are not trimmed

- **WHEN** analysis completes for a clip whose presence window is narrower than the full clip
- **THEN** `VideoAnalysisState.robustFrames` (used by the skeleton overlay) and `diagnostics`
  (the development-only analysis diagnostics) both still reflect every sampled frame, not just
  the presence window used internally by `computeFormHeuristics` — except the diagnostics'
  scale-calibration block, which is computed over the presence window by design

#### Scenario: No trackable frames anywhere leaves metrics computation unaffected

- **WHEN** no frame in the clip has a resolvable shoulder/hip position at all
- **THEN** the presence window is empty and every metric falls back to its existing
  no-resolvable-body-scale-reference null result, exactly as it would for an all-unresolvable
  clip today
