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

Each sample SHALL be scale-stabilized before the fit: divided by a per-frame factor derived from a
whole-window least-squares quadratic trend of the LOG of the inter-shoulder distance, normalized so
the factor reads 1 at the clip's reference (median measured) scale. The spectral fit's model is a
CONSTANT-amplitude sinusoid, and a wrist-relative-to-shoulder excursion is a body-proportioned
quantity — on a clip whose subject changes on-screen size inside the fit window, the raw-pixel
least squares overweights the large-scale frames and reads mostly the clip's largest end. The
scale proxy SHALL be resolved strictly bilaterally (both shoulders independently resolvable, never
a single-side stand-in — a fabricated length is not a scale), and a frame whose proxy is missing
SHALL still receive a factor from the trend, so no swing sample is ever dropped for it: the
stabilization changes sample VALUES only, never the series' resolved/interpolated accounting. When
the trend cannot be soundly fitted — too few bilateral proxy frames, an unsolvable system, or a
trend flat to within a degeneracy floor — the factor SHALL be identically 1, an exact no-op equal
to the raw-pixel computation.

The value requires no body-scale reference to report a ratio — the two amplitudes are measured in
the same (reference-scale) pixel space on the same body, so the system SHALL NOT require a
resolvable torso in order to report one.

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

#### Scenario: A subject whose on-screen scale changes during the clip is measured in body proportion

- **WHEN** the subject's on-screen size changes substantially inside the fit window (e.g. running
  toward the camera) while each arm's swing amplitude stays constant in body units
- **THEN** the reported ratio tracks the body-unit amplitude ratio — matching an otherwise-
  identical clip with no scale change — rather than a ratio dominated by the largest-scale frames

#### Scenario: A clip with no resolvable torso is still measured

- **WHEN** both shoulders and both wrists resolve across the clip but no body-scale reference
  (shoulder-to-hip torso segment) resolves in any frame
- **THEN** a non-null `value` is returned rather than `null`

### Requirement: Arm swing symmetry's confidence reads the worse-measured arm, never an average

A symmetry comparison is only as trustworthy as its less-observed side, and averaging is
specifically wrong for this metric rather than merely imprecise: the case that must not read as
confident is one arm measured materially worse than the other, and that is exactly the case an
average hides — while also being the case most likely to produce an apparent asymmetry that belongs
to the footage rather than to the runner.

The system SHALL therefore derive every confidence input for arm swing symmetry from the WORSE of
the two arms: frame coverage, interpolated fraction, observed swing-cycle count, and a fit-quality
factor ramping on the weaker arm's sinusoid partial R². When the two arms' fit qualities differ
materially, the system SHALL additionally emit a caveat saying that one arm's swing rhythm fit its
trace much less cleanly than the other's and that part of the difference between them may be
measurement rather than form. The caveat SHALL name the FIT disparity that actually fired it, not
a tracking-coverage gap it never measured — the worse-fitting arm can be the better-detected one.

#### Scenario: Degrading one arm's tracking alone lowers confidence

- **WHEN** two otherwise-identical clips are compared, differing only in that one of them has
  materially noisier tracking on a single arm
- **THEN** the noisier clip's `confidence` is lower, and its `caveat` reports that one arm's swing
  rhythm fit its trace much less cleanly than the other's

#### Scenario: An arm measured worse than the other is not averaged away

- **WHEN** one arm fits well and the other fits poorly but still above `armSwingMinFitR2`
- **THEN** `confidence` reflects the poorly-fitting arm, not the mean of the two

### Requirement: Arm swing symmetry's exemplar pair spans one fitted half-swing

The system SHALL derive each side's ghosted exemplar pair from that side's fitted PHASE — the two
sampled frames nearest a fitted maximum and its adjacent fitted minimum — so the pair spans half a
fitted swing period by construction, and SHALL NOT select it by scanning the raw trace for extrema.
The picture is captioned as one swing, top against bottom, and a pair chosen off the raw trace
depicts drift and jitter that the reported amplitude explicitly excludes.

Because the fitted series is the scale-stabilized `wrist.y − shoulder.y` in image-y, which grows
downward — the stabilizing divisor is positive by construction, so it preserves this sign
convention — the fitted MAXIMUM is the wrist at its LOWEST on screen; the system SHALL name the
pair by body position rather than by extremum kind, so that a caption cannot state the opposite of
the truth.

#### Scenario: The pair spans a half-cycle, not a sub-cycle wiggle

- **WHEN** arm swing symmetry emits an exemplar for a side on a clip with a fitted swing rhythm
- **THEN** the interval between that exemplar's `timestamp` and its `pairedTimestamp` is half that
  side's fitted swing period, to within the clip's own frame interval

#### Scenario: The base instant is the wrist at its highest

- **WHEN** arm swing symmetry emits an exemplar for a side
- **THEN** its `timestamp` names the frame where that side's wrist sits higher on screen relative to
  its shoulder, and its `pairedTimestamp` the frame where it sits lower

### Requirement: Arm swing amplitude is a metric reporting the mean of the two arms' fitted swing amplitudes as a fraction of torso length

The system SHALL expose arm swing amplitude as a `MetricId` (`armSwingAmplitude`), positioned
last in `MetricId` and every enumeration of it (after `kneeDrive`). Its `value` SHALL be the mean
of the two sides' fitted peak-to-peak wrist-relative-to-shoulder vertical amplitudes — the same
per-side spectral sinusoid fits arm swing symmetry reads, produced by the shared per-side
computation over the shared scale-stabilized series, never a second fit of the same series —
divided by `estimateBodyScale`'s clip-median torso length. The per-side amplitudes arrive already
at the clip's reference (median) scale, so the clip-median torso denominator pairs with a
numerator standardized at the same reference and the normalization's semantics are unchanged.
`unit` SHALL be `'ratio'`. The metric measures wrist-travel AMPLITUDE as a 2D
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
the shared disparity bound the result SHALL carry a caveat saying one arm's swing rhythm fit its
trace much less cleanly than the other's and that part of the overall swing size may reflect
measurement rather than form.

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
- **THEN** the result carries a caveat saying one arm's swing rhythm fit its trace much less
  cleanly than the other's and part of the overall swing size may reflect measurement rather
  than form
