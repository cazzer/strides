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

A threshold SHALL be clearable by a clip filmed dead-on for the view it admits, for every plausible
adult body build. In particular `frontViewMinBilateralSpreadRatio` SHALL sit below the bilateral
spread ratio a dead-on front view produces for the narrowest such build, so that no runner is
classified `'ambiguous'` on account of their proportions at a camera angle that would classify a
differently-built runner `'front'`.

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

#### Scenario: A narrow-built runner filmed dead-on is classified front

- **WHEN** a runner whose shoulder and hip-joint-centre separations sit at the narrow end of the
  adult range is filmed square-on, so BSR reads the lowest value a dead-on front view can produce
- **THEN** BSR still clears `frontViewMinBilateralSpreadRatio` and the clip is classified `'front'`

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
signal sits from its decision threshold and by body-scale sample coverage; an `'ambiguous'` label
from signal disagreement (as opposed to insufficient coverage) SHALL use a flat, coverage-scaled
confidence rather than a per-signal margin, since no principled margin exists when the signals
disagree.

Each per-signal margin SHALL run from that signal's decision threshold for the committed view (0)
to the value that signal takes with the camera positioned dead-on for that view (1), clamped either
side. That full-support value SHALL be a property of the signal's own physical range — an exact
projection limit where one exists, otherwise an anatomical measurement — and SHALL NOT be derived
as a multiple of the threshold.

Consequently `confidence` SHALL be comparable across labels: a clip sitting on its own decision
boundary reads 0 and a clip filmed dead-on for its label reads its coverage, whichever label it
carries. No label may be structurally capped below any other.

#### Scenario: Deep in-band signals yield high confidence

- **WHEN** both BSR and SER sit well clear of their respective thresholds for the committed view,
  and body-scale coverage is high
- **THEN** the returned confidence is correspondingly high (close to the coverage value)

#### Scenario: Ambiguous-by-disagreement uses a flat confidence

- **WHEN** the view is `'ambiguous'` because the two signals disagree (not because of insufficient
  coverage)
- **THEN** confidence is `0.3 * bodyScale.sampleCoverage`

#### Scenario: A dead-on front clip and a dead-on side clip score the same

- **WHEN** one clip's signals read what a dead-on front view produces and another's read what a
  dead-on side view produces, both at full body-scale coverage
- **THEN** both report a confidence of 1, rather than one label being capped below the other by a
  full-support value its signal cannot reach

#### Scenario: A signal's full-support value lies inside its own reachable range

- **WHEN** a margin's full-support value is compared against what its signal can physically produce
- **THEN** it lies within that range — for the front view's bilateral spread ratio, inside the
  band a dead-on front view yields across adult body builds; for the side view's sagittal excursion
  ratio, at or below the excursion a running stride reaches — and is not a multiple of the
  threshold that would place it outside

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
  `overstriding.viewFit` all reflect the same resolved view (the one holding the most plausibility
  mass, which is that result's `view.view` label whenever the clip commits to a label) present in
  the same result

### Requirement: Cadence participates in the shared orchestration and output contract

The system SHALL include cadence in `computeFormHeuristics`'s result (`FormHeuristicsResult.cadence`),
computed under the same once-per-clip detected view as the other three metrics, and SHALL follow
the same output contract every other metric follows: `value` a finite number or `null` (never
`NaN`), `confidence` in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any
well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes cadence gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `cadence.viewFit` reflects the same resolved view (the one holding the
  most plausibility mass, which is that result's `view.view` label whenever the clip commits to a
  label) present in the same result as `verticalOscillation`, `trunkLean`, and `overstriding`

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
- **THEN** the returned result's `kneeFlexion.viewFit` reflects the same resolved view (the one
  holding the most plausibility mass, which is that result's `view.view` label whenever the clip
  commits to a label) present in the same result as the other three metrics

### Requirement: Arm swing symmetry compares per-side wrist-relative-to-shoulder swing amplitude

The system SHALL compute arm swing symmetry as `min(leftAmplitude, rightAmplitude) /
max(leftAmplitude, rightAmplitude)` — a `'percent'`-unit, 0-1 ratio where `1` means perfectly
symmetric swing and values approaching `0` mean one arm swings substantially more than the other.

Each side's amplitude SHALL be the PEAK-TO-PEAK amplitude of a spectral sinusoid fit of that side's
wrist-y position relative to its own shoulder-y, fitted independently per side over the same
frequency grid the other spectral-fit metrics use. The system SHALL NOT read the amplitude as an
aggregate of individually-detected peak-to-trough excursions: a prominence-thresholded extremum scan
confirms turning points between the real ones on ordinary tracking noise, so its aggregate is a
statistic over a mixture of half-swings and wiggle rather than over the swing.

The value SHALL be scale-free — the two amplitudes are measured in the same pixel space on the same
body, so the system SHALL NOT require a resolvable body-scale reference in order to report a ratio.

#### Scenario: Symmetric swing scores near 1

- **WHEN** both arms show comparable, matched vertical swing amplitude across the clip
- **THEN** the returned ratio is close to `1`

#### Scenario: Asymmetric swing scores lower than a matched symmetric case

- **WHEN** one arm's swing amplitude is substantially smaller than the other's, all else equal
- **THEN** the returned ratio is meaningfully lower than the ratio computed from an otherwise-
  identical symmetric case

#### Scenario: Amplitude survives a swing trace carrying a step-rate harmonic

- **WHEN** each arm's trace is its swing rhythm plus a smaller oscillation at twice that frequency
  (the step rhythm the shoulder itself carries) plus per-frame tracking jitter
- **THEN** each side's reported amplitude tracks the underlying swing amplitude, and the reported
  ratio tracks the underlying amplitude ratio

#### Scenario: A clip with no resolvable torso is still measured

- **WHEN** both shoulders and both wrists resolve across the clip but no body-scale reference
  (shoulder-to-hip torso segment) resolves in any frame
- **THEN** a non-null `value` is returned rather than `null`

