## ADDED Requirements

### Requirement: Arm swing amplitude is a metric reporting the mean of the two arms' fitted swing amplitudes as a fraction of torso length

The system SHALL expose arm swing amplitude as a `MetricId` (`armSwingAmplitude`), positioned
last in `MetricId` and every enumeration of it (after `kneeDrive`). Its `value` SHALL be the mean
of the two sides' fitted peak-to-peak wrist-relative-to-shoulder vertical amplitudes — the same
per-side spectral sinusoid fits arm swing symmetry reads, produced by the shared per-side
computation, never a second fit of the same series — divided by `estimateBodyScale`'s clip-median
torso length. `unit` SHALL be `'ratio'`. The metric measures wrist-travel AMPLITUDE as a 2D
movement proxy: neither its caveats nor its presentation SHALL claim to measure propulsive force,
arm-drive effectiveness, or what the swing contributes to the stride, and its presentation SHALL
distinguish it from arm swing symmetry (how big versus how even).

The metric's trust gates SHALL be the SHARED arm-swing gates, applied to the identical fitted
signal arm swing symmetry gates on — the weaker arm's sinusoid partial R² against
`armSwingMinFitR2`, the shared minimum-cycle floor, and the shared cross-side fitted-frequency
disagreement bound — never a second, separately-tunable gate on the same fitted signal, so the
two arm metrics can never disagree about whether the fits are trustworthy. Its confidence inputs
SHALL each be the WORSE side's (frame coverage, interpolated fraction, observed cycles, fit
quality), never an average of the two sides, and when the two sides' fit qualities diverge past
the shared disparity bound the result SHALL carry a caveat saying part of the overall swing size
may reflect measurement rather than form.

The metric SHALL report `value: null` with `confidence: 0` and a caveat naming the TRUE cause —
never a false or conflated one — in each of these distinct cases: no resolvable shoulder/wrist
position for one or both arms; a per-side swing rhythm that could not be fitted (too few samples,
too short a clip, or no oscillating motion — the shared per-side failure wording); a fitted
rhythm on the weaker arm below the shared R² gate; the two arms' fitted rhythms disagreeing past
the shared bound (its own wording stating a single arm-swing size cannot be measured — distinct
from the symmetry metric's not-comparable wording, because what failed here is the existence of
one swing rhythm to size); and no resolvable body-scale reference (shoulders/hips) in the clip,
which the scale-free symmetry ratio does not need but a torso-normalized amplitude does.

#### Scenario: A clean front clip reports the mean of the two sides' normalized amplitudes

- **WHEN** arm swing amplitude is computed against a front-view clip where both arms' shoulders
  and wrists resolve, both sides' fits clear the shared gates on one rhythm, and a torso length
  resolves
- **THEN** `value` equals the mean of the two fitted peak-to-peak amplitudes divided by the
  clip-median torso length, `unit` is `'ratio'`, and `confidence` reflects view fit, worse-side
  coverage, worse-side interpolation, worse-side observed cycles and worse-side fit quality

#### Scenario: One arm fitting only noise publishes nothing

- **WHEN** one arm's trace fits the shared frequency grid below `armSwingMinFitR2` while the
  other arm fits cleanly
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat names the too-irregular swing
  rhythm — a mean over one real amplitude and one noise amplitude is never reported

#### Scenario: A cross-side rhythm mismatch is not averaged into an amplitude

- **WHEN** the two arms' fitted frequencies disagree by more than the shared cross-side bound —
  e.g. one arm's fit latched onto the step rhythm while the other fitted the stride rhythm, both
  clearing the R² gate
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat states that a single arm-swing
  size cannot be measured — distinct in wording from the symmetry metric's rhythm-mismatch caveat

#### Scenario: A missing body-scale reference nulls the normalized amplitude with its own caveat

- **WHEN** both arms' shoulders and wrists resolve and fit one rhythm, but hips never resolve, so
  `estimateBodyScale` returns null and there is no torso length to normalize by
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat names the missing body-scale
  reference (shoulders/hips) — the same true-cause wording the other body-scale-dependent metrics
  use, never a claim about the arms themselves

#### Scenario: Worse-arm confidence is not averaged away

- **WHEN** two clips differ only in one arm's tracking quality, the better-tracked arm identical
  between them
- **THEN** the clip with the worse-tracked arm reports strictly lower confidence — every
  confidence input reads the worse side, so degrading one arm alone always shows

#### Scenario: A side-quality disparity is caveated in amplitude terms

- **WHEN** the two sides' fitted R² differ by more than the shared disparity bound while both
  clear the gate
- **THEN** the result carries a caveat saying one arm was tracked noticeably better than the
  other and part of the overall swing size may reflect measurement rather than form

### Requirement: Arm swing amplitude is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for arm swing amplitude
(`viewFitTable.armSwingAmplitude.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — copying `armSwingSymmetry`'s identical
front-primary/side-unsuitable gating exactly, not merely similarly — because a side view occludes
or superimposes the far arm, an occlusion/separability failure that contaminates a two-arm
amplitude just as it contaminates a two-arm comparison. `'ambiguous'` SHALL also be treated as
unsuitable (`multiplier: 0.2`). The system SHALL still compute and return a value when the view
is `'side'` or `'ambiguous'` and a value would otherwise resolve, never substituting `null`
purely because the view is unsuitable, and SHALL attach a caveat naming the unsuitable camera
angle via the shared view phrasing.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** arm swing amplitude is computed against a `'front'`-classified clip with resolvable
  arms, fits clearing the shared gates, and a resolvable torso
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** arm swing amplitude is computed against a `'side'`-classified clip where a value would
  otherwise resolve
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the measurement is not reliable from that camera
  angle

### Requirement: Arm swing amplitude participates in the shared orchestration and output contract

The system SHALL include arm swing amplitude in `computeFormHeuristics`'s result
(`FormHeuristicsResult.armSwingAmplitude`), positioned last — appended after `kneeDrive` rather
than inserted elsewhere, matching `MetricId`'s own declaration order — computed under the same
once-per-clip detected view as every other metric, and SHALL follow the same output contract
every other metric follows: `value` a finite number or `null` (never `NaN` or `Infinity`),
`confidence` in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any
well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes arm swing amplitude gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `armSwingAmplitude.viewFit` reflects the same view decision present in
  the same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `armSwingAmplitude.value` is `null` and `armSwingAmplitude.confidence` is `0`, without
  throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** arm swing amplitude is computed against any combination of empty frames, a clip with
  no resolvable arm positions, a clip whose fits fail the shared gates, a clip with no resolvable
  body scale, or a clip with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and
  `confidence` is `0` whenever `value` is `null`
