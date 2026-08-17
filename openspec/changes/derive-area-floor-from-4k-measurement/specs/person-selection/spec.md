## MODIFIED Requirements

### Requirement: A minimum bounding-box area floor rejects noise before segmentation

The system SHALL reject any derived bounding box whose area falls below a configured minimum — or
whose area is not a finite number at all — in EVERY segment including the winning one, and such a
rejection SHALL NOT start a segment, cut a segment, or contribute to any segment's score. The count
of these rejections SHALL be reported separately from rejections caused by losing a segment.

The configured minimum SHALL be derived from measurement on real footage rather than assumed. It
SHALL exceed the largest spurious detection measured at the highest capture resolution the system
is exercised against, and SHALL remain below the smallest genuine subject detection measured at
every such resolution, so that the floor rejects noise at the resolution where noise is largest
without rejecting a distant real subject at any resolution.

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

#### Scenario: A detection at the largest measured spurious size is rejected at 4K frame area

- **WHEN** a clip at 4K frame area carries a spurious detection as large as the largest one
  measured on real footage at that frame area, sitting apart from and discontinuous with the
  subject's own track
- **THEN** it is counted among the floor rejections rather than forming a segment of its own, so
  the subject's track stays a single segment with no losing-segment rejections

#### Scenario: The smallest measured genuine subject survives at every exercised frame area

- **WHEN** a clip carries a detection as small as the smallest genuine subject measured on real
  footage at that frame area, continuous with the rest of the subject's track
- **THEN** it clears the floor and survives, at every frame area the floor was derived against —
  so raising the floor further than the measurement supports is a detectable regression rather
  than a silent one