### Requirement: Arm swing symmetry is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for arm swing symmetry
(`viewFitTable.armSwingSymmetry.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — the mirror image of trunk lean/overstriding's side-view-primary
gating — because a side view occludes or superimposes the far arm rather than because the swing
signal itself is invisible from the side. `'ambiguous'` SHALL also be treated as unsuitable
(`multiplier: 0.2`). The system SHALL still compute and return a value when the view is `'side'`
or `'ambiguous'`, never substituting `null` purely because the view is unsuitable.

View SHALL never be a reason to withhold a value, and measurement quality SHALL always be one,
independently and on every view: a clip whose swing rhythm cannot be fitted comparably on both arms
reports `null` whether it is front, side or ambiguous.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** arm swing symmetry is computed against a `'front'`-classified clip with resolvable,
  separable left/right wrist and shoulder positions
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** arm swing symmetry is computed against a `'side'`-classified clip with resolvable arm
  positions whose swing rhythm fits comparably on both arms
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat`

### Requirement: Arm swing symmetry follows the shared output contract

The system SHALL return a `MetricResult` for arm swing symmetry using the `'percent'` unit, with
`value: null` and `confidence: 0` whenever either arm has no resolvable shoulder/wrist position or
no complete swing cycle is detected in the clip, and SHALL NOT throw for any well-typed
`RobustPoseFrame[]` input, including an empty array.

A swing cycle SHALL count as detected on a side only when that side's spectral fit is well posed AND
its sinusoid partial R² reaches `armSwingMinFitR2`. Either side failing that is fatal to the whole
comparison, not merely to its own half of it: a fitted-noise amplitude on one arm publishes as a
fabricated ASYMMETRY rather than as a fuzzy number, which is a worse failure than reporting nothing.

#### Scenario: Insufficient data yields null, not a crash

- **WHEN** one or both arms have no resolvable shoulder/wrist position, or no complete swing cycle
  is detected on one or both sides
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** arm swing symmetry is computed against an empty `RobustPoseFrame[]`
- **THEN** it returns `value: null`, `confidence: 0`, without throwing

#### Scenario: One arm fits, the other is noise

- **WHEN** one arm's swing fits cleanly and the other arm's trace has no rhythm in it that reaches
  `armSwingMinFitR2`
- **THEN** `value` is `null` and `caveat` is non-null, rather than a ratio between a real amplitude
  and a noise amplitude

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
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` says in plain language that the
  bounce rhythm was too irregular to measure — or names the specific failure reason — without
  quoting the measured fit statistic or the configured threshold

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
- **THEN** the returned `verticalRatio.viewFit` reflects the same resolved view (the one holding
  the most plausibility mass, which is that result's `view.view` label whenever the clip commits
  to a label) present in the same result as every other metric

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
- **THEN** the returned `verticalOscillationCm.viewFit` reflects the same resolved view (the one
  holding the most plausibility mass, which is that result's `view.view` label whenever the clip
  commits to a label) present in the same result as every other metric

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

### Requirement: Step width reports the signed per-footstrike lateral offset from the hip midline

The system SHALL compute step width as the median, across all detected footstrikes, of each
footstrike's signed lateral offset of the landing ankle from the hip-midline, as a fraction of hip
width (`'percent'` unit). The sign SHALL be resolved per-footstrike from that same frame's own-side
hip position relative to hip-mid — `positive = landed on its own anatomical side, negative =
crossed to the opposite side` — never from a clip-wide constant (such as a `travelDirection`-style
signal, which resolves a different, fore-aft ambiguity and has no defined relationship to the
mediolateral axis this metric reads).

#### Scenario: A clean, own-side gait scores positive

- **WHEN** step width is computed against a clip where every footstrike lands on its own
  anatomical side of the hip midline
- **THEN** the returned value is positive

#### Scenario: A crossover gait scores negative

- **WHEN** step width is computed against a clip where footstrikes cross the body's midline toward
  or past the opposite side
- **THEN** the returned value is negative, and the result carries a non-null caveat naming the
  crossover pattern

#### Scenario: Naive unsigned combination is rejected as structurally incapable of reporting crossover

- **WHEN** per-footstrike lateral offsets are combined without per-footstrike sign correction
  (raw `ankle.x - hipMid.x`, taken as-is across both legs)
- **THEN** the combined result cancels toward zero for any symmetric gait regardless of stride
  width, and cannot report a negative (crossover) value even when one leg's footstrikes genuinely
  cross the midline — this is why the shipped implementation performs the per-footstrike sign
  correction described above rather than combining raw offsets directly

### Requirement: Step width is front/rear-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for step width
(`viewFitTable.stepWidth.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as unsuitable
(`multiplier: 0.1`) — mirroring `armSwingSymmetry`'s view-fit row, since a side-on camera looks
straight along the mediolateral axis step width measures, collapsing it toward a degenerate
reading. `'ambiguous'` SHALL also be treated as unsuitable (`multiplier: 0.2`). The system SHALL
still compute and return a value when the view is `'side'` or `'ambiguous'`, never substituting
`null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** step width is computed against a `'front'`-classified clip with resolvable footstrikes
  and hip positions
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** step width is computed against a `'side'`-classified clip with resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null caveat

### Requirement: Step width follows the shared output contract

The system SHALL return a `MetricResult` for step width using the `'percent'` unit, with `value:
null` and `confidence: 0` whenever there is no resolvable hip-width reference (left/right hip) or
no footstrikes can be detected in the clip, and SHALL NOT throw for any well-typed
`RobustPoseFrame[]` input, including an empty array.

#### Scenario: No hip-width reference yields null, not a crash

- **WHEN** left/right hip position never resolves anywhere in the clip
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: No footstrikes yields null, not a crash

- **WHEN** hip position resolves but no footstrikes are detected in the clip
- **THEN** `value` is `null`, `confidence` is `0`, `caveat` is non-null, and no exception is thrown

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** step width is computed against an empty `RobustPoseFrame[]`
- **THEN** it returns `value: null`, `confidence: 0`, without throwing

### Requirement: Step width in centimetres is a metric gated on measured real-world scale

The system SHALL expose step width in centimetres as a `MetricId` (`stepWidthCm`), positioned last
in `MetricId` and every enumeration of it (after `footStrikePattern`). Its `value` SHALL be the
median, across footstrikes where a real-world scale was measured, of the signed ankle-x-minus-
hip-mid-x offset at that footstrike converted to centimetres via that same frame's
`pixelsPerMeter` — an instantaneous per-frame spatial ratio, never a value derived from
integrating or fitting a time series. `unit` SHALL be `'centimeters'`. When no frame in the clip
carries a measured real-world scale, the system SHALL check this FIRST, before attempting
footstrike detection, and report `value: null`, `confidence: 0`, and a caveat stating in plain
language that no real-world scale could be measured for this clip and pointing the reader to the
sibling pixel-ratio step-width metric that does not need one — naming no backend or model, the
same caveat regardless of whether the active backend has never measured scale or a scale-measuring
backend's per-frame measurement failed everywhere on this particular clip. When a real-world scale
WAS measured but no footstrikes could be detected in the clip at all, the system SHALL report
`value: null`, `confidence: 0`, and a distinct caveat stating that no footstrikes could be
detected — never conflating the two null-value causes into one message. When footstrikes ARE
detected but none of them has a resolvable hip position, ankle position, and usable scale
simultaneously, the system SHALL report a third, distinct caveat naming that. A footstrike
candidate whose frame lacks a usable scale (while other candidates' frames have one) SHALL be
excluded from that computation only, not treated as a whole-clip failure.

#### Scenario: A backend that doesn't measure scale reports an availability caveat

- **WHEN** `stepWidthCm` is computed against a clip where no frame's `pixelsPerMeter` is measured
- **THEN** `value` is `null`, `confidence` is `0`, `unit` is `'centimeters'`, and `caveat` states
  that no real-world scale could be measured for this clip — naming no backend or model — without
  throwing, and this check happens before footstrike detection is even attempted

#### Scenario: An empty frame list is indistinguishable from a scale-less backend

- **WHEN** `stepWidthCm` is computed against an empty frame list
- **THEN** the result is identical in shape to the scale-less-backend case: `value: null`,
  `confidence: 0`, without throwing

#### Scenario: A measured scale with no detectable footstrikes reports a distinct caveat

- **WHEN** `stepWidthCm` is computed against a clip where at least one frame carries a measured
  scale, but no footstrikes are detected anywhere in the clip
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` states that no footstrikes could be
  detected — distinct in wording from the no-scale-measured caveat

#### Scenario: Footstrikes with no usable scale at that instant are excluded, not fatal

- **WHEN** `stepWidthCm` is computed against a clip where some footstrike candidates' frames carry
  a measured scale and others do not
- **THEN** `value` is the median computed over only the footstrikes whose frame carried a usable
  scale (and a resolvable hip and ankle position), `frameCoverage` reflects that fraction, and the
  excluded candidates do not prevent a value from being reported

#### Scenario: A measured, resolvable clip reports a value with sane sample size

- **WHEN** `stepWidthCm` is computed against a clip with a measured real-world scale and multiple
  detectable footstrikes with resolvable hip and ankle positions
- **THEN** `value` is a finite number, `sampleSize` equals the count of footstrikes that
  contributed to the median, and `confidence` reflects view fit, coverage, interpolation, and
  sample-size-versus-minimum factors — with no separate scale-coverage confidence factor, since a
  missing scale at a footstrike is already priced into `frameCoverage` by the exclusion above

### Requirement: Step width in centimetres is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for step width in centimetres
(`viewFitTable.stepWidthCm.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — mirroring `armSwingSymmetry`'s identical front-primary/
side-unsuitable gating exactly, not merely similarly — because a side-on camera collapses the
mediolateral (side-to-side) offset this metric measures onto the same image axis the hip already
occupies, producing a confidently-wrong small number rather than an obviously-degraded one.
`'ambiguous'` SHALL also be treated as unsuitable (`multiplier: 0.2`). The system SHALL still
compute and return a value when the view is `'side'` or `'ambiguous'` and a scale-and-footstrikes
value would otherwise resolve, never substituting `null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** step width in centimetres is computed against a `'front'`-classified clip with a
  measured scale and resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** step width in centimetres is computed against a `'side'`-classified clip with a
  measured scale and resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the view is unsuitable

### Requirement: Step width in centimetres participates in the shared orchestration and output contract

The system SHALL include step width in centimetres in `computeFormHeuristics`'s result
(`FormHeuristicsResult.stepWidthCm`), positioned last — appended after `footStrikePattern` rather
than inserted elsewhere, matching `MetricId`'s own declaration order — computed under the same
once-per-clip detected view as every other metric, and SHALL follow the same output contract every
other metric follows: `value` a finite number or `null` (never `NaN` or `Infinity`), `confidence`
in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any well-typed
`RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes step width in centimetres gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `stepWidthCm.viewFit` reflects the same resolved view (the one holding the
  most plausibility mass, which is that result's `view.view` label whenever the clip commits to a
  label) present in the same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `stepWidthCm.value` is `null` and `stepWidthCm.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** step width in centimetres is computed against any combination of empty frames, a clip
  with no measured scale, a clip with a measured scale but no detectable footstrikes, or a clip
  with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`

### Requirement: Metrics emit exemplar instants as timestamps, never frame indices

Every metric SHALL be able to report, alongside its existing `MetricResult` fields, an optional
`exemplars` list naming the specific instants in the clip that produced its result. Each exemplar
SHALL identify its instant(s) **only** by `timestamp` — seconds on the clip's own media clock, the
same clock `RobustPoseFrame.timestamp` carries — and SHALL carry a second, optional
`pairedTimestamp` when the exemplar depicts a two-instant range. The exemplar type SHALL NOT
contain a frame-index field of any kind.

The reason is a boundary that is invisible at the call site: metrics are computed over the
**presence-trimmed** frame array while the rest of the application holds the **untrimmed** array, so
an index produced by a metric does not address the array its consumer holds — off by exactly the
number of frames the presence trim removed, which is zero on a clip where the subject is present
from the first frame and non-zero on precisely the clips this evidence is most useful for. Because
the presence trim returns a slice of the *same* frame objects, timestamps are valid on both sides of
that boundary and indices are not.

An exemplar SHALL additionally carry: a `quality` score in `[0, 1]` (see "Exemplar instants are
ranked and gated by a per-instance quality score"), a `kind` discriminating what the instant depicts,
a `side` where the metric is per-side and **both** instants share that side, a short human-readable
`label` for captioning, and the `cropKeypoints` — the keypoint names whose positions define the
region of the frame this exemplar is about. `cropKeypoints` SHALL be named by the metric that emitted
the exemplar, not re-derived downstream from the `MetricId`, so that knowledge of what a metric
measured lives only in the module that measures it.

A metric whose exemplar pairs two instants that need **not** share a side SHALL additionally state
the side each instant's own measurement was about, per instant. `side` cannot express this: it is a
pair-level claim, present only when both instants share a side, so on a deliberately opposite-side
pair it is absent — and with it goes any way for a consumer to know which limb each half of the
evidence was measured from. Two metrics are in this position, and for both the mixed pair is the
common case rather than an edge: step width constructs its pair from adjacent **opposite-foot**
strikes, and overstriding pairs a far-reaching strike with a close-landing one — one drawn from
each end of its range, where each end is filled by the best-scoring surviving candidate at that
end and extremeness is only a tie-break — which nothing constrains to one foot.

That per-instant side SHALL be **stated by the metric that took the measurement**, and a consumer
SHALL NOT infer it from the order of `cropKeypoints`. The measured limb's keypoint does happen to be
ordered first in both metrics' crop sets, but that ordering is a private consequence of how those two
modules concatenate their per-instant seeds, is not part of this contract, and would invert silently
if either module reordered a seed. An instant whose side no metric stated SHALL be represented as an
explicit absence rather than defaulted to a side: a mark anchored on a guessed limb is a confident
picture of a measurement nobody took.

A metric SHALL emit **at most two** exemplars, ranked by `quality` descending, where a two-instant
ghosted pair counts as one exemplar. A metric with no instant clearing the gate SHALL omit the field
entirely rather than emitting a low-quality exemplar.

Emitting exemplars SHALL NOT change any metric's `value`, `confidence`, `viewFit`,
`interpolatedFraction`, `frameCoverage`, `sampleSize`, or `caveat`.

#### Scenario: An exemplar addresses its instant by timestamp across the presence-trim boundary

- **WHEN** a metric emits an exemplar on a clip whose presence window is strictly narrower than the
  full clip
- **THEN** resolving that exemplar's `timestamp` against the **untrimmed** frame array finds the same
  frame object the metric itself saw in the **trimmed** array

#### Scenario: A metric emits at most two exemplars, ranked

- **WHEN** a metric has more qualifying instants than the per-metric budget
- **THEN** it emits exactly two, and they are the two highest-`quality` qualifying instants

#### Scenario: A metric with no qualifying instant omits the field

- **WHEN** every candidate instant for a metric fails the quality gate
- **THEN** that metric's result carries no `exemplars` field at all, rather than an empty or
  low-quality one, and every other field of its result is unchanged

#### Scenario: Exemplars never move a number

- **WHEN** a metric is computed over any frame sequence, with and without exemplar emission
- **THEN** its `value`, `confidence`, `viewFit`, `interpolatedFraction`, `frameCoverage`,
  `sampleSize`, and `caveat` are identical

#### Scenario: A single-instant exemplar is expressible without a null second instant

- **WHEN** a metric's evidence exists only at one moment (a footstrike), so no honest second instant
  exists
- **THEN** the exemplar carries no `pairedTimestamp` at all, rather than a null one that would read
  as a missing half of a pair

#### Scenario: An opposite-side pair states each instant's own side

- **WHEN** a metric emits a paired exemplar whose two instants were measured on different sides of
  the body — step width's constructed opposite-foot pair, or an overstride range whose two extreme
  strikes fall on different feet
- **THEN** the exemplar carries no single pair-level `side`, and each instant separately names the
  side its own measurement was taken on, so the two differ

#### Scenario: A per-instant side is never inferred from keypoint ordering

- **WHEN** a consumer needs to know which side one instant of an exemplar was measured on
- **THEN** it reads only what the metric stated — falling back to the pair-level `side`, whose own
  contract covers both instants whenever it is present — and an exemplar with neither resolves to an
  explicit absence, even where `cropKeypoints` happens to lead with one side's keypoint

### Requirement: Exemplar instants are ranked and gated by a per-instance quality score

The system SHALL compute, for each candidate exemplar instant, a `quality` score in `[0, 1]` built
**only** from signals already present in the pipeline: whether the metric's own input points at that
instant resolved as `'detected'` rather than `'interpolated'`, and how far that instant's own
measured value sits from the metric's own median. It SHALL NOT be built from `RobustKeypoint.score`:
an interpolated keypoint carries a lerp of its neighbours' scores and reads misleadingly confident,
which is why the robustness layer's contract directs consumers to gate on `status` rather than
`score`.

The distance-from-median term SHALL be **role-dependent**. For an exemplar whose purpose is to show
what the reported number looks like, closeness to the median SHALL raise the score. For an exemplar
whose purpose is to show one end of the range the metric measured, distance from the median SHALL
raise the score instead — because for such a metric the extreme instant *is* the evidence, and
penalising it would gate out exactly the instant the exemplar exists to show. Where there is no
distribution to judge against — a degenerate spread, or too few instances — the term SHALL fall back
to a neutral value rather than assert a confidence the data cannot support.

An instant SHALL be rejected outright, without a score, when: no keypoint defining its crop region
resolves at that frame, leaving no position to crop around — a partly-resolvable region SHALL NOT be
rejected, since the crop is derived from the resolvable subset; or, for a range-showing exemplar, its value lies beyond a
robust outlier bound about the median — so that a tracking glitch can never be selected as an
extreme; or the metric's own per-instance degenerate fallback fired at that instant; or the instant
does not resolve to a sampled frame within a snapping tolerance derived from the clip's own sampling
interval.

Surviving instants SHALL be kept only above a single shared minimum-quality threshold. That
threshold is a judgment call rather than a derived constant, and is single-sourced so that
per-metric drift is impossible.

#### Scenario: An interpolated instant ranks below an equivalent detected one

- **WHEN** two candidate instants have equal distance from the metric's median, but one resolved its
  input points as `'detected'` and the other as `'interpolated'`
- **THEN** the detected instant scores higher and is preferred

#### Scenario: A range-showing exemplar prefers the extreme, not the typical

- **WHEN** a metric whose exemplar depicts the two ends of a measured range ranks its candidates
- **THEN** an instant far from the median scores **higher** than one near it, the inverse of the
  ranking a value-representative exemplar uses

#### Scenario: An outlier is rejected rather than selected as the extreme

- **WHEN** the single most extreme instant for a range-showing metric lies beyond the robust outlier
  bound about the median
- **THEN** it is rejected outright and the most extreme *surviving* instant is used instead

#### Scenario: A degenerate per-instance fallback disqualifies an instant

- **WHEN** a metric's per-instance computation fell back to an invented value at some instant (for
  example a step-width strike whose outward polarity could not be determined and defaulted)
- **THEN** that instant is never ranked and never emitted, regardless of what its score would have
  been

#### Scenario: Too few instances leaves the ranking neutral rather than confident

- **WHEN** a metric has too few candidate instants, or a degenerate spread, for a median-relative
  term to mean anything
- **THEN** the score falls back to a neutral value rather than treating an arbitrary instant as
  highly typical or highly extreme

### Requirement: The spectral sinusoid fit exposes its phase and time origin

`fitSpectralSinusoid` SHALL report, on a successful fit, the fitted sinusoid's phase and the time
origin the fit was centred on, in addition to the amplitude, frequency and quality figures it
reports today. Together with the winning frequency these SHALL be sufficient for a consumer to
compute the fitted waveform's maxima and minima in clip time, without re-fitting and without access
to the fit's internal coefficients.

Consumers SHALL derive bounce instants **from the fitted phase**, never by scanning the raw signal
for its largest and smallest samples. The fit deliberately removes a quadratic trend, and the raw
extremes are the jittery quantity the spectral estimator replaced — a scanned extreme would name an
instant that contradicts the amplitude the same metric reports.

A derived instant SHALL be snapped to an actual sampled frame before it is emitted, and SHALL be
rejected when no sampled frame lies within the snapping tolerance: the fitted waveform is continuous
and the clip is not.

Because more than one metric reads this primitive, exposing these fields SHALL NOT change
`peakToPeakAmplitude`, the winning frequency, either R² figure, the second-peak ratio, the sample
count, the span, or the observed-cycle count for any input.

#### Scenario: Bounce peak and trough are derivable from the reported fit

- **WHEN** a fit succeeds
- **THEN** its reported frequency, phase and time origin are together sufficient to compute the
  instants of the fitted waveform's maxima and minima in clip time

#### Scenario: Every existing fit output is unchanged

- **WHEN** the same input is fitted before and after this addition
- **THEN** the amplitude, frequency, both R² figures, the second-peak ratio, sample count, span, and
  observed cycles are all identical

#### Scenario: A derived instant with no nearby sampled frame is rejected

- **WHEN** a phase-derived peak or trough falls in a gap where the clip has no sampled frame within
  the snapping tolerance
- **THEN** that instant, and any pair depending on it, is not emitted

#### Scenario: The direction of a bounce instant follows the fitted series' own sign convention

- **WHEN** two bounce fits are computed over series with opposite vertical sign conventions — one
  over downward-positive image coordinates, one over upward-positive integrated displacement
- **THEN** each fit's instants are labelled by what the runner's body actually did (highest point,
  lowest point) rather than by whether the fitted waveform was at a maximum or a minimum

### Requirement: Cadence reports no exemplar instants

The cadence metric SHALL NOT emit exemplars, and SHALL NOT borrow another metric's.

A cadence is a rate — a property of a sequence, not of any pair of instants. Two stills of a bounce
peak and trough depict the bounce's *amplitude*, which is what the vertical-oscillation metric
reports and what cadence does not; presenting the same imagery under the cadence readout would
assert an explanation that is not true of that number. Footstrike instants are equally unavailable as
a substitute, on a factual rather than an aesthetic basis: cadence is derived from the hip-bounce
spectral fit and does not read footstrikes at all, so footstrike frames did not produce its value.

Cadence therefore falls back to the same text-only presentation it has today, which is a supported
state for any metric with no qualifying instant.

#### Scenario: Cadence emits nothing even when its underlying fit succeeds

- **WHEN** cadence reports a non-null value from a high-quality hip-bounce fit — a fit from which
  bounce instants are perfectly derivable
- **THEN** the cadence result carries no `exemplars` field

### Requirement: A range exemplar's ends are the best-scoring candidate on each side of the median

For an exemplar that depicts the two ends of a measured range, the system SHALL choose each end by
**ranking every surviving candidate instant by the quality score that instant would itself receive**
and taking the best-scoring one. It SHALL NOT choose an end by its raw measured value and score that
choice afterwards. Scoring a decision already made is not ranking: it can only ever confirm or
discard one candidate, so a single badly-tracked instant sitting at the value extreme takes the whole
pair to zero — `pairQuality` is a minimum — and gates out a metric that had many well-tracked
candidates the ranking never reached.

The pair SHALL still depict a **range**: one end SHALL be drawn from the candidates whose value sits
at or above the metric's own median and the other from those at or below it. Quality is
sign-blind — an extreme instant's typicality term reads distance from the median, not direction — so
an unconstrained ranking could return two instants from the same end of the distribution, and a ghost
of two near-identical instants depicts no range at all.

Where the candidates are equally well tracked, this SHALL reduce to the most extreme surviving
instant at each end, because among survivors the typicality term rises strictly with distance from
the median. Ranking by quality therefore never narrows the depicted range without a tracking reason
for it, and the existing rule that an outlier is rejected outright in favour of the most extreme
*surviving* instant continues to hold on such a clip.

A pair whose two ends resolve to the same instant, or to two instants with the same measured value,
SHALL emit nothing rather than ghost a frame against itself.

Ranking SHALL be applied **after** the hard rejects, not instead of them: an instant with no
derivable crop, or beyond the robust outlier bound, is ineligible rather than merely low-ranked, so
ranking can never promote a tracking glitch into the picture.

#### Scenario: A well-tracked near-extreme instant outranks an untracked value-extreme one

- **WHEN** the instant with the most extreme surviving value resolved every one of the metric's input
  keypoints as `'interpolated'`, while a slightly less extreme instant resolved them as `'detected'`
- **THEN** the less extreme, well-tracked instant is selected as that end of the range, and the
  exemplar is emitted rather than gated out by the fully interpolated instant's zero score

#### Scenario: Ranking still spans the median

- **WHEN** the highest-scoring candidates overall both sit on the same side of the metric's median
- **THEN** the emitted pair still takes one end from each side of the median, so the image depicts a
  range rather than two views of the same end

#### Scenario: Uniformly tracked candidates select the value extremes

- **WHEN** every surviving candidate resolved its metric's input keypoints identically, so they
  differ only in how far their values sit from the median
- **THEN** the selected ends are the most extreme surviving instants — the same pair a
  rank-by-value rule would have chosen

### Requirement: Stride pairs are validated against the fitted step period before contributing

The system SHALL accept an optional fitted **step frequency** reference when estimating stride
length, and — when one is supplied — SHALL reject any same-side consecutive-footstrike pair whose
elapsed time is not consistent with a single stride at that step frequency, before that pair's
displacement contributes to the reported stride length.

The expected stride period SHALL be `2 / stepFrequencyHz`, derived from the definition of a gait
cycle (a stride is exactly two steps) and from the fitted hip-bounce frequency already being the
step frequency — the same identity `cadence` relies on when it reports `frequencyHz × 60` steps per
minute. No fitted, tuned, or per-clip coefficient SHALL enter that derivation.

A pair SHALL be accepted when the ratio of its elapsed time to the expected stride period lies
within a log-symmetric tolerance band — that is, within `[1 / (1 + tolerance), 1 + tolerance]` —
and rejected otherwise. The band SHALL be symmetric in the logarithm rather than additively,
because the errors it exists to reject are multiplicative (about half a stride when a spurious extra
strike is detected, about double when a real one is missed). The tolerance SHALL be derived from
stride-to-stride biological variability, footstrike-instant sampling quantization, and the fitted
frequency's own resolution and estimation error — never chosen to make any particular clip produce
any particular value — and SHALL be small enough that neither the half-stride nor the double-stride
multiplicity falls inside the band.

The system SHALL apply this check before the existing hip-resolution and advancing-displacement
checks, so that a pair which is not a stride is accounted for as such rather than as a pair that
could not be read.

The system SHALL report the number of pairs rejected by this check as a distinct field on a
successful stride-length result, separate from the pre-existing pairing-opportunity and kept-pair
counts, such that kept pairs plus period-rejected pairs never exceed the pairing-opportunity count.

When no step-frequency reference is supplied, or the supplied value is not a finite positive
number, the system SHALL skip this check entirely and SHALL produce exactly the result it produced
before this requirement existed, with a period-rejected count of zero.

#### Scenario: A pair spanning one full stride at the fitted step frequency is kept

- **WHEN** stride length is estimated with a step-frequency reference, and a same-side consecutive
  footstrike pair's elapsed time is close to `2 / stepFrequencyHz`
- **THEN** the pair contributes its displacement to the reported stride length, and the
  period-rejected count does not include it

#### Scenario: A pair spanning about half a stride is rejected

- **WHEN** stride length is estimated with a step-frequency reference, and a same-side consecutive
  footstrike pair's elapsed time is about half the expected stride period — the signature of a
  spurious extra strike instant detected mid-stance on the trailing leg
- **THEN** that pair's displacement does not contribute to the reported stride length, and the
  period-rejected count includes it

#### Scenario: A pair spanning about two strides is rejected

- **WHEN** a same-side consecutive footstrike pair's elapsed time is about twice the expected stride
  period — the signature of a missed footstrike
- **THEN** that pair's displacement does not contribute to the reported stride length, and the
  period-rejected count includes it, rather than being left to the median to outvote

#### Scenario: No step-frequency reference leaves behaviour unchanged

- **WHEN** stride length is estimated without a step-frequency reference, or with one that is not a
  finite positive number
- **THEN** no pair is rejected on timing grounds, the period-rejected count is zero, and the
  returned stride length, kept-pair count, pairing-opportunity count and failure reason are
  identical to what the same frames produced before this requirement existed

#### Scenario: Every pair rejected on timing reports its own failure reason

- **WHEN** a step-frequency reference is supplied and every candidate same-side pair is rejected as
  period-inconsistent, so no pair survives
- **THEN** the result is not-ok with a reason distinguishing "no pair spanned a plausible stride"
  from the pre-existing "no pair advanced in the direction of travel", and that pre-existing reason
  is still what is reported when no pair was rejected on timing

### Requirement: Vertical ratio supplies the period reference and names timing rejections honestly

The system SHALL pass the hip-bounce fit's own frequency to the stride-length estimate as the
step-frequency reference, so that the metric's denominator is validated against the same fit its
numerator is measured from. The fit is already computed and quality-gated before stride length is
estimated, so no additional fit SHALL be performed for this purpose.

When the stride-length estimate fails because no pair was period-consistent, the system SHALL report
`value: null`, `confidence: 0`, and a caveat naming that specific cause — that no consecutive
same-side pair lasted a full stride at the rhythm measured in this clip, and that extra detected
strike instants are the likely reason — rather than a generic no-usable-pairs or unreadable-frames
message. Reporting no value with that caveat SHALL be preferred over reporting a value derived from
a denominator known to span less than one stride.

When some pairs were period-rejected but others survived, the system SHALL attach a caveat stating
how many pairs were excluded for not lasting a full stride, and SHALL NOT count those pairs in the
existing "couldn't be read cleanly" caveat — those pairs were read cleanly and were excluded for a
different, nameable reason.

#### Scenario: Period-inconsistent pairs withhold the value with a cause-naming caveat

- **WHEN** vertical ratio is computed against a clip with a fittable hip-bounce rhythm and a known
  travel direction, but every candidate same-side footstrike pair is period-inconsistent with the
  fitted step frequency
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names the timing mismatch and the
  likely extra strike instants, rather than reporting a value from a sub-stride denominator

#### Scenario: Surviving pairs report the exclusions separately from unreadable ones

- **WHEN** vertical ratio is computed against a clip where some candidate pairs are
  period-inconsistent and at least one is period-consistent and usable
- **THEN** a value is reported from the surviving pairs only, with a caveat stating how many pairs
  were excluded for not lasting a full stride, and the "couldn't be read cleanly" caveat counts only
  the pairs that failed for that other reason

### Requirement: Footstrikes are ground-contact onsets detected between the two ankles

When footstrike timing is not derived from the fitted hip-bounce phase — because the fit failed,
fell below cadence's fit-quality bar, or yielded no attributable instant — the system SHALL detect
footstrike candidates from each ankle's vertical position **relative to the opposite ankle**, not
from that ankle's raw screen position, and the instants it emits SHALL be ground-contact onsets —
the moment a foot arrives — rather than the frame within stance at which that ankle happened to read
lowest.

A single ankle's screen y carries both the leg's own configuration and the whole body's vertical
motion, which every keypoint shares. Differencing the two ankles removes that second term wherever
the two feet are in the same state, and in particular removes the airborne-versus-airborne component
and any common vertical camera motion. It does NOT remove it during single support, where one foot
is planted and the other is not — that residual is the subject of the next requirement, and the
system SHALL NOT attempt to suppress it by changing the prominence threshold. The system SHALL NOT
introduce a new configurable threshold, and SHALL NOT retune `footstrikeMinProminenceRatio` or
`footstrikeMinIntervalSeconds`: both SHALL be read exactly as they were, against the differenced
signal.

A candidate on the differenced signal SHALL additionally be rejected when the striking ankle sits
**above** the opposite ankle at that instant, since a foot cannot be planted while the other foot is
below it. This check SHALL have no tolerance parameter, and SHALL NOT be applied on the fallback
series described below, where the value being compared is a screen coordinate whose sign carries no
such meaning.

A frame in which either ankle is unresolvable SHALL be treated as a gap, on the same terms the
extremum scan already applies to a gap: runs either side of it are scanned independently and no
extremum is paired or smoothed across it. When the opposite ankle is resolvable in **no** frame of
the clip, there is no contralateral reference at all and the system SHALL fall back to that ankle's
raw vertical position, preserving the behaviour that predates this requirement for a single-leg
trace.

This detector SHALL NOT be retuned, offset, or otherwise adjusted in an attempt to correct its
phase. Its emitted instant is the contralateral foot's swing apex, which trails touchdown by an
amount set by the runner's own swing mechanics and spanning more than a whole stance phase across
ordinary runners; that is a property of the signal, and no constant offset can be correct for every
runner.

#### Scenario: A trailing leg's airborne ankle-y maximum is not a footstrike

- **GIVEN** a clip in which one leg's raw ankle-y series carries a prominence-confirmed maximum
  while that foot is in the air, during the other foot's stance, because the body was descending
  faster than the swinging foot was rising
- **WHEN** footstrikes are detected
- **THEN** that instant is not emitted as a footstrike candidate
- **AND** every true touchdown in the clip is still emitted, one per foot per stride, alternating
  feet

#### Scenario: A contact is reported at its onset, not at the end of its stance plateau

- **GIVEN** a clip in which a planted foot's raw ankle-y series is a flat plateau across stance, so
  that its argmax is decided by the extremum scan's tie handling rather than by the gait
- **WHEN** footstrikes are detected
- **THEN** the emitted instant for that contact is within a small, bounded number of sampled frames
  of the touchdown that begins the plateau, rather than at the plateau's late-stance end

#### Scenario: A clean signal with no secondary maxima is unaffected

- **GIVEN** a clip in which each ankle's raw vertical position already has exactly one
  prominence-confirmed maximum per stride, at that foot's own touchdown
- **WHEN** footstrikes are detected
- **THEN** the same set of contacts is emitted, one per foot per stride, alternating feet, each
  within a small, bounded number of sampled frames of its touchdown

#### Scenario: A footstrike is never attributed to the higher of the two feet

- **WHEN** footstrikes are detected on a clip where both ankles are resolvable
- **THEN** at every emitted candidate's frame, the striking side's ankle is at or below the opposite
  side's ankle

#### Scenario: A clip with only one resolvable ankle falls back to that ankle's own trace

- **GIVEN** a clip in which one side's ankle is unresolvable in every frame
- **WHEN** footstrikes are detected
- **THEN** the resolvable side is detected from its own raw vertical position, exactly as it was
  before this requirement
- **AND** no candidate is emitted for the unresolvable side

### Requirement: Footstrike candidates are selected by amplitude at the clip's own stride rhythm

When footstrikes are detected between the two ankles rather than from the fitted hip-bounce phase,
differencing the two ankles does not remove the whole body's vertical motion from the contact
series, and cannot: during single support the planted foot carries none of that motion and the
swinging foot carries all of it, so the term survives inverted and at full strength. The system
SHALL therefore treat prominence as deciding only whether a sample is a turning point, and SHALL
decide which turning points are ground contacts by a separate rule.

Among a side's admissible maxima the system SHALL accept candidates in **descending order of
contact-series value**, each accepted candidate excluding every remaining candidate within a
minimum spacing of it, and SHALL return the survivors in time order. Ties SHALL resolve toward the
earlier instant. This ordering SHALL be used because a ground contact sits at the full separation
between the two legs while the surviving body-motion artifacts are the size of the runner's own
vertical oscillation — a difference in amplitude, not in local prominence.

The minimum spacing SHALL be the longer of the configured minimum footstrike interval and the
shortest interval that could still be a single stride at the clip's own fitted step frequency,
namely `(2 / stepFrequencyHz) / (1 + tolerance)` using the same tolerance and the same
`2 / stepFrequencyHz` derivation the stride-pair period gate applies. Deriving it as that gate's
lower band edge SHALL be preserved rather than restated as an independent number, so that this
selection can never remove a same-side pair the period gate would have accepted.

The fitted step frequency SHALL be used only when it clears the same fit-quality bar cadence itself
requires before reporting a value; below that bar the system SHALL fall back to the configured
minimum footstrike interval alone, which is the behaviour that predates this requirement.

The system SHALL NOT rescale the prominence threshold to compensate for the differenced signal.

When footstrikes are timed from the fitted hip-bounce phase instead, this amplitude selection SHALL
NOT run, and the same-side spacing it enforces SHALL hold by construction: consecutive same-side
instants are two fitted bounce periods — one stride — apart.

#### Scenario: A body-motion artifact inside a stance is not emitted

- **GIVEN** a clip whose contact series carries more than one prominence-confirmed maximum within a
  single stance, the extra one arising from the body's vertical motion rather than from a foot
  arriving
- **WHEN** footstrikes are detected
- **THEN** the artifact is not emitted for that side
- **AND** the ground contact it sits inside is

#### Scenario: Two same-side candidates closer than one plausible stride cannot both be emitted

- **WHEN** footstrikes are detected on a clip whose step rhythm could be fitted
- **THEN** no two candidates on the same side are closer together than the shortest interval that
  could be a single stride at that rhythm

#### Scenario: A clip with no fittable step rhythm keeps the configured interval floor

- **GIVEN** a clip whose hip-bounce fit fails or falls below cadence's own fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** the minimum spacing between candidates is the configured minimum footstrike interval,
  exactly as it was before a rhythm-derived floor existed

### Requirement: A range exemplar offers ranked alternative pairs, not only its winner

A metric that emits a range exemplar SHALL emit, with it, the **lower-ranked pairs it did not
choose**, ordered by the same score that chose the winner. Whether a pair can actually be drawn as
one legible image depends on the subject's pixel geometry and on display constants that the
measurement layer does not hold and SHALL NOT acquire; the layer that does hold them therefore
receives a ranked list to walk rather than a single take-it-or-leave-it choice.

The first entry of that list SHALL be exactly the pair the metric would have emitted on its own, so
that adding alternatives cannot change which pair a clip renders when the winner is drawable.

Every alternative SHALL be a complete, independently renderable exemplar of the same kind, carrying
its own two instants, its own quality and its own crop keypoints — all of which genuinely differ per
pair. An alternative SHALL NOT itself carry alternatives: the list is one level deep, and a
consumer SHALL be able to stop reading after the entry it selects.

Alternatives SHALL be subject to the same emission gate as the winner. A pair scoring below the
minimum exemplar quality is not evidence merely because a better pair could not be drawn, and SHALL
NOT be offered as a fallback.

Offering alternatives SHALL NOT change how many images a metric may produce. The alternatives belong
to one exemplar and describe one image; the per-metric exemplar budget continues to count images.

#### Scenario: The winner is unchanged by the presence of alternatives

- **WHEN** a metric selects its range pair over a candidate set that yields several eligible pairs
- **THEN** the first pair offered is the same one the single-best selection returns for that same
  candidate set, with the same two instants, the same base/ghost order and the same quality

#### Scenario: Alternatives are ranked by the same score as the winner

- **WHEN** a metric offers alternative pairs
- **THEN** they are ordered by the quality each pair would itself be emitted with — the weaker of
  its two ends — highest first, and each still spans the metric's median with one end on each side

#### Scenario: An alternative below the emission gate is not offered

- **WHEN** the candidate set yields pairs whose quality falls below the minimum exemplar quality
- **THEN** those pairs are absent from the offered list, so a consumer walking it can never reach a
  pair that would have been gated out had it been chosen first

#### Scenario: A metric with no eligible pair offers nothing

- **WHEN** no pair spans the metric's median with two eligible ends, or every eligible pair depicts
  no range because its two ends share one measured value
- **THEN** the metric emits no range exemplar and no alternatives, exactly as before

### Requirement: The ranked pair search is bounded independently of the candidate count

The search that produces the ranked pair list SHALL be bounded by a fixed cap on how many ranked
ends it considers **on each side** of the median, and SHALL NOT evaluate the full cross product of
eligible instants. On this repository's own reference footage a single metric reaches roughly sixty
eligible instants, which is on the order of nine hundred pairs; the emitted list, and the number of
drawability tests a consumer can be made to run, SHALL NOT scale with that.

The bound SHALL be expressed per side rather than as a count of pairs. A pair is undrawable because
of where its ends sit, and a list of the best N *pairs* can be dominated by one unlucky end repeated
against many partners, whereas a per-side bound guarantees that many distinct alternatives exist for
each end.

Within the bound the ranking SHALL be exact: every pair formed from the retained ends is scored and
ordered, with no approximation of the ordering.

#### Scenario: A large candidate set yields a bounded list

- **WHEN** a metric's eligible instants number in the dozens, so the unbounded pair count is in the
  hundreds
- **THEN** the number of pairs offered is capped by the per-side bound and does not grow with the
  candidate count

#### Scenario: Both ends have distinct alternatives

- **WHEN** the winning pair is offered along with its alternatives
- **THEN** the list contains pairs that replace the first end while holding the second, and pairs
  that replace the second while holding the first, so neither end alone can exhaust the list

### Requirement: View detection reports how plausible each view is

The system SHALL return, alongside the committed view label and its confidence, a
`plausibility` distribution over `'side'`, `'front'` and `'ambiguous'` whose components are
non-negative and sum to 1, derived from the same two signals (BSR and SER) the label is derived
from and from the same configurable thresholds, with no additional tunable of its own.

Each signal SHALL contribute a support in `[0, 1]` for each committed view, equal to 1 once the
signal has cleared that view's own threshold, 0 once it has cleared the other view's threshold,
and interpolated across the band between them. A committed view's plausibility SHALL be the
product of the two signals' support for it, so that one signal alone can never carry a view, and
`'ambiguous'` SHALL take the remaining mass.

The distribution SHALL be one-hot on `'ambiguous'` whenever either signal is unavailable or
body-scale coverage is below `minViewDetectionFrameCoverage`.

#### Scenario: A clip that commits to a label is one-hot on that same label

- **WHEN** both signals sit inside one view's regions, so the clip is classified `'side'` or
  `'front'`
- **THEN** that view's plausibility is 1 and the other two are 0

#### Scenario: A signal in the undecided band splits mass with ambiguous

- **WHEN** one signal has cleared one view's threshold but the other signal sits between the two
  thresholds for its own measure
- **THEN** that view's plausibility is between 0 and 1, the opposite view's is 0, and `'ambiguous'`
  holds the remainder

#### Scenario: Disagreeing signals leave all the mass on ambiguous

- **WHEN** one signal fully supports `'side'` and the other fully supports `'front'`
- **THEN** both committed views have plausibility 0 and `'ambiguous'` has 1

#### Scenario: A missing signal or insufficient coverage supports no view

- **WHEN** no frames yield a usable BSR or SER sample, or body-scale coverage is below
  `minViewDetectionFrameCoverage`, or the frame list is empty
- **THEN** `plausibility` is `{ side: 0, front: 0, ambiguous: 1 }`

### Requirement: Metric view fit is resolved from view plausibility, not from the committed label

The system SHALL resolve each metric's view fit against the clip's `plausibility` before any
metric reads it: the applied confidence multiplier SHALL be the plausibility-weighted mean of that
metric's three `viewFitTable` rows, and the reported `viewFit` SHALL be the row of the view holding
the most plausibility mass, with `'ambiguous'` taking ties. Both SHALL be derived from the same
distribution, so that a metric can never be reported as structurally unmeasurable and another
metric granted full confidence on the strength of the same uncertain view classification.

`computeFormHeuristics` SHALL perform this resolution exactly once per clip and share it across
every metric. Where another requirement in this capability names a metric's per-view row values
(for example `side: 1.0`, `front: 0.85`, `ambiguous: 0.6`), those values are the endpoints of this
resolution: they are the multiplier applied whenever the clip commits to a view, and the values
blended otherwise.

Resolution SHALL NOT depend on body-scale sample coverage beyond the existing
`minViewDetectionFrameCoverage` gate, since every metric already factors its own frame coverage
into its confidence over the same frames.

#### Scenario: A committed view is gated exactly as its own row prescribes

- **WHEN** `computeFormHeuristics` runs on a clip classified `'side'` or `'front'`
- **THEN** every metric's `viewFit` and confidence multiplier are exactly that view's row from
  `viewFitTable`, identical to computing the metric directly against that view label

#### Scenario: A marginally-committed view is not degraded for being marginal

- **WHEN** a clip commits to a view because both signals cleared that view's thresholds, but one of
  them cleared its threshold only narrowly
- **THEN** that view's metrics are gated by its own row at full strength, because the opposite
  view's conditions are unmet and the narrowness of one margin is not evidence for the opposite
  view

#### Scenario: A metric measurable from the most plausible view is reported, not excluded

- **WHEN** one committed view has plausibility 0 and the other holds most of the remaining mass,
  so the label is `'ambiguous'`
- **THEN** a metric whose row for the plausible view is not `'unsuitable'` reports that fit rather
  than being excluded, with a multiplier between what the plausible view's row and the
  `'ambiguous'` row would each have given it alone

#### Scenario: A metric unsuitable from every plausible view stays excluded

- **WHEN** a metric's rows are `'unsuitable'` for every view carrying plausibility mass
- **THEN** its resolved `viewFit` is `'unsuitable'` and it remains excluded

#### Scenario: A genuinely ambiguous clip degrades in both directions

- **WHEN** both signals sit in their undecided bands, so `'ambiguous'` holds the most mass
- **THEN** side-primary and front-primary metrics alike resolve to their `'ambiguous'` rows' fit,
  neither direction favoured, while view-tolerant metrics continue to report

### Requirement: Arm swing symmetry rejects a comparison between two different rhythms

Both arms belong to one body and swing on one rhythm, so the system SHALL compare the two sides'
fitted frequencies to each other before taking any ratio between their amplitudes. When they
disagree by more than a bounded fraction of the lower of the two, the system SHALL report
`value: null` with a caveat naming the mismatch, rather than a ratio.

This check is not redundant with the per-side quality gate and SHALL NOT be replaced by tightening
it: two fits can each clear a per-side gate while describing different oscillations. Measured on
`e2e/fixtures/multiperson-track.mp4` (2026-08-29), the left arm fitted 1.48 Hz at R² 0.676 and the
right fitted 2.80 Hz at R² 0.324 — the right arm had found the STEP rhythm (cadence 174 spm =
2.90 Hz) rather than the stride rhythm, and the 0.349 ratio published between them compared two
different things.

#### Scenario: Two arms fitted on different rhythms report no ratio

- **WHEN** each arm's trace oscillates cleanly but at a materially different frequency from the
  other's
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names that the two swing rhythms did
  not match

#### Scenario: Two arms on the same rhythm are compared normally

- **WHEN** both arms' fitted frequencies agree to within the bound, whatever their amplitudes
- **THEN** a non-null `value` is returned

### Requirement: Arm swing symmetry's confidence reads the worse-measured arm, never an average

A symmetry comparison is only as trustworthy as its less-observed side, and averaging is
specifically wrong for this metric rather than merely imprecise: the case that must not read as
confident is one arm measured materially worse than the other, and that is exactly the case an
average hides — while also being the case most likely to produce an apparent asymmetry that belongs
to the footage rather than to the runner.

The system SHALL therefore derive every confidence input for arm swing symmetry from the WORSE of
the two arms: frame coverage, interpolated fraction, observed swing-cycle count, and a fit-quality
factor ramping on the weaker arm's sinusoid partial R². When the two arms' fit qualities differ
materially, the system SHALL additionally emit a caveat saying that one arm was tracked noticeably
better than the other and that part of the difference between them may be measurement rather than
form.

#### Scenario: Degrading one arm's tracking alone lowers confidence

- **WHEN** two otherwise-identical clips are compared, differing only in that one of them has
  materially noisier tracking on a single arm
- **THEN** the noisier clip's `confidence` is lower, and its `caveat` reports that one arm was
  tracked noticeably better than the other

#### Scenario: An arm measured worse than the other is not averaged away

- **WHEN** one arm fits well and the other fits poorly but still above `armSwingMinFitR2`
- **THEN** `confidence` reflects the poorly-fitting arm, not the mean of the two

### Requirement: Arm swing symmetry's exemplar pair spans one fitted half-swing

The system SHALL derive each side's ghosted exemplar pair from that side's fitted PHASE — the two
sampled frames nearest a fitted maximum and its adjacent fitted minimum — so the pair spans half a
fitted swing period by construction, and SHALL NOT select it by scanning the raw trace for extrema.
The picture is captioned as one swing, top against bottom, and a pair chosen off the raw trace
depicts drift and jitter that the reported amplitude explicitly excludes.

Because the fitted series is `wrist.y − shoulder.y` in image-y, which grows downward, the fitted
MAXIMUM is the wrist at its LOWEST on screen; the system SHALL name the pair by body position rather
than by extremum kind, so that a caption cannot state the opposite of the truth.

#### Scenario: The pair spans a half-cycle, not a sub-cycle wiggle

- **WHEN** arm swing symmetry emits an exemplar for a side on a clip with a fitted swing rhythm
- **THEN** the interval between that exemplar's `timestamp` and its `pairedTimestamp` is half that
  side's fitted swing period, to within the clip's own frame interval

#### Scenario: The base instant is the wrist at its highest

- **WHEN** arm swing symmetry emits an exemplar for a side
- **THEN** its `timestamp` names the frame where that side's wrist sits higher on screen relative to
  its shoulder, and its `pairedTimestamp` the frame where it sits lower

### Requirement: Footstrike timing is derived from the fitted hip-bounce phase

The system SHALL derive the **instant** of each footstrike from the fitted hip-bounce phase, and
SHALL NOT derive it from the vertical separation between the two ankles.

Vertical acceleration of the body is downward during flight and net upward during stance, so its
sign flips exactly at touchdown and at toe-off: the inflections of the vertical trajectory are the
contact events. For the fitted sinusoid those sit a quarter period either side of each extremum, so
a touchdown SHALL be placed a **quarter of the fitted period before each fitted low point** of the
body, one per bounce cycle. Because the hip-mid vertical trace bounces once per step, this emits one
touchdown per step, at the correct rate by construction rather than by selection.

The quarter period SHALL be taken as the geometric distance from a sinusoid's extremum to its
inflection, and SHALL NOT be replaced by, corrected with, or supplemented by a fitted or configured
offset. The system SHALL NOT introduce a new configurable threshold for this timing.

Instants SHALL be derived from the reported phase and time origin, not by scanning the raw hip trace
for its extremes, on the terms the spectral-fit requirement already states; and each SHALL be
snapped to an actual sampled frame and dropped when no sampled frame lies within the snapping
tolerance.

The **sides** of the emitted footstrikes SHALL alternate, because a stride is two steps, one per
foot, and these instants are one step apart by construction. The system SHALL therefore make a
single assignment for the whole clip rather than reading each instant independently: each instant
carries the index of the bounce cycle that produced it, which keeps alternating correctly across an
instant that had to be dropped, so the only remaining question is which parity is which foot.

That question SHALL be answered by the ankles, summed across every emitted instant and weighted by
how far apart the two ankles were at each — since a foot cannot be planted while the other foot is
below it, and two ankles at the same height are no evidence at all. The system SHALL NOT decide a
side from a single instant's ankles: on side-view footage the two ankles cross and occlude each
other every step and their labels are sometimes swapped outright, so a single reading is one coin
flip on the noisiest quantity in the clip. This weighting SHALL have no threshold and no tolerance
parameter.

When the summed evidence is exactly zero — no instant resolved both ankles, or a perfect tie —
nothing in the clip names the feet, and the system SHALL fall back rather than choose a parity
arbitrarily.

This timing SHALL be used only when the hip-bounce fit clears the same fit-quality bar cadence
itself requires before reporting a value — the same bar and the same configuration key the
rhythm-derived footstrike spacing floor already reads, so that the system cannot hold two different
opinions about whether the clip has a measurable rhythm. When the fit does not clear that bar, or
when it clears it but yields no attributable instant at all, the system SHALL fall back to detecting
footstrikes between the two ankles, which is the behaviour that predates this requirement. A clip
that reports footstrike-derived metrics without this requirement SHALL continue to report them with
it.

Exposing this timing SHALL NOT change the fitted amplitude, frequency, either R² figure, the
second-peak ratio, the sample count, the span, or the observed-cycle count for any input, and SHALL
NOT change any value cadence or the vertical-oscillation family reports.

#### Scenario: A touchdown is placed a quarter period before the body's fitted low point

- **GIVEN** a clip whose hip-bounce fit clears cadence's fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** each emitted instant sits a quarter of the fitted period before one of the fitted
  waveform's low points
- **AND** exactly one instant is emitted per bounce cycle inside the analysed span

#### Scenario: The emitted instant does not track the contralateral swing apex

- **GIVEN** a family of clips identical except for the phase at which the swinging foot reaches its
  apex, spanning the range over which the ankle-separation detector's lag varies from one sampled
  frame to eleven
- **WHEN** footstrikes are detected on each
- **THEN** the emitted instants' lag behind true touchdown is the same on every clip in the family

#### Scenario: The residual tracks the runner's stance fraction and nothing else

- **GIVEN** a family of clips identical except for how long stance lasts as a fraction of a step
- **WHEN** footstrikes are detected on each
- **THEN** the emitted instants' lag behind true touchdown grows with that fraction, as half the
  amount by which stance exceeds half a step period
- **AND** the lag is zero when stance is exactly half a step period

#### Scenario: Emitted footstrikes alternate feet

- **WHEN** footstrikes are detected from the fitted phase
- **THEN** no two consecutive emitted candidates carry the same side
- **AND** consecutive same-side candidates are two bounce periods — one stride — apart

#### Scenario: One instant with swapped ankles cannot flip the assignment

- **GIVEN** a clip in which the two ankles' vertical positions are transposed at one emitted
  instant, as a pose detector does when the legs cross
- **WHEN** footstrikes are detected
- **THEN** every emitted candidate's side is the same as it was without the transposition

#### Scenario: A predicted instant with no nearby sampled frame is not emitted

- **GIVEN** a predicted touchdown that falls in a gap where the clip has no sampled frame within the
  snapping tolerance
- **WHEN** footstrikes are detected
- **THEN** that instant is not emitted, and no neighbouring frame is substituted for it

#### Scenario: A clip whose hip fit is below cadence's bar keeps today's detector

- **GIVEN** a clip whose hip-bounce fit fails, or lands below cadence's fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** the instants are those the ankle-separation detector produces, exactly as they were
  before this requirement

#### Scenario: A clip whose fit passes but yields no attributable instant keeps today's detector

- **GIVEN** a clip whose hip-bounce fit clears the bar but in which no emitted instant resolves both
  ankles, so nothing names the feet
- **WHEN** footstrikes are detected
- **THEN** the instants are those the ankle-separation detector produces, rather than an empty list

#### Scenario: Cadence and the vertical-oscillation family are unmoved

- **WHEN** the same clip is analysed before and after this requirement
- **THEN** the reported cadence, vertical oscillation, vertical oscillation in centimetres, and the
  fitted frequency, amplitude and R² figures behind them are identical

