# form-heuristics — delta

## ADDED Requirements

### Requirement: A footstrike's ankle position is measured only where the two ankles are separated

The system SHALL annotate every emitted footstrike with whether its ANKLE POSITION may be read, and
SHALL determine that from the **vertical** separation between the two ankles at that instant,
required to be at least a configurable fraction of torso length.

Running has no double-support phase, so at a real touchdown one foot is on the ground and the other
is mid-swing and the two ankles are near MAXIMAL separation — the same premise the ankle-difference
detector is built on. Two ankles at the same height at a predicted touchdown therefore say the pose
is not a contact, or that both labels have latched onto one foot. Measured on the side-view track
clip, both: at one emitted instant the two "detected" ankles sat 3 px apart horizontally and 23 px
vertically, both on the trailing swing foot while the planted foot was at the frame edge, and
overstriding read the foot landing 72% of a torso length BEHIND the hip.

The separation SHALL be measured VERTICALLY and SHALL NOT be measured horizontally. Horizontal
separation distinguishes the feet only on a side view: face-on the feet separate mostly in depth,
which projects to almost nothing in image-x, so a horizontal rule would delete the whole sample on a
front-view clip and withhold the three metrics that clip is the primary view for.

Unlike the neighbouring footstrike-eligibility requirement — which states that it SHALL NOT
introduce a configurable value, because an instant either has a sampled frame either side of it or
it does not — this rule **SHALL** carry a configurable threshold. It compares a measured magnitude
against a floor, and that floor SHALL be derived from measurement on this repo's own footage rather
than chosen, SHALL be expressed as a fraction of torso length so it is scale-free, and SHALL be
recorded with the margin it clears on each side.

Where either ankle is unresolvable the separation is undecidable and the instant SHALL be treated as
measurable. There is then no evidence that the pose has collapsed, and refusing on missing data
would be a different claim from the one this rule makes.

The rule SHALL NOT read whether either ankle was interpolated. Interpolation is neither sufficient
nor necessary — on the same clip one collapsed instant has both ankles detected and another has both
interpolated — and it is already priced, separately and proportionally, by the shared
interpolated-fraction penalty.

The rule SHALL apply to the phase-derived timing path only, and SHALL NOT apply to the
ankle-difference detector. That detector selects the prominence-confirmed maxima of the difference
between the two ankles' vertical positions, which is the identical quantity, against a threshold
already scaled by torso length — it has vetted ankle separation as its selection criterion. Adding a
second floor there would gate one quantity through two configurable constants that could disagree.
The phase path makes no claim about the pose at all, which is the whole of the gap this rule covers.

An annotated instant SHALL still be emitted, at the same frame, with the same timestamp and the same
side: the annotation SHALL NOT remove it from the footstrike list. The four metrics that read an
ankle AT a strike — overstriding, foot strike pattern, step width, and step width in centimetres —
SHALL skip an unmeasurable strike; **stride length SHALL NOT**, because it reads only timestamps and
hip-mid positions, neither of which an ankle-label collapse touches. Removing such strikes from the
list outright was measured taking the side-view clip from two same-side pairs to none and nulling
vertical ratio.

A skipped strike SHALL remain in the coverage denominator of each metric that skips it, on the same
terms as a strike whose hip was unresolvable: a collapsed ankle pair is an ankle that failed to
resolve while presenting as resolved. The consequence — that the thinning is priced twice, once
through coverage and once through the sample-size factor — is the pre-existing behaviour for that
denominator and SHALL be preserved rather than special-cased.

The rule SHALL be evaluated after the side-attribution vote, so that vote continues to see every
instant's ankle separation as the magnitude weight it already uses. It SHALL NOT be evaluated on
that vote's input: a clip whose every instant is unmeasurable would then leave the vote with no
evidence, and the system would fall back to the ankle-difference detector — silently changing which
detector timed the whole clip.

This rule SHALL NOT be described, in specification or in code, as addressing the failure in which a
detector places BOTH ankles far from the hip while leaving them far apart from EACH OTHER. A
mutual-separation predicate is blind to that by construction, at any threshold.

#### Scenario: A collapsed strike contributes no ankle measurement

- **GIVEN** a clip whose footstrikes are timed from the fitted hip-bounce phase, and one emitted
  instant at which the two ankles sit closer together vertically than the configured fraction of
  torso length
