# results-view

## ADDED Requirements

### Requirement: A card says when its evidence is still being extracted

Evidence extraction completes seconds after the results render, and runs again whenever a later pass
changes what would be extracted. While a metric's imagery is planned but not yet produced, that
metric's card SHALL show that its evidence is being prepared, rather than rendering the same absence
a metric with no evidence renders.

Without this the two are indistinguishable for the length of a decode, and neither is rare: coverage
varies per clip by design, so "no picture for this metric" is an ordinary outcome, and the background
pass that measures in real-world units plans imagery a first extraction did not.

The indication SHALL occupy the space the thumbnail will occupy, so the picture arrives where the
placeholder stood rather than displacing the card's prose.

The indication SHALL NOT rely on motion alone: it SHALL also state in words that the frames are being
prepared, and the region awaiting imagery SHALL be marked busy in the accessibility tree, since a
reader who cannot see the placeholder learns of the wait from neither the animation nor the empty
space.

That per-card statement SHALL NOT be a live region. Every pending card carries one, and a first
extraction commonly has every planned metric pending at once, so live regions would announce one
identical sentence once per card for a single event. The statement is encountered on traversal of the
card it describes, which is where it is about.

**A metric whose previous imagery is still on screen SHALL NOT be shown as pending.** A re-extraction
leaves already-correct pictures up; replacing one with a progress indicator would report progress by
destroying the thing the progress is toward.

Which metrics are pending SHALL be derived from the run's own extraction plan, at each metric's
winning clip — the same selection the settled imagery is read from. The plan is the only statement of
what will be produced that exists before a decoder opens, and a metric the plan does not name SHALL
NOT be shown as pending.

This is a rendering state only. It SHALL NOT change any metric value, confidence, caveat, exemplar,
crop, image, or the development-only evidence coverage output.

#### Scenario: A metric whose picture has not arrived says so

- **WHEN** the results render while an extraction is in flight and a metric's imagery is planned but
  not yet produced
- **THEN** that metric's card shows a placeholder in the thumbnail's place and an announced line
  saying the frames are being prepared, and renders no image, figure or caption

#### Scenario: A card with imagery already up is not covered by a placeholder

- **WHEN** a later pass changes the plan and a re-extraction starts while a metric's previous image
  is still rendered
- **THEN** that metric keeps showing its existing image and shows no placeholder, while a metric the
  new plan added and which has nothing on screen does show one

#### Scenario: The picture lands where the placeholder stood

- **WHEN** a pending card's extraction settles
- **THEN** the imagery renders in the place the placeholder occupied, and the card's description,
  confidence line and caveat are not displaced by its arrival

#### Scenario: Progress is not carried by motion alone

- **WHEN** a card is showing that its evidence is being prepared
- **THEN** the card carries a text statement of that fact and marks the awaiting region busy, in
  addition to any animated placeholder

#### Scenario: Many pending cards announce one event once, not once each

- **WHEN** several cards are showing that their evidence is being prepared at the same time, as they
  are on a first extraction
- **THEN** none of their per-card statements is a live region, so a single extraction does not
  produce one announcement per card

## MODIFIED Requirements

### Requirement: A metric card without evidence is unchanged, and an excluded metric gets none

A metric card whose metric has no evidence planned SHALL render exactly as it does without this
capability — no thumbnail, no link, no placeholder, no empty frame, no reserved space, and no layout
shift. A card with evidence and a card without SHALL differ only by the presence of the imagery
itself. Evidence coverage varies per clip by design, so the no-evidence card is the common case, not
the exception.

This says **planned**, and the distinction is the whole of it: a metric the extraction plan names is
going to have a picture and may say so while it is being decoded, which the pending-evidence
requirement above covers. A metric the plan does not name has nothing coming, and rendering a
progress indication over an outcome that will not change would be a false promise rather than a
progress report.

Evidence SHALL be offered only for metrics that render as a card. A metric excluded from the card
grid — because nothing was measured, or because the camera geometry cannot support the measurement —
SHALL have no thumbnail and no imagery anywhere, whatever exemplars it may carry: imagery for a
measurement the system declined to report would be a picture explaining a number that is not on
screen.

#### Scenario: A card without evidence is the card it was before this capability

- **WHEN** a metric renders as a card but has no evidence planned for it
- **THEN** the card renders with no thumbnail and no placeholder, identically to a build without this
  capability, and its position and height in the grid are unaffected

#### Scenario: An excluded metric gets no thumbnail

- **WHEN** a metric is excluded from the card grid because its value is null or its view fit is
  unsuitable
- **THEN** no thumbnail is rendered for it anywhere, whatever exemplars it may carry
