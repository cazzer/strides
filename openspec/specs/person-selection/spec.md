# person-selection Specification

## Purpose
TBD - created by archiving change retroactive-person-selection. Update Purpose after archive.
## Requirements
### Requirement: A clip is collapsed to a single subject's frames

The system SHALL provide a pure function that takes a completed run's `PoseSample[]` (sorted
ascending by timestamp), the source clip's pixel dimensions, and a configuration object, and
returns a `PoseSample[]` of the same length carrying detections for at most ONE person, together
with a diagnostics object describing the decision. It SHALL NOT mutate its input or anything
reachable from it.

#### Scenario: A single continuous track is returned unchanged

- **WHEN** every detection in a clip is continuous with the one before it
- **THEN** exactly one segment is formed, every sample is returned unchanged, and the diagnostics
  report one segment with no rejections

#### Scenario: Output is one-for-one with input

- **WHEN** selection runs over any clip
- **THEN** the output has the same length as the input and the same timestamp at every index,
  whatever the input contained

#### Scenario: The input sequence is never mutated

- **WHEN** selection runs
- **THEN** the caller's `PoseSample[]`, and every frame and keypoint reachable from it, is
  byte-for-byte what it was before the call

### Requirement: Segments are cut at position, scale, and time discontinuities

The system SHALL start a new segment whenever a surviving detection fails a continuity test
against the previous surviving detection — where continuity is the SAME predicate the online
anchor gate uses (bounding-box overlap OR a centre displacement within a per-second speed bound,
AND a bounding-box area ratio inside a symmetric band) — or whenever more than a configured number
of seconds separates them, since across a long enough gap a speed bound permits any displacement
at all and stops meaning anything.

#### Scenario: A large scale change at the same position cuts a segment

- **WHEN** two consecutive surviving detections sit at the same centre but differ in area by more
  than the configured ratio
- **THEN** a segment boundary is cut between them, even though they overlap completely

#### Scenario: A position jump cuts only when it is too fast to be real

- **WHEN** two consecutive surviving detections are separated by a displacement that exceeds the
  speed bound for the elapsed time between them
- **THEN** a segment boundary is cut — and the SAME displacement over a long enough elapsed time,
  within the time-gap tolerance, does NOT cut

#### Scenario: A long silence cuts a segment regardless of geometry

- **WHEN** two consecutive surviving detections are geometrically continuous but separated by more
  than the configured maximum continuity gap in seconds
- **THEN** a segment boundary is cut between them

#### Scenario: An interior stretch of undetected frames does not cut a segment

- **WHEN** a run of samples with no detection separates two surviving detections that are
  continuous with each other and within the time-gap tolerance
- **THEN** no boundary is cut and both belong to the same segment

### Requirement: A minimum bounding-box area floor rejects noise before segmentation

The system SHALL reject any derived bounding box whose area falls below a configured minimum — or
whose area is not a finite number at all — in EVERY segment including the winning one, and such a
rejection SHALL NOT start a segment, cut a segment, or contribute to any segment's score. The count
of these rejections SHALL be reported separately from rejections caused by losing a segment.

#### Scenario: A detection with a non-finite bounding-box area is rejected, not selected

- **WHEN** a detection's derived bounding box has a non-finite area (every confident keypoint at
  non-numeric coordinates)
- **THEN** it is rejected exactly as a below-floor detection is — nulled, counted among the floor
  rejections, and neither starting nor cutting a segment — so it can neither win the clip on an
  infinite score nor suppress the separation ratio that would have flagged it

#### Scenario: Degenerate detections are discarded without splitting a real track

- **WHEN** a stretch of tiny, degenerate detections interrupts one person's otherwise continuous
  track
- **THEN** those detections are nulled, exactly one segment is formed across the whole track, and
  the count of floor rejections reflects them

#### Scenario: A sub-floor detection inside the winning segment is still rejected

- **WHEN** a detection below the floor occurs between two above-floor detections of the selected
  subject
- **THEN** that sample's frame is nulled in the output, even though its segment won

### Requirement: The area floor is a fraction of frame area, not an absolute pixel count

The system SHALL express the minimum bounding-box area as a fraction of the source frame's own
area (`width × height`) and resolve it to absolute square pixels per run, so that the same physical
subject at the same distance from the camera is judged identically regardless of capture
resolution. The resolved absolute floor SHALL be reported in the diagnostics.

#### Scenario: The same scene at two resolutions decides identically

- **WHEN** selection runs over two clips with identical geometry, one at a given resolution and one
  at twice its width and height with every coordinate doubled
- **THEN** the same segments are formed, the same frames are kept, and the same frames are rejected

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
  it survives if that segment wins and is nulled if it loses

### Requirement: Segments are scored by integrated bounding-box area

The system SHALL score each segment as the sum of bounding-box area across its surviving
detections, and SHALL select the highest-scoring segment as the person of interest. The
diagnostics SHALL report each segment's span, its surviving-detection count, its integrated area,
and its median area, sorted by integrated area descending so the winner is first, together with the
total segment count and the ratio between the top two segments' scores.

#### Scenario: A larger, longer-tracked subject wins over a smaller or briefer one

- **WHEN** a clip contains one segment of many large detections and others of few or small ones
- **THEN** the large, long segment is selected, and the reported separation ratio is its score
  divided by the runner-up's

#### Scenario: A single isolated detection can win when it is the only one

- **WHEN** exactly one sample in a clip carries an above-floor detection
- **THEN** it forms the one segment, wins, and survives into the output

#### Scenario: No separation ratio is reported for a single segment

- **WHEN** exactly one segment is formed
- **THEN** the reported separation ratio is null, because there is nothing to separate from

### Requirement: A rejected sample becomes a null frame, never another person's keypoints

The system SHALL replace every rejected sample's frame with `null`, preserving its timestamp, and
SHALL NEVER substitute a neighbouring pose, an interpolated pose, or any other person's keypoints
for it. Samples that survive SHALL be returned as the very same objects the caller passed in, not
copies.

#### Scenario: Rejected frames become real gaps

- **WHEN** samples are rejected, whether by the area floor or by losing a segment
- **THEN** each is exactly a timestamp with a null frame, so downstream interpolation treats it as
  missing data rather than as a fabricated position carrying a trusted status

#### Scenario: Surviving frames are identical objects, not equal copies

- **WHEN** samples survive selection
- **THEN** each output entry is reference-identical to its input entry

### Requirement: Selection fails open and never zeroes a clip that had detections

The system SHALL return the input samples untouched, with a typed reason, whenever it cannot make a
meaningful selection: when it is disabled, when the frame dimensions are unusable (zero, negative,
or non-finite), when no sample carries a detection, or when no detection clears the area floor. In
every such case the reported post-selection detection count SHALL equal the pre-selection count.

#### Scenario: Disabling the stage is a true no-op

- **WHEN** the stage is disabled
- **THEN** the input array is returned as-is, the diagnostics report a skip with the disabled
  reason, and no downstream stage can distinguish the run from one where the stage did not exist

#### Scenario: An unusable frame size skips rather than throwing

- **WHEN** the frame width or height is zero, negative, or non-finite
- **THEN** the input is returned untouched with the unknown-frame-size reason

#### Scenario: A clip whose every detection is below the floor is left alone

- **WHEN** detections exist but none clears the area floor
- **THEN** the input is returned untouched with the no-detection-above-floor reason, rather than a
  clip with every frame nulled

#### Scenario: An empty or wholly undetected clip does not throw

- **WHEN** the clip has no samples at all, or no sample carries a detection
- **THEN** the call returns normally with the no-detections reason

