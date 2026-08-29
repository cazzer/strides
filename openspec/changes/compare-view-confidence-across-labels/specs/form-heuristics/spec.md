## MODIFIED Requirements

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
