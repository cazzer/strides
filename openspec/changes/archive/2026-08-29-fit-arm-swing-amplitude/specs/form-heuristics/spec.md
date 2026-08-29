# form-heuristics

## MODIFIED Requirements

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

## ADDED Requirements

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
