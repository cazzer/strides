# form-heuristics — delta

## MODIFIED Requirements

### Requirement: View classification from independent geometric signals

The system SHALL classify a clip's camera framing as `'side'`, `'front'` (front-or-back — no face
keypoints exist in this pipeline, and nothing downstream distinguishes them), or `'ambiguous'`,
using two independent signals — Bilateral Spread Ratio (BSR: left/right shoulder+hip spread
relative to torso length) and Sagittal Excursion Ratio (SER: per-side ankle-relative-to-hip range
relative to torso length) — each compared against configurable thresholds
(`sideViewMaxBilateralSpreadRatio`, `frontViewMinBilateralSpreadRatio`,
`sideViewMinSagittalExcursionRatio`, `frontViewMaxSagittalExcursionRatio`).

SER SHALL be computed per side as an extreme-quantile range over that side's **directly detected**
ankle-relative-to-hip samples, excluding every sample whose ankle or whose own hip the robustness
layer had to interpolate, and SHALL be reported for a side only where that detected population
reaches the minimum count the range estimator needs (see "Interpolated samples are excluded from
extreme-quantile signals rather than discounted"). The clip's SER is the mean over whichever sides
produced a range, normalized by torso length; where no side produced one, SER is unavailable.

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
  threshold, or a signal is unavailable — no frames yield a usable BSR sample, or no side yields
  enough directly-detected samples for a usable SER range
- **THEN** the clip is classified `'ambiguous'` rather than committing to a possibly-wrong label

#### Scenario: A narrow-built runner filmed dead-on is classified front

- **WHEN** a runner whose shoulder and hip-joint-centre separations sit at the narrow end of the
  adult range is filmed square-on, so BSR reads the lowest value a dead-on front view can produce
- **THEN** BSR still clears `frontViewMinBilateralSpreadRatio` and the clip is classified `'front'`

### Requirement: Missing and interpolated keypoints are handled per a shared, documented policy

The system SHALL derive every heuristic's input exclusively from `RobustPoseFrame` (never raw
pose-detection output), resolving bilateral midpoints tolerantly (falling back to a single
resolvable side, flagged as interpolated, rather than discarding the frame) for center-of-mass
proxies, and strictly (both sides required) only where the left/right separation itself is the
measured signal.

Two policies govern what a signal then does with an interpolated sample, and which applies SHALL be
decided by the signal's own reduction, not by the signal's importance:

- **A signal reduced by a median or a mean SHALL DISCOUNT.** Every metric falls here: it keeps
  interpolated samples, tracks what fraction of its resolved input was interpolated rather than
  directly detected, and factors that fraction into its confidence.
- **A signal reduced by an extreme quantile SHALL EXCLUDE.** It discards interpolated samples from
  its population outright, because an interpolated sample is placed on the straight line between
  its own flanking detections, so wherever those anchors bound it, it cannot carry a real extreme —
  it can only add probability mass near one, which moves an extreme quantile toward whatever the
  anchors got wrong. Where they bound it, excluding cannot discard a real extreme the retained
  anchors do not already carry, whereas including can manufacture one. View detection's Sagittal
  Excursion Ratio falls here.

Where a signal is derived from several keypoint channels, each interpolated independently over its
own run boundaries, that bound holds exactly only when the contributing channels were reconstructed
together. The excluding rule SHALL therefore be applied on the conservative side: a sample SHALL be
excluded whenever ANY contributing point was interpolated, accepting that this can also discard a
genuine reading. That is the safe direction for an extreme-quantile range, because excluding can
only narrow it — never widen it — so the worst case is a signal that abstains rather than one that
votes confidently for the wrong answer.

View detection's Bilateral Spread Ratio is reduced by a median and so falls under the discounting
rule. It keeps its interpolated samples, which is what that rule requires of it; it is a signal
inside the classifier rather than a metric, and nothing requires it to publish an interpolated
fraction or to discount the classifier's own confidence by one.

An excluding signal SHALL NOT report a value from a population too small for its estimator to trim
at both ends; it SHALL report the signal as unavailable instead of silently degrading to a
minimum-to-maximum span. That minimum SHALL be derived from the estimator's own arithmetic rather
than configured.

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

#### Scenario: An extreme-quantile range ignores interpolated samples entirely

- **WHEN** an extreme-quantile signal's input contains interpolated samples clustered at an extreme
  — as happens when the robustness layer lerps across a run of missed frames whose flanking
  detections are both bad
- **THEN** the reported value is exactly the value the directly-detected samples alone produce, and
  is not moved toward the interpolated cluster

#### Scenario: An extreme-quantile signal with too few detected samples is unavailable

- **WHEN** an extreme-quantile signal's directly-detected population is smaller than the count its
  estimator needs to trim at both ends
- **THEN** that signal reports no value rather than a minimum-to-maximum span, and the classification
  it feeds treats it as an unavailable signal — not as a failure of overall frame coverage
