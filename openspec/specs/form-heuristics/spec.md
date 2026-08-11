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

The system SHALL compute vertical oscillation from hip-mid vertical motion for every detected
view (`'side'`, `'front'`, `'ambiguous'`), applying a per-view confidence multiplier from
`viewFitTable.verticalOscillation` (`side: 1.0`, `front: 0.85`, `ambiguous: 0.6`) rather than
withholding the value outside side view.

#### Scenario: Front-view clip still produces a value

- **WHEN** vertical oscillation is computed against a `'front'`-classified clip with resolvable
  hip motion
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

