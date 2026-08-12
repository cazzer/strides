# form-heuristics Specification

## Purpose
Turn the robustness layer's `RobustPoseFrame[]` stream into running-form metrics — vertical
oscillation, trunk lean, overstriding — gated by an automatically-detected camera view (side /
front-or-back / ambiguous), so that every metric reports a value and a confidence that honestly
reflects both the input quality and whether the metric is even meaningful from the detected
camera angle.
## Requirements
### Requirement: View classification from independent geometric signals

The system SHALL classify a clip's camera framing as `'side'`, `'front'` (front-or-back — no face
keypoints exist in this pipeline, and nothing downstream distinguishes them), or `'ambiguous'`,
using two independent signals — Bilateral Spread Ratio (BSR: left/right shoulder+hip spread
relative to torso length) and Sagittal Excursion Ratio (SER: per-side ankle-relative-to-hip range
relative to torso length) — each compared against configurable thresholds
(`sideViewMaxBilateralSpreadRatio`, `frontViewMinBilateralSpreadRatio`,
`sideViewMinSagittalExcursionRatio`, `frontViewMaxSagittalExcursionRatio`).

#### Scenario: Both signals agree on side view

- **WHEN** BSR is at or below `sideViewMaxBilateralSpreadRatio` AND SER is at or above
  `sideViewMinSagittalExcursionRatio`
- **THEN** the clip is classified `'side'`

#### Scenario: Both signals agree on front view

- **WHEN** BSR is at or above `frontViewMinBilateralSpreadRatio` AND SER is at or below
  `frontViewMaxSagittalExcursionRatio`
- **THEN** the clip is classified `'front'`

#### Scenario: Signals disagree or are individually inconclusive

- **WHEN** one signal votes side and the other votes front, or either signal doesn't clear either
  threshold, or a signal is unavailable (no frames yield a usable BSR or SER sample)
- **THEN** the clip is classified `'ambiguous'` rather than committing to a possibly-wrong label

### Requirement: View detection degrades to ambiguous, zero confidence, under insufficient coverage

The system SHALL classify a clip as `'ambiguous'` with `confidence: 0` whenever fewer than
`minViewDetectionFrameCoverage` of frames yield a usable body-scale (torso-length) sample,
including when zero frames do.

#### Scenario: Body-scale coverage below the minimum

- **WHEN** the fraction of frames with a resolvable shoulder-mid and hip-mid is below
  `minViewDetectionFrameCoverage`
- **THEN** `detectView` returns `{ view: 'ambiguous', confidence: 0 }` without attempting to
  compute BSR or SER

#### Scenario: No frames at all

- **WHEN** `detectView` is called with an empty frame list
- **THEN** it returns `{ view: 'ambiguous', confidence: 0 }` without throwing

### Requirement: View-detection confidence reflects signal margin and sample coverage

The system SHALL scale a committed (`'side'`/`'front'`) view label's confidence by how far each
signal sits from its decision threshold (0 at the boundary, approaching 1 deep in-band) and by
body-scale sample coverage; an `'ambiguous'` label from signal disagreement (as opposed to
insufficient coverage) SHALL use a flat, coverage-scaled confidence rather than a per-signal
margin, since no principled margin exists when the signals disagree.

#### Scenario: Deep in-band signals yield high confidence

- **WHEN** both BSR and SER sit well clear of their respective thresholds for the committed view,
  and body-scale coverage is high
- **THEN** the returned confidence is correspondingly high (close to the coverage value)

#### Scenario: Ambiguous-by-disagreement uses a flat confidence

- **WHEN** the view is `'ambiguous'` because the two signals disagree (not because of insufficient
  coverage)
- **THEN** confidence is `0.3 * bodyScale.sampleCoverage`

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

### Requirement: Trunk lean and overstriding are hard-gated to side view

The system SHALL still compute and return a value for trunk lean and overstriding when the
detected view is `'front'` or `'ambiguous'` — never substituting `null` purely because the view is
unsuitable — while applying `viewFitTable.trunkLean`/`viewFitTable.overstriding`'s low multipliers
(`front: 0.1`, `ambiguous: 0.2`) and attaching a caveat stating the view is unsuitable, since a
front-facing camera cannot see the sagittal-plane quantity either metric measures.