- **WHEN** overstriding, foot strike pattern, step width or step width in centimetres is computed
- **THEN** that strike contributes no value to the metric's sample
- **AND** it still counts toward that metric's coverage denominator

#### Scenario: The same strike still contributes a stride pair

- **GIVEN** the same clip and the same instant
- **WHEN** stride length is estimated
- **THEN** the pair containing that instant is measured and its hip-mid displacement is unchanged

#### Scenario: An unresolvable contralateral ankle does not gate the strike

- **GIVEN** a clip in which one ankle is unresolvable at an emitted instant, so the separation
  between the two is undecidable
- **WHEN** footstrikes are detected
- **THEN** that instant is annotated measurable

#### Scenario: A well-separated strike is untouched

- **GIVEN** a clip whose emitted instants all carry an ankle separation at or above the configured
  fraction of torso length
- **WHEN** footstrikes are detected
- **THEN** every instant is annotated measurable, and every metric reports what it reported before
  this rule existed

#### Scenario: The emitted footstrike list is unchanged

- **GIVEN** any clip, with or without collapsed ankle pairs
- **WHEN** footstrikes are detected
- **THEN** the emitted instants, their frames, their timestamps and their sides are exactly what the
  same clip emitted before this rule existed

#### Scenario: A clip whose every strike is unmeasurable does not change detector

- **GIVEN** a clip whose hip-bounce fit clears the fit-quality bar and whose every predicted instant
  carries an ankle separation below the configured fraction
- **WHEN** footstrikes are detected
- **THEN** the phase-derived instants are still the ones reported, each annotated unmeasurable
- **AND** the system does not fall back to the ankle-difference detector

#### Scenario: The ankle-difference detector is exempt

- **GIVEN** a clip with no fittable hip bounce, so footstrikes come from the ankle-difference
  detector, and emitted strikes whose ankle separation is below the configured fraction
- **WHEN** footstrikes are detected
- **THEN** every emitted strike is annotated measurable

## MODIFIED Requirements

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

This path SHALL make no claim about the POSE at the instant it predicts. It reads the hip's fitted
rhythm and snaps a prediction to the nearest sampled frame; whether the body at that frame looks
like a foot arriving is a question it does not ask, and the ankles enter only to name the feet. The
system SHALL therefore subject instants from this path — and from this path only — to the
ankle-separation rule stated separately, which annotates rather than removes them.

Instants from this path are subject to the footstrike-eligibility rule stated separately, which is
applied after the choice of path rather than inside this one. Because eligibility is evaluated after
that choice, it SHALL NOT alter the fallback condition above: a clip whose phase-derived instants
are ALL boundary instants has still produced instants, so it SHALL report no footstrikes rather than
falling back to the ankle-difference detector. This path reaches a boundary only when a predicted
touchdown happens to fall within the snapping tolerance of an end of the sampled span, which is a
coincidence of where the fitted phase sits and not a mechanism.

#### Scenario: A touchdown is placed a quarter period before the body's fitted low point

- **GIVEN** a clip whose hip-bounce fit clears cadence's fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** each emitted instant sits a quarter of the fitted period before one of the fitted
  waveform's low points
- **AND** exactly one instant is emitted per bounce cycle inside the analysed span, save for a cycle
  whose instant snaps to the first or last sampled frame

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

Stride length SHALL be measured from every emitted footstrike, including one whose ankle position
the ankle-separation rule marks unmeasurable. A stride pair is made of two timestamps and two
hip-mid positions, and an ankle-label collapse is evidence about neither; skipping such a strike
here would remove a measurement on the strength of a defect that does not touch it. This is the one
consumer of footstrikes that SHALL ignore that annotation, and it SHALL be stated at the call site
so the asymmetry with the four ankle-reading metrics reads as deliberate.

#### Scenario: A pair with an unmeasurable-ankle endpoint still contributes

- **GIVEN** a clip in which one endpoint of a same-side consecutive footstrike pair is marked
  unmeasurable by the ankle-separation rule
- **WHEN** stride length is estimated
- **THEN** that pair still contributes, and its hip-mid displacement is identical to what the same
  clip reports with the two ankles at that instant left alone

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
