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

### Requirement: Stride length is derived from same-side consecutive footstrike pairs

The system SHALL estimate stride length, in pixels, as the median of same-side consecutive-
footstrike-pair hip-mid horizontal displacement — reusing `estimateBodyScale`,
`estimateTravelDirection`, and `detectFootstrikes` as-is, without reimplementing footstrike
detection or body-scale estimation. For each side's consecutive footstrike pair, displacement
SHALL be signed by the clip's travel direction and kept only when positive (advancing in the
direction of travel); a pair whose signed displacement is zero or negative SHALL be dropped rather
than counted, and the system SHALL NOT re-pair across a dropped footstrike (e.g. pairing strike
`k` with strike `k+2` when `k+1` is dropped), since doing so would silently double the measured
interval.

#### Scenario: A clean side-view clip yields a stride length close to the true per-stride
displacement

- **WHEN** stride length is estimated against a `'side'`-view clip with a clean, detectable
  footstrike rhythm and known travel direction
- **THEN** the returned `strideLengthPx` is close to the true horizontal distance traveled per
  stride, `pairCount` is at least 3, and `pairCount` equals `candidatePairCount` when every
  consecutive pair resolved and advanced

#### Scenario: Too few footstrikes to form any consecutive pair

- **WHEN** fewer than two footstrikes are detected on every side (so no side has a consecutive
  pair to measure)
- **THEN** the result is not-ok with reason `'too-few-footstrikes'`

#### Scenario: No resolvable body-scale reference at all

- **WHEN** stride length is estimated against frames with no resolvable shoulder/hip position
  anywhere in the clip
- **THEN** the result is not-ok with reason `'no-body-scale'`

#### Scenario: Empty input never throws

- **WHEN** stride length is estimated against an empty frame list
- **THEN** the result is not-ok (reason `'no-body-scale'`) without throwing

### Requirement: Stride length requires a known direction of travel

The system SHALL check `estimateTravelDirection` before attempting footstrike-pair extraction, and
SHALL report a stride-length result of not-ok with reason `'travel-direction-unknown'` whenever
travel direction is indeterminate (`estimateTravelDirection` returns `0`) — regardless of whether
footstrikes are otherwise detectable — since a footstrike-pair displacement without a known sign
convention cannot be filtered into advancing/non-advancing pairs, and every resulting pair would
be meaningless even if footstrike detection itself succeeded.

#### Scenario: An approach/front-on clip with no net horizontal displacement

- **WHEN** stride length is estimated against a clip where `estimateTravelDirection` returns `0`
  (e.g. a runner approaching the camera head-on, or in-place footage)
- **THEN** the result is not-ok with reason `'travel-direction-unknown'`, checked ahead of, and
  regardless of, footstrike detectability

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
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names the measured fit quality (or
  failure reason)

#### Scenario: Degenerate zero bounce reports no value ahead of the stride-length check

- **WHEN** the hip-bounce fit succeeds but its amplitude is degenerate (no measurable vertical
  motion), even if stride length would otherwise be computable
- **THEN** the numerator gate is evaluated first and `value` is `null` with a caveat describing the
  degenerate bounce, not a stride-length-shaped caveat

### Requirement: Vertical ratio is hard-gated to side view

The system SHALL still compute and return a value for vertical ratio when the detected view is
`'front'` or `'ambiguous'` and both the hip-bounce fit and stride length happen to resolve — never
substituting `null` purely because the view is unsuitable — while applying
`viewFitTable.verticalRatio`'s low multipliers (`front: 0.1`, `ambiguous: 0.2`) and attaching a
caveat stating the view is unsuitable, since stride length is a fore-aft (sagittal) displacement
that foreshortens toward zero away from a side-on camera angle, which would otherwise inflate the
ratio (a shrunk denominator) rather than merely add noise to it.

#### Scenario: A front-view clip that happens to have resolvable stride length is discounted, not
withheld

- **WHEN** vertical ratio is computed against a `'front'`-classified clip where
  `estimateTravelDirection` nonetheless returns a direction (e.g. a runner crossing the frame at a
  shallow angle) and a stride length resolves
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'` and confidence discounted by
  the `0.1` multiplier, with a caveat stating the view is unsuitable

#### Scenario: An ambiguous-view clip is discounted more gently than a confidently-front one

- **WHEN** vertical ratio is computed against an `'ambiguous'`-classified clip with an otherwise
  resolvable value
- **THEN** `viewFit` is `'unsuitable'` and confidence is discounted by the `0.2` multiplier, not the
  `0.1` front-view multiplier

### Requirement: Vertical ratio participates in the shared orchestration and output contract

The system SHALL include vertical ratio in `computeFormHeuristics`'s result
(`FormHeuristicsResult.verticalRatio`), positioned immediately after `verticalOscillation` in
`MetricId` and every enumeration of it, computed under the same once-per-clip detected view as
every other metric, and SHALL follow the same output contract every other metric follows: `value`
a finite number or `null` (never `NaN` or `Infinity`), `confidence` in `[0, 1]` forced to `0` when
`value` is `null`, and no exception for any well-typed `RobustPoseFrame[]` input including an
empty array.

#### Scenario: computeFormHeuristics includes vertical ratio gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `verticalRatio.viewFit` reflects the same `view.view` label present in the
  same result as every other metric

#### Scenario: Empty frame list produces a well-formed vertical-ratio result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `verticalRatio.value` is `null` and `verticalRatio.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** vertical ratio is computed against any combination of empty frames, a clip with zero
  bounce amplitude, a clip with indeterminate travel direction, or a clip with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`

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

