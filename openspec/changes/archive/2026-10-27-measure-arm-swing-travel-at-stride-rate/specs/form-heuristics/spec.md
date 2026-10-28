## ADDED Requirements

### Requirement: Arm swing amplitude reports per-stride wrist travel as a fraction of torso length

The system SHALL expose arm swing amplitude as a `MetricId` (`armSwingAmplitude`), positioned
last in `MetricId` and every enumeration of it (after `kneeDrive`). For each measured arm the
system SHALL derive a per-stride TRAVEL from the shared per-side computation (`computeSideSwing`):
over that arm's scale-stabilized wrist-relative-to-shoulder vertical series, the quadratic trend
fitted jointly with the sinusoid at the fit's winning frequency is removed; a Hampel spike guard
replaces a sample with its local median (over two consecutive usable samples either side) only
when it deviates from that median by more than three scaled median absolute deviations, so a clean
extremum is never altered; windows one STRIDE period long (`1/strideHz`, the hip-anchored stride
rate rather than the fit's own weakly-determined frequency) slide by a quarter period across the
usable span, each lying wholly inside it; and the travel is the median over windows (each holding
at least 3 samples) of the window's maximum minus its minimum. No travel SHALL be derived from a
usable span holding fewer than two complete stride periods, where a single window's range would
carry every per-frame tracking excursion in it undiluted. The value
SHALL be that travel divided by `estimateBodyScale`'s clip-median torso length — the mean of the
two arms' travels for a both-arms reading, the near arm's travel alone for a near-arm reading (see
the view requirement). The fitted sinusoid's peak-to-peak amplitude SHALL NOT be published as the
value: it is the fundamental's size, not the wrist's travel. `unit` SHALL be `'ratio'`. The metric
measures wrist-travel AMPLITUDE as a 2D movement proxy: neither its caveats nor its presentation
SHALL claim to measure propulsive force, arm-drive effectiveness, or what the swing contributes to
the stride.

The metric's trust gates SHALL be the SHARED arm-swing gates applied to the fitted fundamental —
the measured arm's (for both arms, the weaker arm's) sinusoid partial R² against
`armSwingMinFitR2`, the two-complete-stride floor on the travel, and for a both-arms reading the
shared cross-side fitted-frequency disagreement bound — never a second, separately-tunable gate on
the same fitted signal. The stride count is a hard floor only: it SHALL NOT ramp confidence above
that floor. For a both-arms reading its confidence inputs SHALL each be the WORSE side's (frame
coverage, interpolated fraction, fit quality), never an average, and when
the two sides' fit qualities diverge past the shared disparity bound the result SHALL carry a
caveat saying one arm's swing rhythm fit its trace much less cleanly than the other's and that
part of the overall swing size may reflect measurement rather than form.

The metric SHALL report `value: null` with `confidence: 0` and a caveat naming the TRUE cause in
each of these distinct cases: no steady running rhythm to time the arm swing against (see the
stride-rate requirement); no resolvable shoulder/wrist position for a measured arm; a per-side
swing rhythm that could not be fitted (too few samples, too short a clip, or no oscillating
motion — the shared per-side failure wording); a measured arm whose usable span holds fewer than
two complete stride periods, naming that the clip holds fewer than two complete arm swings to
measure a size from; a fitted rhythm on a measured arm below the shared R² gate;
for a both-arms reading, the two arms' fitted rhythms disagreeing past the shared bound, naming
that what failed is the existence of one swing rhythm to size; and no resolvable body-scale
reference (shoulders/hips) in the clip.

#### Scenario: A clean front clip reports the mean of the two arms' per-stride travel

- **WHEN** arm swing amplitude is computed against a front-view clip with a steady running rhythm
  where both arms' shoulders and wrists resolve, both fits clear the shared gates on one rhythm,
  and a torso length resolves
- **THEN** `value` equals the mean of the two arms' per-stride travels divided by the clip-median
  torso length, `unit` is `'ratio'`, and `confidence` reflects view fit, worse-side coverage,
  worse-side interpolation and worse-side fit quality

#### Scenario: A swing carrying a second harmonic is reported at its full travel

- **WHEN** an arm's trace is its stride-rate swing plus a component at twice that frequency, so its
  peak-to-trough travel exceeds the fundamental's peak-to-peak
- **THEN** the reported travel tracks the trace's full peak-to-trough travel within one stride,
  not the fundamental's smaller peak-to-peak

