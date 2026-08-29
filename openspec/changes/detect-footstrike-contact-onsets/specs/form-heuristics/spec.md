## ADDED Requirements

### Requirement: Footstrikes are ground-contact onsets detected between the two ankles

The system SHALL detect footstrike candidates from each ankle's vertical position **relative to the
opposite ankle**, not from that ankle's raw screen position, and the instants it emits SHALL be
ground-contact onsets — the moment a foot arrives — rather than the frame within stance at which
that ankle happened to read lowest.

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

Differencing the two ankles does not remove the whole body's vertical motion from the contact
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

#### Scenario: A body-motion artifact inside a stance is not emitted

- **GIVEN** a clip whose contact series carries more than one prominence-confirmed maximum within a
  single stance, the extra one arising from the body's vertical motion rather than from a foot
  arriving
- **WHEN** footstrikes are detected
- **THEN** only the largest maximum in that stride window is emitted for that side
- **AND** the emitted instant is the ground contact rather than the artifact

#### Scenario: Two same-side candidates closer than one plausible stride cannot both be emitted

- **WHEN** footstrikes are detected on a clip whose step rhythm could be fitted
- **THEN** no two candidates on the same side are closer together than the shortest interval that
  could be a single stride at that rhythm

#### Scenario: A clip with no fittable step rhythm keeps the configured interval floor

- **GIVEN** a clip whose hip-bounce fit fails or falls below cadence's own fit-quality bar
- **WHEN** footstrikes are detected
- **THEN** the minimum spacing between candidates is the configured minimum footstrike interval,
  exactly as it was before a rhythm-derived floor existed