#### Scenario: Front-view trunk lean is computed, not withheld

- **WHEN** trunk lean is computed against a `'front'`-classified clip with resolvable torso
  positions
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat` stating the view is unsuitable

#### Scenario: Front-view overstriding is computed, not withheld

- **WHEN** overstriding is computed against a `'front'`-classified clip with detectable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat` stating the view is unsuitable

### Requirement: Missing and interpolated keypoints are handled per a shared, documented policy

The system SHALL derive every heuristic's input exclusively from `RobustPoseFrame` (never raw
pose-detection output), resolving bilateral midpoints tolerantly (falling back to a single
resolvable side, flagged as interpolated, rather than discarding the frame) for center-of-mass
proxies, and strictly (both sides required) only where the left/right separation itself is the
measured signal. Every metric SHALL track what fraction of its resolved input was interpolated
rather than directly detected, and factor that fraction into its confidence.

#### Scenario: Single-side fallback keeps a frame usable

- **WHEN** one side of a bilateral pair (e.g. left hip) is `'unrecoverable'` in a given frame but
  the other side resolves
- **THEN** the frame still contributes a center-of-mass sample (via the resolvable side), flagged
  as interpolated for confidence purposes

#### Scenario: Heavily-interpolated input yields visibly reduced confidence

- **WHEN** a metric's resolved input frames were predominantly `'interpolated'` rather than
  `'detected'`, or a large fraction of frames were `'unrecoverable'` (reducing frame coverage)
- **THEN** the metric's `confidence` is visibly lower than an otherwise-identical computation over
  fully-`'detected'`, fully-covered input, and the computation still completes without throwing

### Requirement: Output contract — value and confidence are always present, never NaN, never throws

Every metric SHALL return a `MetricResult` with `value` either a finite number or `null` (never
`NaN`), `confidence` in `[0, 1]` and forced to `0` whenever `value` is `null`, and SHALL NOT throw
for any well-typed `RobustPoseFrame[]` input, including an empty array or one with no resolvable
keypoints at all.

#### Scenario: No resolvable input produces a null value, not a crash or NaN

- **WHEN** a metric is computed against frames with no resolvable input relevant to that metric
  (e.g. no resolvable hip position for vertical oscillation, no detectable footstrikes for
  overstriding)
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** any metric, or `computeFormHeuristics`, is called with an empty `RobustPoseFrame[]`
- **THEN** it returns a well-formed result (`view: 'ambiguous'`, every metric's `value: null`,
  `confidence: 0`) without throwing

### Requirement: Orchestration runs view detection once and shares it across all three metrics

The system SHALL provide `computeFormHeuristics(frames, config?)` that runs `detectView` exactly
once and passes its result into all three metric computations, so callers never need to invoke
view detection and each metric separately in the correct order.

#### Scenario: All three metrics use the same detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `verticalOscillation.viewFit`, `trunkLean.viewFit`, and
  `overstriding.viewFit` all reflect the same `view.view` label present in the same result

### Requirement: Cadence participates in the shared orchestration and output contract

The system SHALL include cadence in `computeFormHeuristics`'s result (`FormHeuristicsResult.cadence`),
computed under the same once-per-clip detected view as the other three metrics, and SHALL follow
the same output contract every other metric follows: `value` a finite number or `null` (never
`NaN`), `confidence` in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any
well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes cadence gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `cadence.viewFit` reflects the same `view.view` label present in the same
  result as `verticalOscillation`, `trunkLean`, and `overstriding`

#### Scenario: Empty frame list produces a well-formed cadence result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `cadence.value` is `null` and `cadence.confidence` is `0`, without throwing

### Requirement: Knee flexion is hard-gated to side view

The system SHALL still compute and return a value for knee flexion when the detected view is
`'front'` or `'ambiguous'` — never substituting `null` purely because the view is unsuitable —
while applying `viewFitTable.kneeFlexion`'s low multipliers (`front: 0.1`, `ambiguous: 0.2`) and
attaching a caveat stating the view is unsuitable, since a front-facing camera cannot see the
sagittal-plane hip-knee-ankle angle knee flexion measures.

#### Scenario: Front-view knee flexion is computed, not withheld

