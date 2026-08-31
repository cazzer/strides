## MODIFIED Requirements

### Requirement: Footstrikes are ground-contact onsets detected between the two ankles

When footstrike timing is not derived from the fitted hip-bounce phase — because the fit failed,
fell below cadence's fit-quality bar, or yielded no attributable instant — the system SHALL detect
footstrike candidates from each ankle's vertical position **relative to the opposite ankle**, not
from that ankle's raw screen position, and the instants it emits SHALL be ground-contact onsets —
the moment a foot arrives — rather than the frame within stance at which that ankle happened to read
lowest.

A single ankle's screen y carries both the leg's own configuration and the whole body's vertical
motion, which every keypoint shares. Differencing the two ankles removes that second term wherever
the two feet are in the same state, and in particular removes the airborne-versus-airborne component
and any common vertical camera motion. It does NOT remove it during single support, where one foot
is planted and the other is not — that residual is the subject of the next requirement, and the
system SHALL NOT attempt to suppress it by changing the prominence threshold. The system SHALL NOT
introduce a new configurable threshold, and SHALL NOT retune `footstrikeMinProminenceRatio` or
`footstrikeMinIntervalSeconds`: both SHALL be read exactly as they were, against the differenced
signal.

A candidate on the differenced signal SHALL additionally be rejected when the striking ankle sits
**above** the opposite ankle at that instant, since a foot cannot be planted while the other foot is
below it. This check SHALL have no tolerance parameter, and SHALL NOT be applied on the fallback
series described below, where the value being compared is a screen coordinate whose sign carries no
such meaning.

A frame in which either ankle is unresolvable SHALL be treated as a gap, on the same terms the
extremum scan already applies to a gap: runs either side of it are scanned independently and no
extremum is paired or smoothed across it. When the opposite ankle is resolvable in **no** frame of
the clip, there is no contralateral reference at all and the system SHALL fall back to that ankle's
raw vertical position, preserving the behaviour that predates this requirement for a single-leg
trace.

This detector SHALL NOT be retuned, offset, or otherwise adjusted in an attempt to correct its
phase. Its emitted instant is the contralateral foot's swing apex, which trails touchdown by an
amount set by the runner's own swing mechanics and spanning more than a whole stance phase across
ordinary runners; that is a property of the signal, and no constant offset can be correct for every
runner.

Candidates from this detector are subject to the footstrike-eligibility rule stated separately,
which is applied once — after the choice between this detector and the phase-derived timing — and
therefore covers both identically. This detector reaches the analysed series' boundary **by
construction** rather than by chance: the extremum scan emits an unconfirmed trailing pivot at the
end of every run, and selection then ranks candidates by descending amplitude, so a boundary pivot
sitting on a contaminated frame is reached FIRST rather than merely included. The system SHALL NOT
suppress that pivot inside the extremum scan, whose prominence guarantee is correct and is not a
claim that the pivot is a ground contact.

#### Scenario: A trailing leg's airborne ankle-y maximum is not a footstrike

- **GIVEN** a clip in which one leg's raw ankle-y series carries a prominence-confirmed maximum
  while that foot is in the air, during the other foot's stance, because the body was descending
  faster than the swinging foot was rising
- **WHEN** footstrikes are detected
- **THEN** that instant is not emitted as a footstrike candidate
- **AND** every true touchdown in the clip is still emitted, one per foot per stride, alternating
  feet, except any touchdown falling on the first or last frame of the analysed series

#### Scenario: A contact is reported at its onset, not at the end of its stance plateau

- **GIVEN** a clip in which a planted foot's raw ankle-y series is a flat plateau across stance, so
  that its argmax is decided by the extremum scan's tie handling rather than by the gait
- **WHEN** footstrikes are detected
- **THEN** the emitted instant for that contact is within a small, bounded number of sampled frames
  of the touchdown that begins the plateau, rather than at the plateau's late-stance end

#### Scenario: A clean signal with no secondary maxima is unaffected

- **GIVEN** a clip in which each ankle's raw vertical position already has exactly one
  prominence-confirmed maximum per stride, at that foot's own touchdown
