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
diagnostics' scale-calibration block is sourced from `verticalOscillationCm.calibration`, a field
`computeFormHeuristics` itself produces as part of the trimmed-window computation — so it reflects
the trimmed window BY CONSTRUCTION, with no separate trimming step of its own left to drift out of
sync with the metrics alongside which it is reported.

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
  scale-calibration block, which reflects the presence window by construction, since it is sourced
  from `computeFormHeuristics`'s own `verticalOscillationCm` metric output rather than computed
  separately

#### Scenario: No trackable frames anywhere leaves metrics computation unaffected

- **WHEN** no frame in the clip has a resolvable shoulder/hip position at all
- **THEN** the presence window is empty and every metric falls back to its existing
  no-resolvable-body-scale-reference null result, exactly as it would for an all-unresolvable
  clip today

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
trend-only baseline, never the total coefficient of determination) is at or above
`verticalOscillationMinFitR2` — the same documented minimum `verticalOscillation` and
`verticalRatio` gate on, reused rather than a dedicated threshold, so that the family cannot
disagree about whether one shared fitted amplitude is trustworthy. When more than one run
contributes, the reported amplitude and every reported fit statistic SHALL come from a single
contributing run's fit, selected by a sample-count-weighted median over the contributing runs'
amplitudes, so that no reported combination of amplitude, frequency and fit quality describes a
fit that never happened. The reported sample size SHALL be the number of complete bounce cycles
observed across all contributing runs. When no run contributes, the calculation SHALL report no
amplitude, no fit, and a typed reason naming why — never a zero amplitude and never an unexplained
`null`. The calculation SHALL NOT require a resolvable body-scale reference in order to report an
amplitude. `computeFormHeuristics` SHALL invoke this calculation exactly once per run, as part of
computing the `verticalOscillationCm` metric, and SHALL carry its result on that metric's
`calibration` field.

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

## ADDED Requirements

### Requirement: Vertical oscillation in centimetres is a metric gated on measured real-world scale

The system SHALL expose vertical oscillation in centimetres as a `MetricId` (`verticalOscillationCm`),
positioned immediately after `verticalRatio` in `MetricId` and every enumeration of it. Its `value`
SHALL be the scale-calibrated calculation's reported centimetre amplitude when a real-world scale
was measured for the clip and a fit cleared the calculation's quality gate, and `null` otherwise.
When no frame in the clip carries a measured real-world scale, the system SHALL report `value:
null`, `confidence: 0`, `calibration: null`, and a caveat stating this is an availability limitation
of the current detection backend, not an error — the same caveat regardless of whether the backend
in use has never measured scale or a scale-measuring backend's per-frame measurement failed
everywhere on this particular clip, since the calculation cannot distinguish the two cases. When a
real-world scale WAS measured but no integration run's fit cleared the quality gate, the system
SHALL report `value: null`, `confidence: 0`, a non-null `calibration`, and a caveat naming the
specific typed reason (mirroring the calculation's own `ScaleCalibratedFitFailureReason`), distinct
from the not-measured-at-all caveat.

#### Scenario: A backend that doesn't measure scale reports an availability caveat

- **WHEN** `verticalOscillationCm` is computed against a clip where no frame's `pixelsPerMeter` is
  measured
- **THEN** `value` is `null`, `confidence` is `0`, `calibration` is `null`, `unit` is
  `'centimeters'`, and `caveat` states that no real-world scale was measured and names what backend
  capability would be needed, without throwing

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

### Requirement: Vertical oscillation in centimetres is view-tolerant, on the same terms as vertical oscillation

The system SHALL compute vertical oscillation in centimetres for every detected view (`'side'`,
`'front'`, `'ambiguous'`), applying a per-view confidence multiplier from
`viewFitTable.verticalOscillationCm` (`side: 1.0`, `front: 0.85`, `ambiguous: 0.6`) —
identical to `viewFitTable.verticalOscillation`'s multipliers, not merely similarly shaped —
rather than withholding the value outside side view or applying `verticalRatio`'s hard-gated
multipliers. This metric has no denominator that foreshortens under camera angle the way
`verticalRatio`'s stride-length denominator does, so `verticalRatio`'s hard-gating argument does
not transfer to it.

#### Scenario: Front-view clip still produces a value

- **WHEN** vertical oscillation in centimetres is computed against a `'front'`-classified clip
  with a measured scale and a fittable bounce
- **THEN** a non-null `value` is returned with `viewFit: 'tolerated'` and confidence discounted by
  the `0.85` multiplier relative to an otherwise-identical side-view computation

#### Scenario: The view-fit label is reported even when no scale was measured

- **WHEN** vertical oscillation in centimetres is computed against a `'front'`-classified clip
  where no frame carries a measured scale
- **THEN** `viewFit` is `'tolerated'` (reflecting the detected view, per the same convention every
  other metric in this package follows) even though `value` is `null`

### Requirement: The vertical-oscillation family reports one bounce estimate through three denominators

The system SHALL ensure that, under a constant `pixelsPerMeter` scale across a clip,
`verticalOscillationCm`'s underlying spectral fit and `verticalOscillation`'s underlying spectral
fit agree on the winning frequency exactly, agree on the sinusoid partial coefficient of
determination to within floating-point tolerance, agree on the sample count exactly, and relate in
amplitude by exactly the documented pixel-to-centimetre conversion (`peakToPeakAmplitudePx / s ×
100`) — evidence that the family's three metrics report the same underlying bounce through three
different denominators (torso length, stride length, none), not three independently-measured
quantities that merely happen to correlate. This agreement SHALL be understood as a property of
the two series being fit (an affine image of each other under constant scale), not of the two
fits being computed by a single shared code path — each family member remains free to derive its
own fit independently.

#### Scenario: A constant-scale clip's cm and pixel fits agree in frequency, quality, and sample count

- **WHEN** `computeFormHeuristics` is run against a clip whose `pixelsPerMeter` is the same
  constant on every frame, with both a fittable pixel-path bounce and a fittable centimetre-path
  bounce
- **THEN** `verticalOscillationCm.calibration.fit.frequencyHz` equals
  `verticalOscillation.fit.frequencyHz` exactly, their `sinusoidR2` values agree closely, their
  sample counts are equal, and `verticalOscillationCm.value` equals
  `verticalOscillation.fit.peakToPeakAmplitudePx / pixelsPerMeter × 100` closely

### Requirement: Vertical oscillation in centimetres participates in the shared orchestration and output contract

The system SHALL include vertical oscillation in centimetres in `computeFormHeuristics`'s result
(`FormHeuristicsResult.verticalOscillationCm`), positioned immediately after `verticalRatio` —
appended after it rather than inserted between `verticalOscillation` and `verticalRatio`, so that
`verticalRatio`'s own orchestration requirement (that it sits immediately after
`verticalOscillation`) remains true without modification — computed under the same once-per-clip
detected view as every other metric, and SHALL follow the same output contract every other metric
follows: `value` a finite number or `null` (never `NaN` or `Infinity`), `confidence` in `[0, 1]`
forced to `0` when `value` is `null`, and no exception for any well-typed `RobustPoseFrame[]` input
including an empty array.

#### Scenario: computeFormHeuristics includes vertical oscillation in centimetres gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `verticalOscillationCm.viewFit` reflects the same `view.view` label
  present in the same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `verticalOscillationCm.value` is `null` and `verticalOscillationCm.confidence` is `0`,
  without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** vertical oscillation in centimetres is computed against any combination of empty
  frames, a clip with no measured scale, a clip with a measured scale but no fittable rhythm, or a
  clip with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`
