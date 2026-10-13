## ADDED Requirements

### Requirement: A running-economy consequence is stated across runners, never as the effect of changing

A metric's guidance MAY carry one running-economy consequence: a sentence stating what published
work found, between runners, about this quantity and energy cost, with the side of the band that
association points away from. Where it does, the sentence SHALL cite one of that metric's own
verified sources, and every number it contains SHALL appear in that source's own summary.

The sentence SHALL open "Across runners" and SHALL state an association between runners, not the
effect of one runner changing. Its subject SHALL be the quantity. It SHALL NOT address the reader,
SHALL NOT use a causal verb such as raises, reduces, causes or improves, SHALL NOT apply a grading
word, SHALL NOT name a target, and SHALL NOT mention injury.

A consequence SHALL exist only where the source reports the association in the unit this system
reports the metric in. A metric normalised differently from every published row SHALL carry none,
and none SHALL be imported from a sibling metric in another unit.

#### Scenario: Only the two metrics with a published economy association carry one

- **WHEN** the guidance record is read
- **THEN** step rate and vertical oscillation in centimetres carry an economy consequence, and every
  other metric, including vertical oscillation relative to torso length, carries none

#### Scenario: A consequence quotes only its own source's numbers

- **WHEN** a consequence contains a number
- **THEN** that number appears in the summary of the source it cites, and that source is one of the
  metric's own research or remediation links

#### Scenario: A consequence describes runners, not the reader

- **WHEN** a consequence renders
- **THEN** it opens "Across runners", contains no "you" or "your", no causal verb, no grading word and
  nothing about injury

### Requirement: A headline appears only where its spokesman reads past its cited band on the costly side

The view SHALL render a "Running economy" section after the completion line and before the
contents list. A story SHALL receive a headline only when its spokesman is in the banded group,
carries an economy consequence, and reads strictly beyond its band's outermost published finite bound
on the side that consequence names as costly. A value exactly on that bound SHALL NOT trigger.

A spokesman whose band is withheld or whose tier is excluded SHALL NOT trigger. The costly side SHALL
be the side opposite the one the metric's studied change moves toward, so that a headline never sits
beside a studied change pointing further out.

The threshold is the outermost position the cited population was published at, on the side the
association points away from. It SHALL NOT be presented as a target, and the band SHALL keep no
preferred end.

#### Scenario: Bounce above the cited range earns a headline

- **WHEN** vertical oscillation in centimetres reads 10.4 cm against a 6.0–9.5 cm band
- **THEN** a bounce headline renders

#### Scenario: Bounce inside or below the range earns none

- **WHEN** vertical oscillation in centimetres reads 8.0 cm or 4.42 cm
- **THEN** no bounce headline renders

#### Scenario: Step rate below the 5th-percentile cut earns a headline

- **WHEN** step rate reads 150 steps/min against a band whose lowest published bound is 153
- **THEN** a step-rate headline renders, and at exactly 153 or at 174 none does

#### Scenario: An excluded spokesman never triggers

- **WHEN** a spokesman's tier is excluded, whatever its value
- **THEN** no headline renders for its story

### Requirement: Each story has one fixed spokesman and yields at most one headline

Step rate SHALL speak only through the step-rate metric, and bounce only through vertical
oscillation in centimetres. Overstriding, vertical oscillation relative to torso length and vertical
ratio SHALL NOT speak for either story, whatever they read, and no other metric SHALL be substituted
when a spokesman is not measured. Each story SHALL yield at most one headline.

A metric that tells the same story still renders its own card below, unchanged.

#### Scenario: No fallback when the spokesman is missing

- **WHEN** vertical oscillation in centimetres is not measured and vertical oscillation relative to
  torso length reads high
- **THEN** no bounce headline renders

#### Scenario: Promoted metrics still render below

- **WHEN** a headline renders for a spokesman
- **THEN** that metric's card still renders in its group below, and the headline section contains no
  card

### Requirement: Headlines render in evidence order, never in order of the runner's readings

Headlines SHALL render in ascending presentation rank of their spokesmen, so step rate precedes
bounce. The order SHALL NOT depend on how far a value sits past its bound, on any value's magnitude,
or on any other property of the runner's readings.

#### Scenario: The order is fixed whatever the readings

- **WHEN** both headlines render, with either reading the further past its bound
- **THEN** step rate renders first and bounce second

### Requirement: An empty headline section says so without grading

Where no story earns a headline, the section SHALL say that no headline appears for this clip, state
the two positions that would produce one in the bands' own terms, and then either that neither reading
is past that point or which spokesmen could not be measured. It SHALL say that this is a position, not
a grade, and direct the reader to the measurements below. It SHALL use at most fifty words of its own,
SHALL NOT promote another metric, and SHALL NOT apply a grading word.

#### Scenario: Neither reading past its point

- **WHEN** step rate reads 174 and bounce reads 4.42 cm
- **THEN** the section states the two trigger positions, that neither reading is past that point, and
  that this is a position, not a grade, and renders no headline

#### Scenario: A spokesman could not be measured

- **WHEN** step rate is not measured and no headline renders
- **THEN** the section names step rate's metric as not measured on this clip

### Requirement: A headline states the position, its sources and the card's own cautions

A headline SHALL render its spokesman's name as a heading; the value and its position against the
band, in words that name the range, since no scale renders beside it; the speed caveat tag where speed
moves the metric; the confidence label its card shows when the metric is caveated, and the metric's
own caveat; the band's visible citation line; the economy consequence with a link to its source;
the first sentence of every mandatory note on that metric; the metric's studied-change line exactly
where its card would render it; and a link to the metric's card, or, for bounce, to the introduction of
the three bounce measures.

A headline SHALL render no evidence image, no scale, no colour beyond the card's own neutral palette
and no icon. The completion line SHALL be unchanged.

#### Scenario: The bounce headline carries its position, sources and cautions

- **WHEN** a bounce headline renders at 10.4 cm
- **THEN** it states "above the 6.0–9.5 cm range", the speed tag, the band's citation, the consequence
  linked to its source, the first sentence of the metric's mandatory note, the studied-change line
  opening "If you choose to change your form:", and a link to the bounce introduction

#### Scenario: The step-rate headline carries the pace caution

- **WHEN** a step-rate headline renders
- **THEN** it carries the speed tag and the sentence "180 steps per minute is not a target."

#### Scenario: A low-confidence reading keeps its card's cautions

- **WHEN** a headline renders for a caveated metric with a caveat
- **THEN** it carries the same confidence label and the same caveat its card shows

#### Scenario: A headline renders no imagery

- **WHEN** a headline renders for a metric whose card has evidence images
- **THEN** the images render on the card and none renders in the headline section
