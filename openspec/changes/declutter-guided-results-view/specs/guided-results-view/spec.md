# guided-results-view

## MODIFIED Requirements

### Requirement: A reference band renders only with its provenance on screen

A reference band SHALL render, visible without hovering, expanding or following a link and in the
same view as the band itself: the source, named well enough to find it; a short statement of the
population it was measured over; and its sample size, or the fact that the source does not publish
one. Where the band is arithmetic on published numbers rather than a published range, that visible
line SHALL also declare that it is derived.

Where the source publishes NEITHER a population NOR a sample size, that visible line MAY state the
two absences as one field rather than two. Two adjacent negations spend half a line and read as two
findings where there is one: that this source published neither. The line SHALL still say so — an
absence stated once is an attribution; an absence left out is a gap the reader cannot see.

The source's own full description of its population, the derivation's statement and the definitions
the derivation rests on MAY sit inside the card's disclosure. What may not move there is the
attribution itself: a reader SHALL be able to see whose numbers a band is, over roughly whom, at
what sample size, and whether this system did arithmetic on them, without opening anything.

A band with its provenance stripped off is indistinguishable from a number the app invented, and
this capability exists precisely because the app declines to invent numbers. The citation is
therefore load-bearing, not decoration: it is what makes the band a sourced external fact rather
than an assertion.

A band SHALL exist for a metric only where published literature states a range in the unit this
system already reports that metric in, or in a unit convertible to it by a stated definitional
identity rather than a fitted constant. No band SHALL be inferred from this system's own footage,
interpolated between studies, or chosen to make measured values fall inside it.

#### Scenario: A band is shown with its source, population and sample size

- **WHEN** a metric with a reference band renders
- **THEN** the band's source name, a short statement of its population and its sample size all
  render outside any collapsed disclosure, and the source's full population description is present
  somewhere in that metric's card

#### Scenario: A derived band says it is derived

- **WHEN** a band's bounds are arithmetic on published numbers rather than a published range
- **THEN** the visible provenance line states that the band is derived, and the derivation's
  statement and the definitions it rests on are present in that metric's card

#### Scenario: A source that publishes neither states that once

- **WHEN** a band's source publishes neither a population nor a sample size
- **THEN** the visible provenance line states that both are unpublished, in one field rather than
  as two separate negations

#### Scenario: A band without provenance does not render

- **WHEN** a metric's guidance carries bounds but no source, no short population, no full population
  or no sample size
- **THEN** no band and no scale render for that metric

### Requirement: A band's position is available without the graphic

A rendered scale SHALL convey the measured value, its unit, and the band's bounds through text
alone, so that a reader who cannot see the graphic receives the same three facts. A scale that
communicates position only by pixel offset communicates nothing to a screen reader, and position is
the entire content of this view.

Where a band publishes more than one zone, every zone boundary SHALL be rendered as a mark on the
scale, not merely the outer envelope of all zones — a five-zone percentile table collapsed to its
extremes discards the information the reader came for.

The scale SHALL print at most three numbers ON THE TRACK: the lowest and the highest bound the band
publishes, and the measured value. Every other zone boundary SHALL render as an unlabelled seam.
Printing a number at every boundary stacks labels a fraction of a unit apart into rows that read as
unrelated numbers, which costs the reader more than it tells them; the bounds themselves are not
withheld, as the text alternative carries every one of them.

A caption beneath the track MAY quote the source's own words for the range, including any numbers
those words contain, and SHALL NOT author a number of its own. A quoted label is an attribution, not
a scale reading: nothing beneath the track is positioned against a mark, so it cannot be misread as
one, and rewording a cited label to keep numbers off the scale would be editing the citation.

Where the band's zones do not tile — where the source's table jumps — the span between them SHALL
appear in the text alternative, named as a span the source does not cover. The graphic distinguishes
it by hatching, and hatching is invisible to a reader who cannot see the graphic: without it the
text alternative steps from one zone to the next with nothing saying the values in between are
uncovered rather than merely unmentioned.

#### Scenario: The scale's accessible description carries value, unit and bounds

- **WHEN** a scale renders for a metric with a band
- **THEN** its accessible name or an equivalent text alternative contains the measured value, the
  metric's unit and the band's bounds

#### Scenario: Every published zone boundary renders

- **WHEN** a metric's band publishes multiple percentile zones
- **THEN** each zone's boundary renders as a mark on the scale, and every one of those bounds is
  present in the scale's text alternative

