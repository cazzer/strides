# form-heuristics

## REMOVED Requirements

### Requirement: Arm swing symmetry compares per-side wrist-relative-to-shoulder swing amplitude

**Reason**: The metric is withdrawn. Measured on `f7b02e8` with zero spread over two trials, it
resolves on exactly one clip in the corpus (`front-approach`: 0.518, confidence 0.413, sampleSize
2, caveated) and is null/excluded on both side clips. `strides-56e` establishes that the one value
it does produce is measured under materially unequal per-side conditions (left fit R² 0.776 vs
right 0.512), and that nothing in that clip's footage can adjudicate how much of the ratio is form
and how much is measurement.

**Migration**: The per-side spectral fit, the scale stabilization and the exemplar builder are NOT
removed — they live in the shared `armSwing.ts` module and are now specified by *Arm swing
amplitude is a metric reporting the mean of the two arms' fitted swing amplitudes as a fraction of
torso length*, which reads the identical per-side fits over the identical stabilized series. Only
the `min/max` ratio and its `'percent'` output go. This requirement's harmonic-robustness scenario
is a property of the shared per-side computation rather than of the ratio, and is re-stated on the
amplitude requirement rather than dropped.

### Requirement: Arm swing symmetry is front-view-primary, hard-gated away from side view

**Reason**: Removed with the metric whose view-fit row it specifies.

**Migration**: The identical front-primary (`1.0`) / side-unsuitable (`0.1`) /
ambiguous-unsuitable (`0.2`) row survives on three metrics. `viewFitTable.armSwingAmplitude` is
byte-identical to the deleted row, and *Arm swing amplitude is front-view-primary, hard-gated away
from side view* now states the occlusion/separability reasoning on its own terms rather than by
reference to this requirement.

### Requirement: Arm swing symmetry follows the shared output contract

**Reason**: Removed with the metric.

**Migration**: The shared per-side gates — the weaker arm's R² against `armSwingMinFitR2`, and
either side failing to fit being fatal — are unchanged and are now specified solely by the arm
swing amplitude requirement. The `'percent'` unit contract goes with the metric: `verticalRatio` is
now that unit's only producer.

### Requirement: Arm swing symmetry rejects a comparison between two different rhythms

**Reason**: Removed with the metric.

**Migration**: `MAX_SIDE_FREQUENCY_DISAGREEMENT` and the cross-side fitted-frequency check are
SHARED (`armSwing.ts`) and survive untouched. The amplitude requirement already specifies the same
bound in its own terms — a mean over an arm-swing amplitude and a step-bounce amplitude is not an
arm-swing amplitude — and carries its own scenario for it.

### Requirement: Arm swing symmetry's confidence reads the worse-measured arm, never an average

**Reason**: Removed with the metric.

**Migration**: Worse-side confidence aggregation and the fit-disparity caveat are shared policy,
already restated in amplitude terms by the amplitude requirement's own worse-arm and
side-quality-disparity scenarios.

### Requirement: Arm swing symmetry's exemplar pair spans one fitted half-swing

**Reason**: Removed with the metric that named it. Its first paragraph — the fitted-phase rule —
is already stated by the arm swing amplitude requirement's exemplar clause.

**Migration**: Its SECOND paragraph is not covered anywhere else, and governs code that still runs
on every clip: `buildSideExemplar` passes `maximumIs: 'lowest'` because the fitted series grows
downward in image-y. Removing this requirement outright would leave the code keeping the behaviour,
the migrated test still asserting it, and no requirement asking for it. It is therefore re-added,
metric-neutrally, as *An arm-swing exemplar pair names its instants by body position, not by
extremum kind*.

## ADDED Requirements

### Requirement: An arm-swing exemplar pair names its instants by body position, not by extremum kind

Because the fitted per-side arm-swing series is the scale-stabilized `wrist.y − shoulder.y` in
image-y, which grows downward — the stabilizing divisor is positive by construction, so it
preserves this sign convention — the fitted MAXIMUM is the wrist at its LOWEST on screen. The
system SHALL name a ghosted arm-swing pair by body position rather than by extremum kind, so that a
caption cannot state the opposite of the truth.

This is stated of the shared per-side exemplar builder rather than of any one metric, because every
consumer of that builder inherits the same trap: reading the extremum kind straight through
produces a caption that says the exact opposite of what the image shows, while passing every type
check.

#### Scenario: The base instant is the wrist at its highest

- **WHEN** an arm-swing exemplar is emitted for a side
- **THEN** its `timestamp` names the frame where that side's wrist sits higher on screen relative
  to its shoulder, and its `pairedTimestamp` the frame where it sits lower

## MODIFIED Requirements

