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
  it survives only where that segment wins AND has box evidence around it, and there only as
  "A boxless detection inside the evidenced interior must be position-continuous with an adjacent
  box" allows; it is nulled otherwise

### Requirement: An unverifiable detection survives only inside the winner's evidenced interior

A detection carrying too few confident keypoints to yield a bounding box is never area-checked and
never continuity-checked — nothing about it has been verified, and it is the least able of all
detections to justify itself. The system SHALL therefore keep such a detection only where it lies
within the winning segment's EVIDENCED INTERIOR — the closed interval between that segment's first
and last surviving detection, the span it has actual box evidence for — and SHALL null it
everywhere else, including inside the winning segment's partition span but beyond either end of
that interval.

Inside the evidenced interior a boxless detection is no longer kept unchecked: it must also satisfy
"A boxless detection inside the evidenced interior must be position-continuous with an adjacent
box", which nulls and separately counts the ones that are not.

Nulling stays total. Every frame outside the winning segment is nulled exactly as before, and the
partition still decides which segment a frame belongs to, so the property that every sample belongs
to exactly one segment is untouched. Only the survival of an unverifiable frame narrows.

The system SHALL report how many detections were nulled for lying outside the evidenced interior,
separately from those nulled by the area floor and from those nulled for belonging to a losing
segment, so that a run where this rule fired is distinguishable from one where it had nothing to
do.

#### Scenario: A boxless frame inside the evidenced interior still rides with its segment

- **WHEN** a sample yielding no bounding box sits between two surviving detections of the winning
  segment, and is position-continuous with an adjacent surviving detection or has no confident
  non-head, non-foot keypoint
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

## ADDED Requirements

### Requirement: A boxless detection inside the evidenced interior must be position-continuous with an adjacent box

For a detection inside the winning segment's evidenced interior that yields no bounding box, the
system SHALL form the hull of its confident keypoints, using the same per-keypoint confidence floor
and the same excluded keypoints as the stage's bounding boxes but requiring only one keypoint. When
that hull is empty the detection SHALL be kept. Otherwise the system SHALL keep it only when the
hull touches (closed-interval overlap), overlaps, or lies within the stage's existing
centre-speed bound of the nearest surviving detection before it or the nearest surviving detection
after it, judged over the elapsed time to that detection. A detection that passes against neither
SHALL have its frame nulled.

The check SHALL add no tunable: it reuses the segmentation stage's centre-speed bound and applies
no area-ratio test, since a hull over too few keypoints to yield a box says how many joints were
confident, not how far away the person is. It SHALL run after segmentation and scoring, so that it
can never change a segment, a declined cut, or the separation ratio.

The system SHALL report how many detections this check nulled, separately from those nulled by the
area floor, for belonging to a losing segment, or for lying outside the evidenced interior, and the
post-selection detection count SHALL subtract it.

#### Scenario: A far intruder between two runner detections is nulled and counted separately

- **WHEN** a detection with three confident keypoints far from the runner sits between two of the
  winning segment's surviving detections 0.05 s apart
- **THEN** its frame is nulled, it is counted only among detections nulled by this check, and the
  segments, segment count, declined-cut count and separation ratio equal those of the same clip with
  that sample undetected

#### Scenario: The runner's own sparse detection overlapping a neighbour is kept

- **WHEN** a boxless detection's confident-keypoint hull overlaps an adjacent surviving detection's
  box
- **THEN** it is returned as the very same object the caller passed in and nothing is counted for it

#### Scenario: A boxless detection with no confident non-head, non-foot keypoint is kept

- **WHEN** a boxless detection inside the evidenced interior has no non-head, non-foot keypoint
  above the confidence floor, wherever its keypoints lie
- **THEN** it is kept, because there is nothing to place

#### Scenario: A single-point hull inside or on a neighbour's box is kept

- **WHEN** a boxless detection's hull is a single point lying inside or on the edge of an adjacent
  surviving detection's box, so its overlap area with that box is zero
- **THEN** it is kept, because contact counts on its own

#### Scenario: The rejection counts account for every nulled detection

- **WHEN** a clip has detections nulled by the area floor, for belonging to a losing segment, for
  lying outside the evidenced interior, and by this check
- **THEN** the post-selection detection count equals the pre-selection count minus all four counts