- **WHEN** footstrikes are detected
- **THEN** the same set of contacts is emitted, one per foot per stride, alternating feet, each
  within a small, bounded number of sampled frames of its touchdown, except any contact falling on
  the first or last frame of the analysed series

#### Scenario: A footstrike is never attributed to the higher of the two feet

- **WHEN** footstrikes are detected on a clip where both ankles are resolvable
- **THEN** at every emitted candidate's frame, the striking side's ankle is at or below the opposite
  side's ankle

#### Scenario: A clip with only one resolvable ankle falls back to that ankle's own trace

- **GIVEN** a clip in which one side's ankle is unresolvable in every frame
- **WHEN** footstrikes are detected
- **THEN** the resolvable side is detected from its own raw vertical position, exactly as it was
  before this requirement
- **AND** no candidate is emitted for the unresolvable side

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

## ADDED Requirements

### Requirement: A footstrike candidate requires a sampled frame on both sides of it

The system SHALL NOT emit a footstrike candidate on the first or on the last frame of the analysed
frame series.

The evidence for a ground contact is a REVERSAL — the striking ankle stops descending, the two
ankles stop separating, the fitted vertical trajectory changes the sign of its curvature — and a
reversal is a statement about what happened before an instant AND about what happened after it. At
the first or last sampled frame only one side exists, so what would be emitted there is not a
confirmed contact but whatever the series was doing when the data ran out. The instant may well be a
real touchdown; the clip contains no evidence either way, and every consumer treats each emitted
instant as equally evidenced.

This rule SHALL have **no threshold, no tolerance and no weight**: it is not "near the edge", not a
distance in seconds, and not a confidence discount. An instant either has a sampled frame on each
side of it or it does not. The system SHALL NOT introduce a configurable value for it.

The boundary SHALL be that of the frame series each heuristic is computed over, which is the
**presence-trimmed** window — so the excluded frames are the edges of the subject's own presence in
the clip, not the edges of the recording.

The rule SHALL be applied **after the choice** between the phase-derived timing and the
ankle-difference detector, so that both are covered identically and the system cannot hold two
opinions about eligibility. It SHALL NOT be evaluated before that choice is made — doing so would
silently redefine the documented fallback condition from "the phase path produced no instant at all"
to "the phase path produced no instant away from the boundary".

The rule SHALL be applied **after** the side-attribution vote. That vote is a single
magnitude-weighted decision over every instant, and a boundary instant's ankle separation is real
evidence about which foot is which even though its timing is unconfirmable; the two are separate
claims about the same frame, and only the timing one is unsupported.

On the ankle-difference detector the rule SHALL **additionally** be applied to the candidate extrema
**before** they are ranked by amplitude. That detector selects greedily in descending order of
contact-series value, each accepted candidate excluding every same-side candidate within the spacing
floor of it, so an ineligible candidate that outranks a real contact would suppress that contact and
only then be discarded — deleting a confirmed interior ground contact in exchange for an
unconfirmable boundary one, and thinning the very sample the step-width minimum below exists to
price. This SHALL be the same rule and the same single definition, applied at a second enforcement
point; it SHALL NOT be a second, separately-stated rule that could diverge from the first.

Because the exclusion is performed in the detector, every consumer of footstrikes — overstriding,
foot-strike pattern, step width, step width in centimetres and stride length — receives the reduced
list without restating the rule, and each consumer's own description of what it aggregates over
remains literally true.

#### Scenario: A candidate on the last sampled frame is not emitted

- **GIVEN** a clip whose detector yields a candidate on the final frame of the analysed series,
  carrying a larger amplitude than any interior candidate
- **WHEN** footstrikes are detected
- **THEN** that candidate is not emitted
- **AND** the interior candidates are emitted unchanged, at the same frames and with the same sides

#### Scenario: A candidate on the first sampled frame is not emitted

- **GIVEN** a clip whose detector yields a candidate on the first frame of the analysed series
- **WHEN** footstrikes are detected
- **THEN** that candidate is not emitted, and the interior candidates are emitted unchanged

#### Scenario: An ineligible candidate cannot suppress a real contact before being dropped