#### Scenario: Fewer than two complete strides publishes no travel

- **WHEN** an arm's fit clears every gate but its usable span holds fewer than two complete stride
  periods
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat says the clip holds fewer than
  two complete arm swings to measure their size from — never that it is too short for one cycle

#### Scenario: A clean sampled extremum is not clipped by the spike guard

- **WHEN** a clean swing is sampled at the live operating point (~26 Hz) with a sample falling on
  an extremum
- **THEN** the reported travel equals the samples' own peak-to-trough range, not a range shrunk
  toward the neighbouring samples

#### Scenario: A single-frame spike does not inflate the travel

- **WHEN** one sample of an otherwise clean swing trace is displaced far outside the swing (a
  detector glitch or a left/right label swap)
- **THEN** the reported travel stays within a few percent of the travel without that sample

#### Scenario: One arm fitting only noise publishes nothing from the front

- **WHEN** on a front-view clip one arm's trace fits below `armSwingMinFitR2` while the other arm
  fits cleanly
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat names the too-irregular swing
  rhythm — a mean over one real travel and one noise travel is never reported

#### Scenario: A cross-side rhythm mismatch is not averaged into a travel

- **WHEN** on a both-arms reading the two arms' fitted frequencies disagree by more than the shared
  cross-side bound, both clearing the R² gate
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat states that a single arm-swing
  size cannot be measured, naming the absence of one swing rhythm to size rather than the
  comparability of the two arms

#### Scenario: A missing body-scale reference nulls the normalized travel with its own caveat

- **WHEN** the arms resolve and fit, but hips never resolve, so `estimateBodyScale` returns null
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat names the missing body-scale
  reference (shoulders/hips), never a claim about the arms themselves

#### Scenario: Worse-arm confidence is not averaged away

- **WHEN** two front clips differ only in one arm's tracking quality, the better-tracked arm
  identical between them
- **THEN** the clip with the worse-tracked arm reports strictly lower confidence

#### Scenario: A side-quality disparity is caveated in amplitude terms

- **WHEN** on a both-arms reading the two sides' fitted R² differ by more than the shared disparity
  bound while both clear the gate
- **THEN** the result carries a caveat saying one arm's swing rhythm fit its trace much less
  cleanly than the other's and part of the overall swing size may reflect measurement rather
  than form

#### Scenario: No steady running rhythm nulls the metric with a rhythm caveat

- **WHEN** the arms swing but the clip's hip bounce yields no fit clearing `cadenceMinFitR2`
- **THEN** `value` is `null`, `confidence` is `0`, and the caveat says no steady running rhythm was
  found to time the arm swing against

### Requirement: Arm swing amplitude is front-view-primary and reads the near arm alone from side view

The system SHALL treat `'front'` as the primary view for arm swing amplitude
(`viewFitTable.armSwingAmplitude.front = { fit: 'primary', multiplier: 1.0 }`) and read both arms
there. On a `'side'` clip the system SHALL read the NEAR arm alone — the arm with strictly more
directly-detected (resolved and not interpolated) shoulder-and-wrist frames — because side-on the
far arm is occluded by the body, and SHALL treat side as tolerated
(`viewFitTable.armSwingAmplitude.side = { fit: 'tolerated', multiplier: 0.6 }`). A near-arm
reading SHALL gate, take its confidence inputs and build its exemplar from the near arm only, SHALL
NOT be nulled by the far arm, and SHALL carry a caveat saying it was measured from the near arm
only because from the side the far arm is hidden behind the body. When the two arms' directly-
detected counts tie, the side clip SHALL fall back to the both-arms rule and SHALL carry a caveat
saying the far arm may be partly hidden behind the body. `'ambiguous'` SHALL be
treated as unsuitable (`multiplier: 0.2`) under the both-arms rule; the system SHALL still compute
and return a value there when one would otherwise resolve, never substituting `null` purely
because the view is unsuitable, and SHALL attach a caveat naming the unsuitable camera angle via
the shared view phrasing.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** arm swing amplitude is computed against a `'front'`-classified clip with resolvable
  arms, fits clearing the shared gates, and a resolvable torso
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: A side-view clip reads the near arm, tolerated

- **WHEN** arm swing amplitude is computed against a `'side'`-classified clip where one arm has
  more directly-detected frames than the other and its fit clears the shared gates