#### Scenario: Only the band's outer bounds and the value are printed

- **WHEN** a scale renders for a band publishing more than two distinct bounds
- **THEN** the only numbers printed on the track are the band's lowest bound, its highest bound
  and the measured value

#### Scenario: A published gap is named in the text alternative

- **WHEN** a band's published zones leave a span between them uncovered
- **THEN** that span and its bounds appear in the scale's text alternative, stated as a span the
  source's table does not cover

### Requirement: The speed caveat renders wherever speed materially moves the metric

This system cannot measure running speed. Where a banded metric's published values move materially
with speed, that metric SHALL render a visible tag saying that the reading varies with pace, beside
the value it qualifies, and SHALL carry the caveat itself — that speed cannot be measured, and how
this metric moves with it — in the same card.

Without it the view makes a comparison it cannot support: a runner filmed at a jog is placed on the
same scale as a runner filmed at race pace, and reads worse for the pace rather than for the form.
The effect is not marginal on the metric most affected — its published means at the slowest and
fastest measured speeds sit about two and a half standard deviations apart.

The caveat SHALL distinguish, where the sources do, between an effect **within** a runner as their
own pace changes and a correlation **between** runners at their self-selected pace, because those
are different claims and only one of them is usually measured. That distinction, being two further
paragraphs of research prose, MAY sit inside the card's disclosure; the tag that says the reading is
qualified at all SHALL NOT.

A metric for which no speed dependence was established SHALL NOT render the tag or the caveat, and
its absence SHALL NOT be read as a finding that none exists.

#### Scenario: A speed-sensitive banded metric carries the caveat

- **WHEN** a metric whose guidance records a material speed dependence renders with its band
- **THEN** a visible tag stating that the reading varies with pace renders beside that metric's
  value, and a caveat stating that the system cannot measure speed, and that this metric moves with
  it, is present in that metric's card

#### Scenario: A metric with no established speed dependence does not carry it

- **WHEN** a banded metric whose guidance records no speed dependence renders
- **THEN** no speed tag and no speed caveat render for that metric

## ADDED Requirements

### Requirement: A banded card leads with one headline stating the value and its position

A card rendering a reference band SHALL lead with a single headline carrying the measured value and,
beside it, where that value sits against the band, in the band's own words.

A reader arrives with one question — what is my number, and where does it sit — and the shipped card
answered it only by making them read a description, a caveat, a scale and a citation first. The
position is not new information: the scale and its text alternative already state it. Stating it in
the first line costs nothing and is the difference between a page that reports and a page that
answers.

The position SHALL be stated as a position and SHALL NOT be a grade: it names the zone the value
falls in, or the two zones a published gap runs between, or that the value is within, below or above
the range shown. It SHALL name whose zones they are wherever the zone labels do not already say so,
so that "30th–69th percentile" cannot be read as a percentile of anything but the population that
was measured.

Everything a card says beyond the value, its position, what the metric measures, its own caveats,
its scale, its provenance and its imagery MAY sit inside that card's one disclosure.

What the metric measures SHALL stay outside it, on every card, banded or not. A scale says where a
number sits; it does not say what the number is. `110° · within the range shown` never says 110° of
what, and a headline naming a percentile of a ratio is unreadable to anyone not already told the
ratio's terms.

#### Scenario: The headline names the zone a value falls in

- **WHEN** a banded metric's value falls inside one zone of a multi-zone band
- **THEN** the card's headline carries the measured value with its unit, and that zone's label,
  attributed to the population whose zones they are

#### Scenario: A value in a published gap names both zones

- **WHEN** a banded metric's value falls in a gap between two of its band's published zones
- **THEN** the card's headline names both zones the gap runs between, and does not place the value
  inside either

#### Scenario: Secondary material waits in the card's disclosure

- **WHEN** a banded metric's card renders
- **THEN** the source's full population description, a derived band's statement, the band's own
  assembly note, the population's central statistic and the corroborating and research links are
  present in the card but inside its disclosure, and the sentence saying what the metric measures is
  outside it

### Requirement: Zone shading shows how many runners each zone holds, never a grade

Where a band's source publishes the share of its population falling in each zone, the scale SHALL
shade the zones by that share, within a single hue family, and SHALL render a legend stating which
end of the shading means more runners. In a light theme the zone holding the most runners SHALL be
the darkest; in a dark theme it SHALL be the brightest.

