## ADDED Requirements

### Requirement: Segmentation judges shrinkage against the segment's recent peak

Besides the frame-to-frame scale test, the system SHALL cut a segment boundary before a surviving
detection whose box area, multiplied by `maxAreaRatio`, is smaller than the largest box area among
the segment's accepted detections within the preceding `shrinkReferenceWindowSeconds`. This applies
unless that detection's box is truncated by the frame edge (it comes within 2% of the frame's
shorter side of any edge). A frame declined by the splice tolerance never joins that history, and a
cut starts a fresh one. `shrinkReferenceWindowSeconds: 0` disables the rule. Growth is never judged
against the peak.

#### Scenario: A track walked down by small steps is not handed to a smaller person

- **WHEN** a segment's boxes shrink over a few frames, each step within `maxAreaRatio`, and the
  next detection is a fully visible box more than `maxAreaRatio` smaller than the segment's largest
  box in the last `shrinkReferenceWindowSeconds`
- **THEN** a segment boundary is cut before that detection

#### Scenario: A subject leaving through the frame edge stays one segment

- **WHEN** a segment's boxes shrink because the subject is leaving through a frame edge, and each
  shrunken box is truncated by that edge
- **THEN** no boundary is cut on account of the shrinkage

#### Scenario: Disabled window reproduces the frame-to-frame rule

- **WHEN** `shrinkReferenceWindowSeconds` is `0`
- **THEN** segmentation is identical to the frame-to-frame scale test alone
