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
extreme-quantile signals rather than discounted"). Each sample SHALL be normalized by the torso
length LOCAL to it in time — the median torso length over the frames within ±0.5 s of that sample —
expressed at the clip's reference torso length (the clip-wide median) before the range is taken, so
that a runner whose on-screen size changes during the clip is measured at one consistent scale; a
sample whose window resolves no torso length SHALL be skipped, counted as neither detected nor
interpolated. The clip's SER is the mean over whichever sides produced a range, divided by the
clip's reference torso length; where no side produced one, SER is unavailable. BSR, and every other
consumer of torso length, SHALL keep the clip-wide torso length.

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

#### Scenario: A runner approaching the camera reads the same SER as one at constant distance

- **WHEN** a runner's on-screen size grows several-fold across the clip (approaching a handheld
  camera) while the ankle's reach relative to the torso stays the same
- **THEN** SER reads within a small tolerance of the SER the same runner produces at constant
  distance, and a front-view approach is classified `'front'` rather than `'ambiguous'`
- **AND** where the runner's size is constant, SER is exactly what a single clip-wide torso length
  produces