Two alternating neutral tints a contrast ratio of about 1.2:1 apart are unreadable, which was the
first reader's verdict on the shipped scale. Shading by share of runners is the one ordering
available that is not a judgement: it restates the band's own population distribution, which the
zone labels already state in words. A runner in the darkest zone is in the most common zone, which
is a fact about the zone and not a verdict about them.

The shading SHALL NOT be read as a preferred end, and SHALL therefore use one hue family only. It
SHALL NOT use red, green, amber, emerald, lime, orange, rose or yellow, and SHALL NOT use this
system's brand colour, which is reserved for interactive elements and would read as an accent
meaning something.

Where a band publishes a single range with no zone shares, the range SHALL be shaded evenly across
its whole width. It SHALL NOT be drawn with any gradient, ramp or emphasis that varies across the
range: a shape that peaks in the middle and eases at both ends is the form readers know as an
optimal range, and it asserts a distribution that these bands' sources do not publish. One of them
says so in the derivation statement rendered on its own card — that no percentile of the combined
cohort is claimed.

Where a band publishes a single range, the scale SHALL name that range in the source's own words
where the legend would otherwise sit. A headline can only place a value "within the range shown",
and a range shown is a range the reader has not been told the extent or the owner of.

Where any published gap is drawn, the legend SHALL also say what the mark drawn over a gap means.

Every mark on the scale SHALL meet a contrast floor against what it is drawn on: at least 3:1 for
the marker against any zone it can sit on and against the track, and at least 3:1 for the most
heavily shaded zone against the track. Under forced colours every mark SHALL restate itself in
system colours, because the shading is a background and forced colours replace backgrounds.

#### Scenario: Shading follows share of runners

- **WHEN** a band whose zones carry published shares renders its scale
- **THEN** the zone with the largest share is shaded most heavily, zones with equal shares are
  shaded identically, and a legend states which end of the shading means more runners

#### Scenario: A single range is shaded evenly and named

- **WHEN** a band publishing one range with no zone shares renders its scale
- **THEN** the range is shaded evenly across its width, no legend claims a distribution of runners
  within it, and the range's own published label renders beneath the track

#### Scenario: The legend says what hatching means

- **WHEN** a scale renders a span its source's table does not cover
- **THEN** the legend states what the mark drawn over that span means

#### Scenario: Marks stay distinguishable under forced colours

- **WHEN** the scale renders with forced colours active
- **THEN** the track, every zone boundary and the marker each render in a system colour, and the
  marker remains distinguishable from a boundary it overlaps

### Requirement: A card shows at most one studied change

A metric's card SHALL show at most one studied change on screen, as a single line naming what was
studied and linking to the study that measured it. Every other study of a change SHALL sit inside
that card's disclosure, keeping its kind and its summary.

Three studies, each over its own line of kind and summary, is a reading list where the reader wanted
a next step. One is a next step. The remaining links are not dropped — a study this page has already
cited is not hidden because the card is long — they move behind the same disclosure everything else
secondary sits behind.

The line SHALL be stated relative to the runner's own value — a change from where they are — and
SHALL NOT state a value to reach, because no source in this system's record names one. It SHALL NOT
apply a grading word to the runner's reading, and it SHALL NOT be shown for a metric whose record
carries no study of a change.

The study it links SHALL be one of that metric's own recorded studies of changes, so the line cannot
introduce a source the record has not verified.

A studied change moves the measurement one way, and the line SHALL NOT render where the runner's
value is already past the band in that direction. A reading below a published range, under a line
naming a change that would lower it further, reads as an instruction to go further out — which is
both a grade on the reading and advice the study does not support. A value inside the band, in a
published gap, or on a metric with no band is not past anything, and the line renders.

#### Scenario: A metric with a studied change shows exactly one

- **WHEN** a metric whose guidance records a studied change renders
- **THEN** exactly one studied-change line renders outside that card's disclosure, linking a study
  drawn from that metric's own recorded studies of changes

#### Scenario: A metric with no studied change shows none

- **WHEN** a metric whose guidance records no studied change renders
- **THEN** no studied-change line renders for that metric

#### Scenario: The line is stated relative to the runner's own value

- **WHEN** a studied-change line renders
- **THEN** its text describes a change from the runner's own reading and names no value to reach

#### Scenario: A line is withheld from a value already past the band that way

- **WHEN** a metric's value falls outside its band on the side its studied change moves toward
- **THEN** no studied-change line renders for that metric, and the study itself is still present
  inside that card's disclosure with its kind and its summary
