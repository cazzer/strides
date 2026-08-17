## MODIFIED Requirements

### Requirement: Every sample belongs to exactly one segment

The system SHALL partition the sample indices into contiguous, non-overlapping segments that cover
the entire clip: the first segment SHALL extend back to the first sample and the last SHALL extend
forward to the final sample, so that samples carrying no usable detection — leading, trailing, or
interior — belong to whichever segment contains them rather than to none.

#### Scenario: Leading and trailing undetected samples belong to the outermost segments

- **WHEN** a clip begins and ends with samples carrying no detection
- **THEN** the first segment's span starts at the first sample and the last segment's span ends at
  the final sample, and consecutive segments abut without overlapping

#### Scenario: A frame with a detection but no derivable box rides with its segment

- **WHEN** a sample carries a detection from which no bounding box can be derived
- **THEN** it neither starts nor cuts a segment and contributes nothing to its segment's score;
  it survives only where that segment wins AND has box evidence around it, and is nulled otherwise

## ADDED Requirements

### Requirement: An unverifiable detection survives only inside the winner's evidenced interior

A detection carrying too few confident keypoints to yield a bounding box is never area-checked and
never continuity-checked — nothing about it has been verified, and it is the least able of all
detections to justify itself. The system SHALL therefore keep such a detection only where it lies
within the winning segment's EVIDENCED INTERIOR — the closed interval between that segment's first
and last surviving detection, the span it has actual box evidence for — and SHALL null it
everywhere else, including inside the winning segment's partition span but beyond either end of
that interval.

This bounds the asymmetry rather than removing it. WITHIN the evidenced interior an unverifiable
detection is still kept unchecked, so an intruder there is still nulled when it yields a box the
area floor rejects and still kept when it yields none at all. That residue is deliberate: the
interval is the only bound available that the segmentation bounds do not already answer, and a
second proximity threshold governing the same question would cost more than the residue it removes.

Nulling stays total. Every frame outside the winning segment is nulled exactly as before, and the
partition still decides which segment a frame belongs to, so the property that every sample belongs
to exactly one segment is untouched. Only the survival of an unverifiable frame narrows.

The system SHALL report how many detections were nulled for lying outside the evidenced interior,
separately from those nulled by the area floor and from those nulled for belonging to a losing
segment, so that a run where this rule fired is distinguishable from one where it had nothing to
do.

#### Scenario: A boxless frame inside the evidenced interior still rides with its segment

- **WHEN** a sample yielding no bounding box sits between two surviving detections of the winning
  segment
- **THEN** it is returned as the very same object the caller passed in, and no rejection of any
  kind is counted for it

#### Scenario: A boxless frame beyond the winner's box evidence is nulled

- **WHEN** a sample yielding no bounding box lies inside the winning segment's partition span but
  before its first surviving detection or after its last
- **THEN** its frame is nulled, and it is counted among the detections nulled outside the evidenced
  interior rather than among those nulled for belonging to another segment

#### Scenario: Fewer confident keypoints no longer buys survival

- **WHEN** the same intruding detection appears outside the winner's evidenced interior twice —
  once with enough confident keypoints to yield a bounding box that falls below the area floor, and
  once with too few confident keypoints to yield a box at all
- **THEN** both are nulled, so a detection can no longer escape the floor's protection by being
  less verifiable than one the floor rejects

#### Scenario: A winner with a single surviving detection has a single-index interior

- **WHEN** the winning segment contains exactly one surviving detection, with boxless samples
  before and after it inside its partition span
- **THEN** only that one detection survives and every boxless sample around it is nulled, because
  the evidenced interval is that index alone

#### Scenario: The evidenced interior is never empty

- **WHEN** any segment wins
- **THEN** it contains at least one surviving detection, because a segment is only ever started at
  one, so the interval is always well-defined and the rule can never null a whole winning segment
