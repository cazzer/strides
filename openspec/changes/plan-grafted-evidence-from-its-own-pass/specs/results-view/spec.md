# results-view

## ADDED Requirements

### Requirement: A grafted metric's evidence is planned from the frames that measured it

Where a completed background scale pass has replaced metrics on the displayed result, the system
SHALL retain that pass's own robust frames alongside the metrics it grafted, and SHALL plan those
metrics' evidence — the frames their timestamps resolve against, the crop derived from them, every
joint position an annotation draws, and every directional sign a mark's orientation is read from —
against **those** frames, not against the primary pass's.

Every metric the graft did not replace SHALL continue to be planned against the primary pass's
frames, unchanged. A run with no completed graft SHALL plan every metric exactly as it did before
this rule existed.

The scale pass's frames SHALL be committed in the **same** state write as the grafted metrics, so
that "these metrics came from the scale pass" and "here are the frames that measured them" are one
fact rather than two that can be observed apart. Their **presence** SHALL be what tells the planner
a graft occurred; the planner SHALL NOT infer it from a metric's identity alone, because a primary
pass that measures real-world scale itself grafts nothing and its centimetre metrics are already
planned against the frames that measured them.

Retaining those frames SHALL NOT change what the interface displays as the run's own frames: the
skeleton overlay, and every non-grafted metric, still read the primary pass's.

This is a statement about which detector's estimate an image asserts, not about tidiness. A frame
carries the joint positions an annotation draws AND the left/right ordering of the hips that a
lateral caliper's polarity is read from, and two detectors watching the same runner at the same
instant can order those hips oppositely — measured on this repo's own footage at 26% of the
side-view clip's instants and 17% of the multi-person clip's, against 0% of the front-approach
clip's, the difference tracking how far apart the two hips sit on screen. A polarity read off the
wrong pass's frame labels a crossover strike as landing on its own side.

The existing subject-agreement check SHALL NOT be treated as covering this. That check compares the
two passes' bounding boxes to decide whether they selected the same **person**; a bounding box is a
hull and is identical under a left/right relabelling, so the same run can report agreement on a
large majority of instants while a quarter of those instants order the hips oppositely. The two
answer different questions and both are required.

#### Scenario: A grafted metric's polarity comes from its own pass

- **WHEN** the two passes resolve the same instant with the runner's two hips ordered oppositely,
  and a grafted metric's exemplar names that instant
- **THEN** the planned instant's outward sign is the one the grafting pass's frame yields, and a
  metric the graft did not replace still carries the sign the primary pass's frame yields

#### Scenario: A grafted metric's joints are drawn where its own pass estimated them

- **WHEN** the two passes place the same joint at materially different positions at a shared instant
- **THEN** the grafted metric's planned keypoint positions, and the crop derived from them, are the
  grafting pass's

#### Scenario: A run with no graft plans exactly as it did before

- **WHEN** no background scale pass has completed — because it was skipped, failed, or because the
  primary pass measured real-world scale itself and no graft was needed
- **THEN** no scale-pass frames are carried, and every metric including the centimetre ones is
  planned against the primary pass's frames

#### Scenario: An instant only the grafting pass sampled still yields evidence

- **WHEN** a grafted exemplar names an instant that the grafting pass sampled and the primary pass
  did not
- **THEN** that instant resolves against the grafting pass's own frames and the evidence is planned,
  rather than being refused for want of a primary frame it never needed