- **GIVEN** a clip on the ankle-difference detector carrying a confirmed interior contact and, on a
  boundary frame, a candidate of GREATER amplitude within the same-side spacing floor of it
- **WHEN** footstrikes are detected
- **THEN** the interior contact is emitted, and the boundary candidate is not
- **AND** the clip does not report an empty footstrike list

#### Scenario: Both detectors are covered identically

- **GIVEN** one clip whose footstrikes come from the ankle-difference detector, which reaches a
  boundary at the end of every run by construction, and another whose footstrikes come from the
  phase-derived timing, whose fitted phase happens to predict a touchdown on the final sampled frame
- **WHEN** footstrikes are detected on each
- **THEN** neither clip emits a candidate on its first or last frame

#### Scenario: A clip whose only candidates are boundary candidates reports no footstrikes

- **GIVEN** a clip whose every detected candidate sits on the first or last frame of the analysed
  series
- **WHEN** footstrikes are detected
- **THEN** no footstrikes are reported, rather than the instant the series happened to end on

### Requirement: Step width discounts a thin footstrike sample rather than withholding it

The system SHALL treat **seven** detected footstrikes as step width's minimum sample size, and below
it SHALL report the value discounted rather than withheld: confidence multiplied by
`sampleSize / minimum` through the shared confidence product, plus a caveat naming both the count
observed and the count recommended. The system SHALL NOT return `null` on account of sample size
alone.

The minimum's SHAPE SHALL be derived rather than chosen, and the one quantity that is chosen SHALL be named as such. Step width reduces its per-strike offsets with a median,
and contamination on this corpus is one-sided — a degenerate or unconfirmable strike inflates the
offset rather than scattering it — so `k` contaminants occupy the top `k` ranks of `n` samples. The
median is untouched by them exactly when the middle of the sorted array still lies strictly inside
the clean subsample: `(n + 1) / 2 < n − k` for odd `n`, giving `n >= 2k + 2`, and `n / 2 + 1 < n − k`
for even `n`, giving `n >= 2k + 3`. The even case binds, so the requirement is **`n >= 2k + 3`**.

`k = 2` SHALL be recorded as a **judgment call**, distinct from the derivation above and not blended
into it. Its grounds are that two independent contamination mechanisms are documented on this
corpus — a footstrike at the analysed series' boundary, and a detector-dropout window in which
surviving detections collapse both ankles onto one point — and that the only clip whose per-strike
ratios have been measured carried exactly two contaminants among five strikes.

The bound SHALL NOT be read as promising the clean sample's median: `2k + 3` is the point at which
contaminants stop reaching the middle slot, not the point at which they stop shifting it.

The system SHALL keep the median. It SHALL NOT substitute a trimmed statistic, whose trimming at
these sample sizes would discard a large fraction of an already-thin sample to make a second, weaker
guess at contamination the eligibility rule above removes upstream. It SHALL NOT change the shape of
the shared confidence product, whose sample-size factor saturates at one so that a large sample
cannot raise confidence above what the other factors allow. Sibling metrics' own minimum sample sizes
are outside this requirement and SHALL NOT be changed by it.

#### Scenario: A five-strike clip reports at five sevenths of what its other factors allow

- **GIVEN** a clip yielding five usable footstrikes, viewed from the metric's primary camera angle,
  with full frame coverage and nothing interpolated
- **WHEN** step width is computed
- **THEN** a non-null value is returned, and its confidence is exactly five sevenths

#### Scenario: A thin sample is caveated with both the count and the recommendation

- **WHEN** step width is computed against a clip yielding fewer footstrikes than the minimum
- **THEN** the result carries a non-null caveat naming how many footstrikes were detected and how
  many are recommended

#### Scenario: A sample at or above the minimum carries neither the discount nor the caveat

- **GIVEN** a clip yielding at least the minimum number of usable footstrikes, otherwise as above
- **WHEN** step width is computed
- **THEN** confidence is not reduced on account of sample size, and no sample-size caveat is emitted

#### Scenario: Step width is never withheld for sample size alone

- **WHEN** step width is computed against a clip yielding at least one usable footstrike but fewer
  than the minimum
- **THEN** `value` is non-null and `confidence` is greater than zero