### Requirement: Step width is front/rear-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for step width
(`viewFitTable.stepWidth.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as unsuitable
(`multiplier: 0.1`), since a side-on camera looks straight along the mediolateral axis step width
measures, collapsing it toward a degenerate reading. `'ambiguous'` SHALL also be treated as
unsuitable (`multiplier: 0.2`). The system SHALL still compute and return a value when the view is
`'side'` or `'ambiguous'`, never substituting `null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** step width is computed against a `'front'`-classified clip with resolvable footstrikes
  and hip positions
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** step width is computed against a `'side'`-classified clip with resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null caveat

### Requirement: Step width in centimetres is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for step width in centimetres
(`viewFitTable.stepWidthCm.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — mirroring its ratio sibling `stepWidth`'s identical
front-primary/side-unsuitable gating exactly, not merely similarly — because a side-on camera
collapses the mediolateral (side-to-side) offset this metric measures onto the same image axis the
hip already occupies, producing a confidently-wrong small number rather than an obviously-degraded
one. `'ambiguous'` SHALL also be treated as unsuitable (`multiplier: 0.2`). The system SHALL still
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

### Requirement: Arm swing amplitude is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for arm swing amplitude
(`viewFitTable.armSwingAmplitude.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — because a side view occludes or superimposes the far arm, an
occlusion/separability failure rather than a loss of the swing signal itself, and an amplitude
averaged over one visible arm and one occluded arm is contaminated by the occlusion. `'ambiguous'`
SHALL also be treated as unsuitable (`multiplier: 0.2`). The system SHALL still compute and return
a value when the view is `'side'` or `'ambiguous'` and a value would otherwise resolve, never
substituting `null` purely because the view is unsuitable, and SHALL attach a caveat naming the
unsuitable camera angle via the shared view phrasing.

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

#### Scenario: An ambiguous-view clip is computed, not withheld, and capped at the ambiguous multiplier

- **WHEN** arm swing amplitude is computed against an `'ambiguous'`-classified clip where a value
  would otherwise resolve
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.2` multiplier, and a caveat naming the ambiguous camera angle

### Requirement: Arm swing amplitude is a metric reporting the mean of the two arms' fitted swing amplitudes as a fraction of torso length

The system SHALL expose arm swing amplitude as a `MetricId` (`armSwingAmplitude`), positioned
last in `MetricId` and every enumeration of it (after `kneeDrive`). Its `value` SHALL be the mean
of the two sides' fitted peak-to-peak wrist-relative-to-shoulder vertical amplitudes — the
per-side spectral sinusoid fits produced by the shared per-side computation (`computeSideSwing`)
over the shared scale-stabilized series, never a second fit of the same series — divided by
`estimateBodyScale`'s clip-median torso length. The per-side amplitudes arrive already
at the clip's reference (median) scale, so the clip-median torso denominator pairs with a
numerator standardized at the same reference and the normalization's semantics are unchanged.
`unit` SHALL be `'ratio'`. The metric measures wrist-travel AMPLITUDE as a 2D
movement proxy: neither its caveats nor its presentation SHALL claim to measure propulsive force,
arm-drive effectiveness, or what the swing contributes to the stride.

The metric's trust gates SHALL be the SHARED arm-swing gates, applied to the fitted signal the
shared module produces — the weaker arm's sinusoid partial R² against `armSwingMinFitR2`, the
shared minimum-cycle floor, and the shared cross-side fitted-frequency disagreement bound — never a
second, separately-tunable gate on the same fitted signal, so a future second consumer of
`computeSideSwing` inherits the gate rather than choosing its own. Its confidence inputs
SHALL each be the WORSE side's (frame coverage, interpolated fraction, observed cycles, fit
quality), never an average of the two sides, and when the two sides' fit qualities diverge past
the shared disparity bound the result SHALL carry a caveat saying one arm's swing rhythm fit its
trace much less cleanly than the other's and that part of the overall swing size may reflect
measurement rather than form.

The metric SHALL report `value: null` with `confidence: 0` and a caveat naming the TRUE cause —
never a false or conflated one — in each of these distinct cases: no resolvable shoulder/wrist
position for one or both arms; a per-side swing rhythm that could not be fitted (too few samples,
too short a clip, or no oscillating motion — the shared per-side failure wording); a fitted
rhythm on the weaker arm below the shared R² gate; the two arms' fitted rhythms disagreeing past
the shared bound, naming that what failed is the existence of one swing rhythm to size rather than
the arms themselves; and no resolvable body-scale reference (shoulders/hips) in the clip, which a
torso-normalized amplitude requires even though the underlying per-side fits do not.

#### Scenario: A clean front clip reports the mean of the two sides' normalized amplitudes

- **WHEN** arm swing amplitude is computed against a front-view clip where both arms' shoulders
  and wrists resolve, both sides' fits clear the shared gates on one rhythm, and a torso length
  resolves
- **THEN** `value` equals the mean of the two fitted peak-to-peak amplitudes divided by the
  clip-median torso length, `unit` is `'ratio'`, and `confidence` reflects view fit, worse-side
  coverage, worse-side interpolation, worse-side observed cycles and worse-side fit quality

#### Scenario: Amplitude survives a swing trace carrying a step-rate harmonic

- **WHEN** each arm's trace is its swing rhythm plus a smaller oscillation at twice that frequency
  (the step rhythm the shoulder itself carries) plus per-frame tracking jitter
- **THEN** each side's fitted amplitude tracks that side's underlying swing amplitude, rather than
  a statistic over the sub-cycle wiggles a prominence-threshold extremum scan would confirm

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
  size cannot be measured, naming the absence of one swing rhythm to size rather than the
  comparability of the two arms

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
- **THEN** the result carries a caveat saying one arm's swing rhythm fit its trace much less
  cleanly than the other's and part of the overall swing size may reflect measurement rather
  than form