- **WHEN** knee flexion is computed against a `'front'`-classified clip with resolvable
  hip/knee/ankle positions
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat` stating the view is unsuitable

### Requirement: Knee flexion reports the median swing-phase peak across both legs

The system SHALL compute, for each leg independently, the hip-knee-ankle interior joint angle per
frame wherever that leg's hip/knee/ankle all resolve, convert it to degrees of flexion from full
extension (`180° - interior angle`, so `0°` is a fully straight leg and larger values mean more
bend), detect each leg's swing-phase peak-flexion cycles via a prominence-thresholded extrema scan
of that per-leg flexion-degrees series, and report the clip's `value` as the median of the peaks
pooled from both legs.

#### Scenario: A clean clip reports a plausible pooled median

- **WHEN** knee flexion is computed against a side-view clip with a clear, repeating flexion/
  extension cycle on both legs
- **THEN** `value` is the median of the per-leg swing-phase peak-flexion values (in degrees),
  `unit` is `'degrees'`, and `sampleSize` reflects the number of peaks pooled from both legs

#### Scenario: No swing-phase peak is detectable

- **WHEN** hip/knee/ankle positions resolve but the per-leg flexion-degrees series never moves by
  at least `kneeFlexionMinProminenceDegrees` (e.g. a flat, unbending trace)
- **THEN** `value` is `null`, `confidence` is `0`, `sampleSize` is `0`, and `caveat` is non-null,
  without throwing

#### Scenario: No resolvable leg position at all

- **WHEN** neither leg's hip/knee/ankle resolve in any frame
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` is non-null, without throwing

### Requirement: Knee flexion is included in orchestrated output

The system SHALL include `kneeFlexion: MetricResult` in `FormHeuristicsResult`, computed by
`computeFormHeuristics` using the same detected `View` shared with the other three metrics.

#### Scenario: Orchestrated result includes knee flexion

- **WHEN** `computeFormHeuristics` is called on a frame sequence
- **THEN** the returned result's `kneeFlexion.viewFit` reflects the same `view.view` label present
  in the same result as the other three metrics

### Requirement: Arm swing symmetry compares per-side wrist-relative-to-shoulder swing amplitude

The system SHALL compute arm swing symmetry as `min(leftAmplitude, rightAmplitude) /
max(leftAmplitude, rightAmplitude)`, where each side's amplitude is the median torso-normalized
half-cycle amplitude of that side's wrist-y position relative to its own shoulder-y over the clip
— a `'percent'`-unit, 0-1 ratio where `1` means perfectly symmetric swing and values approaching
`0` mean one arm swings substantially more than the other.

#### Scenario: Symmetric swing scores near 1

- **WHEN** both arms show comparable, matched vertical swing amplitude across the clip
- **THEN** the returned ratio is close to `1`

#### Scenario: Asymmetric swing scores lower than a matched symmetric case

- **WHEN** one arm's swing amplitude is substantially smaller than the other's, all else equal
- **THEN** the returned ratio is meaningfully lower than the ratio computed from an otherwise-
  identical symmetric case

