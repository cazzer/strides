## ADDED Requirements

### Requirement: With more than one clip, each metric names the clip it was measured from

Where a session holds more than one clip, every rendered metric card, in either results view, SHALL
state which clip its value was measured from, by number and total and by that clip's detected camera
view ("Measured from Clip 2 of 3 · Side view"). The clip SHALL be the one the per-metric source index
names, never one recovered from the caveat's provenance sentence. Where a clip's view is not yet
known the label SHALL say so rather than guess.

Each clip's entry in the header strip SHALL carry the same view label, so the reader can match the
number on a card to the footage in the strip.

With a single clip the label SHALL NOT render: there is no other clip it could have come from.

Fusion picks a winning clip per metric, so the numbers on one page can come from different footage
filmed from different angles. A reader comparing a side-view knee angle with an approach-view step
width needs to know they are looking at two clips, and which.

#### Scenario: Each metric names its source clip and view

- **WHEN** a session of three clips renders its fused results
- **THEN** every metric card states the clip number, the total, and that clip's view, taken from the
  per-metric source index

#### Scenario: A single clip renders no source label

- **WHEN** a session of one clip renders its results
- **THEN** no metric card renders a "Measured from" label

#### Scenario: The strip carries the same view labels

- **WHEN** a clip's analysis has detected its camera view
- **THEN** that clip's strip entry shows the same view label the cards use, and a clip whose view is
  not yet known shows that it is pending
