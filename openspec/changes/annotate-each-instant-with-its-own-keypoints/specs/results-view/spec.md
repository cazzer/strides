## ADDED Requirements

### Requirement: A pair's joint layer draws each instant's own measured limb while the crop frames both

Where a ghosted pair's two instants were measured on different sides, the joint layer SHALL draw, at
each instant, the keypoints THAT instant's own measurement was about — and SHALL NOT draw the other
instant's. This is the sibling of "A measurement mark that needs a per-instant side is drawn on every
instant that states one": that requirement makes the amber measurement mark per-instant, and this one
makes the cyan joint layer per-instant, so the two layers of one image agree about which limb the
picture is about. A joint layer drawn from the union states that both limbs were measured at both
moments, in the same colour as the correct joints, with nothing on the image distinguishing them.

The drawn set SHALL be resolved from the exemplar's per-instant statement where the metric made one,
falling back to `cropKeypoints` where it did not — which is correct by construction on an exemplar
whose two sets coincide. It SHALL NOT be derived by filtering `cropKeypoints` downstream, because a
crop set legitimately names context belonging to neither instant's measurement.

**Narrowing the drawn set SHALL NOT remove any measurement mark.** A mark builder resolves its inputs
against the drawn set alone and returns nothing for a name that is absent — indistinguishably from a
keypoint the robustness layer lost — so a caliper, line or midpoint whose endpoint left the set would
be dropped silently, with no error and no coverage field recording it. Every mark the measurement
layer drew from the union SHALL still be drawn from the per-instant set, on every instant that drew
it before.

**The crop rectangle SHALL be unaffected.** The image must still contain both instants, so the crop
continues to be derived from the union across the pair. A change to which joints are drawn SHALL NOT
move, resize or re-aim the crop, and SHALL NOT change which exemplar or which pair was selected.

#### Scenario: Each half of a mixed-foot ghost shows only its own leg

- **WHEN** a ghosted pair whose two instants were measured on opposite feet is annotated
- **THEN** the base instant's joint marks name that instant's measured ankle and the hips, the ghost
  instant's name the other ankle and the hips, and no bone drawn at either instant touches the side
  that instant was not measured on

#### Scenario: Every measurement mark survives the narrowing

- **WHEN** the same pair is annotated from a plan carrying the per-instant sets and from one carrying
  only the crop set
- **THEN** the measurement-layer marks are the same roles on the same instants in both, and only the
  joint and bone marks differ

#### Scenario: The crop is unchanged by the per-instant sets

- **WHEN** a plan is built from an exemplar carrying per-instant annotation sets and from the same
  exemplar with those sets removed
- **THEN** the two plans' crop rectangles are identical