- **THEN** `value` is that arm's per-stride travel over torso length, `viewFit` is `'tolerated'`,
  confidence is capped by the `0.6` multiplier, the caveat names the near-arm-only measurement, and
  at most one exemplar is emitted, for the near arm

#### Scenario: A far arm failing the gate does not null a side reading

- **WHEN** on a `'side'` clip the far arm's fit falls below `armSwingMinFitR2` or its trace is
  mostly interpolated, while the near arm fits cleanly
- **THEN** a non-null `value` is still returned from the near arm

#### Scenario: A detected-count tie on a side clip falls back to both arms

- **WHEN** on a `'side'` clip both arms have exactly the same number of directly-detected frames
- **THEN** the both-arms rule applies: the value is the mean of the two travels, either arm
  failing a shared gate nulls it, and the caveat says the far arm may be partly hidden behind the
  body

#### Scenario: An ambiguous-view clip is computed, not withheld, and capped at the ambiguous multiplier

- **WHEN** arm swing amplitude is computed against an `'ambiguous'`-classified clip where a value
  would otherwise resolve
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.2` multiplier, and a caveat naming the ambiguous camera angle

### Requirement: The per-side arm-swing fit searches only around the clip's stride rate

The per-side arm-swing fit SHALL search frequencies in `[0.8 × strideHz, 1.2 × strideHz]` stepped
by `0.02 × strideHz`, where `strideHz` is half the frequency of the clip's hip-bounce fit
(`analyzeHipBounce`, including its sub-floor pass for retimed footage), and SHALL use that anchor
only when the hip-bounce fit is successful with a sinusoid partial R² at or above
`cadenceMinFitR2`. Arm swing runs once per stride and the hip bounces once per step, so the stride
rate is the arm-swing rate by construction; the shared hip-bounce band is not searched for the arm
swing. Without an anchor no arm-swing fit is attempted (see the null case above) — there is no
fallback to the hip-bounce band.

#### Scenario: A slow-cadence runner's swing is recovered

- **WHEN** a runner at 120 steps/min swings each arm at 1.0 Hz and the hip bounces at 2.0 Hz
- **THEN** each arm's fit lands within one grid step of 1.0 Hz, below the hip-bounce band's 1.2 Hz
  floor

#### Scenario: A retimed clip is searched at its retimed stride rate

- **WHEN** a slow-motion clip's hip bounce is adopted from the sub-floor pass at a clip-time
  frequency well below the human-gait band
- **THEN** the arm swing is searched around half that clip-time frequency and its travel is
  reported

#### Scenario: A step-rate component cannot be chosen

- **WHEN** an arm's trace carries a small stride-rate swing and a larger component at the step
  rate (twice the stride rate)
- **THEN** the fitted frequency lies within ±20% of the stride rate — the step rate is not on the
  grid

## MODIFIED Requirements

### Requirement: The per-side arm-swing series is scale-stabilized before it is fitted

Each sample of a per-side arm-swing series SHALL be scale-stabilized before the fit: divided by a
per-frame factor derived from a whole-window least-squares quadratic trend of the LOG of a
per-frame body-length proxy, normalized so the factor reads 1 at the clip's reference (median
measured) scale. The spectral fit's model is a CONSTANT-amplitude sinusoid, and a
wrist-relative-to-shoulder excursion is a body-proportioned quantity — on a clip whose subject
changes on-screen size inside the fit window, the raw-pixel least squares overweights the
large-scale frames and reads mostly the clip's largest end.

The proxy SHALL be the inter-shoulder distance for front and ambiguous clips, resolved strictly
bilaterally (both shoulders independently resolvable, never a single-side stand-in — a fabricated
length is not a scale). For a side clip the proxy SHALL be the per-frame torso length
(shoulder-mid to hip-mid, the pipeline's shared normalizer), because side-on the two shoulders
superimpose and their span collapses toward zero. A frame whose proxy is missing SHALL still
receive a factor from the trend, so no swing sample is ever dropped for it: the stabilization
changes sample VALUES only, never the series' resolved/interpolated accounting. When the trend
cannot be soundly fitted — too few proxy frames, an unsolvable system, or a trend flat to within a
degeneracy floor — the factor SHALL be identically 1, an exact no-op equal to the raw-pixel
computation, for either proxy.

This is stated of the shared per-side computation rather than of any one metric, because the
stabilization is a property of how that series is produced and every consumer of it inherits the
result. The exactness of the no-op is load-bearing rather than cosmetic: dividing constant values
by a numerically-almost-1 factor perturbs them at the same order as their own floating-point
rounding, which is enough to turn a motionless-arm clip's honest no-oscillation reading into a
spurious below-quality-gate one.

#### Scenario: A subject whose on-screen scale changes during the clip is measured in body proportion

- **WHEN** the subject's on-screen size changes substantially inside the fit window (e.g. running
  toward the camera) while each arm's swing amplitude stays constant in body units
- **THEN** each side's fitted amplitude tracks the body-unit amplitude — matching an otherwise-
  identical clip with no scale change — rather than an amplitude dominated by the largest-scale
  frames

#### Scenario: An unsoundly-fittable trend is an exact no-op, not an approximate one

- **WHEN** the clip offers too few strictly-bilateral proxy frames to fit the trend, or the fitted
  trend is flat to within the degeneracy floor
- **THEN** every per-side fitted amplitude equals the raw-pixel computation exactly, not merely to
  within an epsilon

#### Scenario: A side-on clip is stabilized by torso length, not by the foreshortened shoulder span

- **WHEN** a side-on subject grows on screen while the two shoulders nearly superimpose, so the
  inter-shoulder span jitters near zero
- **THEN** the torso-length-stabilized series recovers the body-unit swing travel, where a
  shoulder-span-stabilized series — divided by a near-zero span that carries no trace of the
  growth — does not

### Requirement: An arm-swing exemplar pair spans one fitted half-swing and names its instants by body position

The system SHALL derive each side's ghosted arm-swing exemplar pair from that side's fitted PHASE —
the two sampled frames nearest a fitted maximum and its adjacent fitted minimum — so the pair spans
half a fitted swing period by construction, and SHALL NOT select it by scanning the raw trace for
extrema. The picture is captioned as one swing, top against bottom, and a pair chosen off the raw
trace depicts drift that the reported travel explicitly removes, and need not lie one half-swing
apart. Because the pair sits at the fitted FUNDAMENTAL's extremes rather than at the travel's
maximum and minimum, it MAY span somewhat less than the reported per-stride travel, which also
counts the swing's harmonic shape. One pair is emitted per MEASURED arm: two for a both-arms
reading, the near arm's alone for a near-arm reading.

Because the fitted series is the scale-stabilized `wrist.y − shoulder.y` in image-y, which grows
downward — the stabilizing divisor is positive by construction, so it preserves this sign
convention — the fitted MAXIMUM is the wrist at its LOWEST on screen; the system SHALL name the
pair by body position rather than by extremum kind, so that a caption cannot state the opposite of
the truth.

Both rules are stated of the shared per-side exemplar builder rather than of any one metric,
because every consumer of that builder inherits them: a pair scanned off the raw trace contradicts
the number printed beside it, and reading the extremum kind straight through produces a caption
that says the exact opposite of what the image shows, while passing every type check.

#### Scenario: The pair spans a half-cycle, not a sub-cycle wiggle

- **WHEN** an arm-swing exemplar is emitted for a side on a clip with a fitted swing rhythm
- **THEN** the interval between that exemplar's `timestamp` and its `pairedTimestamp` is half that
  side's fitted swing period, to within the clip's own frame interval

#### Scenario: The base instant is the wrist at its highest

- **WHEN** an arm-swing exemplar is emitted for a side
- **THEN** its `timestamp` names the frame where that side's wrist sits higher on screen relative
  to its shoulder, and its `pairedTimestamp` the frame where it sits lower

## REMOVED Requirements

### Requirement: Arm swing amplitude is a metric reporting the mean of the two arms' fitted swing amplitudes as a fraction of torso length

**Reason**: The value is no longer the fitted fundamental's peak-to-peak — the fundamental of a
non-sinusoidal swing carries ~55–75% of the wrist's visible travel — and a side clip now reads one
arm, so "the mean of the two arms" no longer holds in every view. The "step-rate harmonic"
scenario is retired with it: inside a stride window, 2nd-harmonic content is real
wrist-relative-to-shoulder travel and is now counted.

**Migration**: Superseded by "Arm swing amplitude reports per-stride wrist travel as a fraction of
torso length".

### Requirement: Arm swing amplitude is front-view-primary, hard-gated away from side view

**Reason**: Side view is no longer hard-gated away: the near arm is read alone, tolerated at 0.6
(the original design's D6 reversed for side only, user approval 2026-10-27).

**Migration**: Superseded by "Arm swing amplitude is front-view-primary and reads the near arm
alone from side view".