### Requirement: Arm swing symmetry is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for arm swing symmetry
(`viewFitTable.armSwingSymmetry.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — the mirror image of trunk lean/overstriding's side-view-primary
gating — because a side view occludes or superimposes the far arm rather than because the swing
signal itself is invisible from the side. `'ambiguous'` SHALL also be treated as unsuitable
(`multiplier: 0.2`). The system SHALL still compute and return a value when the view is `'side'`
or `'ambiguous'`, never substituting `null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** arm swing symmetry is computed against a `'front'`-classified clip with resolvable,
  separable left/right wrist and shoulder positions
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** arm swing symmetry is computed against a `'side'`-classified clip with resolvable arm
  positions
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat`

### Requirement: Arm swing symmetry follows the shared output contract

The system SHALL return a `MetricResult` for arm swing symmetry using the `'percent'` unit, with
`value: null` and `confidence: 0` whenever either arm has no resolvable shoulder/wrist position or
no complete swing cycle is detected in the clip, and SHALL NOT throw for any well-typed
`RobustPoseFrame[]` input, including an empty array.

#### Scenario: Insufficient data yields null, not a crash

- **WHEN** one or both arms have no resolvable shoulder/wrist position, or no complete swing cycle
  is detected on one or both sides
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** arm swing symmetry is computed against an empty `RobustPoseFrame[]`
- **THEN** it returns `value: null`, `confidence: 0`, without throwing

### Requirement: Foot strike pattern is an explicitly-labeled proxy, hard-gated to side view

The system SHALL compute a foot strike pattern indicator (heel / midfoot / forefoot) as a
documented **approximation** — this pipeline has no toe/foot keypoint and no ground-plane
calibration, so a real foot-ground-angle classification is not possible from its input. The
approximation SHALL classify each detected footstrike (via the shared footstrike-detection
primitive) by the same-side ankle's horizontal position relative to the knee, in the direction of
travel, normalized by torso length: an ankle notably ahead of the knee (beyond
`footStrikeMidfootBandRatio` of torso length) SHALL classify as heel-like, notably behind as
forefoot-like, and within that band as midfoot-like. This is a proxy for shank angle at
footstrike, not a direct measurement of foot-ground angle, and SHALL be hard-gated to side view —
`viewFitTable.footStrikePattern` (`front: 'unsuitable'`, `ambiguous: 'unsuitable'`) — for the same
reason as trunk lean and overstriding: the fore-aft ankle-knee separation this proxy depends on is
not visible from a front-facing camera, and what a front view sees instead (mediolateral offset)
is a different physical quantity that could coincidentally look like a confident, wrong reading.

#### Scenario: Ankle notably ahead of the knee at footstrike reads as heel

- **WHEN** foot strike pattern is computed against a side-view clip where, at each detected
  footstrike, the ankle sits more than `footStrikeMidfootBandRatio` of torso length ahead of the
  same-side knee in the direction of travel
- **THEN** the returned `value` (the signed ankle-relative-to-knee offset ratio) is positive and
  classifies as heel-like

#### Scenario: Ankle roughly under the knee at footstrike reads as midfoot

- **WHEN** foot strike pattern is computed against a side-view clip where, at each detected
  footstrike, the ankle sits within `footStrikeMidfootBandRatio` of torso length of the same-side
  knee (either direction) in the direction of travel
- **THEN** the returned `value` classifies as midfoot-like

#### Scenario: Ankle notably behind the knee at footstrike reads as forefoot

- **WHEN** foot strike pattern is computed against a side-view clip where, at each detected
  footstrike, the ankle sits more than `footStrikeMidfootBandRatio` of torso length behind the
  same-side knee in the direction of travel
- **THEN** the returned `value` is negative and classifies as forefoot-like

#### Scenario: Front-view foot strike pattern is computed, not withheld

- **WHEN** foot strike pattern is computed against a `'front'`-classified clip with detectable
  footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the view is unsuitable

#### Scenario: Too few footstrikes to classify

- **WHEN** foot strike pattern is computed against a clip where no footstrikes (or no footstrikes
  with a resolvable same-side knee position) can be detected
- **THEN** `value` is `null`, `confidence` is `0`, `sampleSize` is `0`, and a non-null `caveat` is
  returned, without throwing

### Requirement: Foot strike pattern's caveat is unconditionally non-null

Unlike every other metric in `form-heuristics`, where `caveat` is populated only for
degraded/low-confidence results, foot strike pattern's `caveat` SHALL be non-null on **every**
returned result, including its cleanest, highest-confidence one, stating plainly that the value is
an approximation derived from ankle position relative to the knee and not a direct measurement of
foot-ground angle. This reflects that the metric is fundamentally a proxy in every case, not only
when input quality is poor — a high `confidence` score means the ankle-knee offset was measured
cleanly, not that the resulting heel/midfoot/forefoot read is a validated classification.

#### Scenario: Clean, high-confidence result still carries the proxy caveat

- **WHEN** foot strike pattern is computed against a clean, high-coverage, side-view clip with a
  well-resolved sample of footstrikes (no view, sample-size, or travel-direction degradation)
- **THEN** the returned `confidence` is high and `value` is non-null, AND `caveat` is still
  non-null, stating that the result is an ankle-relative-to-knee approximation rather than a
  direct foot-angle measurement

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

