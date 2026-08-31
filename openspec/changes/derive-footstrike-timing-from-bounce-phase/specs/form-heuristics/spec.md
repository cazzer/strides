# form-heuristics — delta

## ADDED Requirements

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

#### Scenario: A touchdown is placed a quarter period before the body's fitted low point

- **GIVEN** a clip whose hip-bounce fit clears cadence's fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** each emitted instant sits a quarter of the fitted period before one of the fitted
  waveform's low points
- **AND** exactly one instant is emitted per bounce cycle inside the analysed span

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

#### Scenario: A trailing leg's airborne ankle-y maximum is not a footstrike

- **GIVEN** a clip in which one leg's raw ankle-y series carries a prominence-confirmed maximum
  while that foot is in the air, during the other foot's stance, because the body was descending
  faster than the swinging foot was rising
- **WHEN** footstrikes are detected
- **THEN** that instant is not emitted as a footstrike candidate
- **AND** every true touchdown in the clip is still emitted, one per foot per stride, alternating
  feet

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
  within a small, bounded number of sampled frames of its touchdown

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

### Requirement: Footstrike candidates are selected by amplitude at the clip's own stride rhythm

When footstrikes are detected between the two ankles rather than from the fitted hip-bounce phase,
differencing the two ankles does not remove the whole body's vertical motion from the contact
series, and cannot: during single support the planted foot carries none of that motion and the
swinging foot carries all of it, so the term survives inverted and at full strength. The system
SHALL therefore treat prominence as deciding only whether a sample is a turning point, and SHALL
decide which turning points are ground contacts by a separate rule.

Among a side's admissible maxima the system SHALL accept candidates in **descending order of
contact-series value**, each accepted candidate excluding every remaining candidate within a
minimum spacing of it, and SHALL return the survivors in time order. Ties SHALL resolve toward the
earlier instant. This ordering SHALL be used because a ground contact sits at the full separation
between the two legs while the surviving body-motion artifacts are the size of the runner's own
vertical oscillation — a difference in amplitude, not in local prominence.

The minimum spacing SHALL be the longer of the configured minimum footstrike interval and the
shortest interval that could still be a single stride at the clip's own fitted step frequency,
namely `(2 / stepFrequencyHz) / (1 + tolerance)` using the same tolerance and the same
`2 / stepFrequencyHz` derivation the stride-pair period gate applies. Deriving it as that gate's
lower band edge SHALL be preserved rather than restated as an independent number, so that this
selection can never remove a same-side pair the period gate would have accepted.

The fitted step frequency SHALL be used only when it clears the same fit-quality bar cadence itself
requires before reporting a value; below that bar the system SHALL fall back to the configured
minimum footstrike interval alone, which is the behaviour that predates this requirement.

The system SHALL NOT rescale the prominence threshold to compensate for the differenced signal.

When footstrikes are timed from the fitted hip-bounce phase instead, this amplitude selection SHALL
NOT run, and the same-side spacing it enforces SHALL hold by construction: consecutive same-side
instants are two fitted bounce periods — one stride — apart.

#### Scenario: A body-motion artifact inside a stance is not emitted

- **GIVEN** a clip whose contact series carries more than one prominence-confirmed maximum within a
  single stance, the extra one arising from the body's vertical motion rather than from a foot
  arriving
- **WHEN** footstrikes are detected
- **THEN** the artifact is not emitted for that side
- **AND** the ground contact it sits inside is

#### Scenario: Two same-side candidates closer than one plausible stride cannot both be emitted

- **WHEN** footstrikes are detected on a clip whose step rhythm could be fitted
- **THEN** no two candidates on the same side are closer together than the shortest interval that
  could be a single stride at that rhythm

#### Scenario: A clip with no fittable step rhythm keeps the configured interval floor

- **GIVEN** a clip whose hip-bounce fit fails or falls below cadence's own fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** the minimum spacing between candidates is the configured minimum footstrike interval,
  exactly as it was before a rhythm-derived floor existed
