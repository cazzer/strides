# guided-results-view Specification

## Purpose
The shell the tour and summary render in, the view routing (the tour by default, the summary, and
classic with `?view=classic`), and the band rules every guided card follows: each metric is
presented against a published reference band where one can be cited — with its source, population and sample
size on screen — and demotes metrics with no defensible band, or not measured on this clip, to
collapsed groups with a reason, without changing any measurement.
## Requirements
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

### Requirement: A band states where the runner sits, never where they should be

A reference band SHALL be presented as the range some measured population fell in, and SHALL NOT be
presented as a target, a goal, a recommendation, or a healthy range. No element of this view SHALL
grade the runner — not by colour carrying pass/fail semantics, not by a word such as good, poor,
optimal or excessive applied to the runner's own value, and not by an icon such as a check or a
cross.

The evidence does not support a verdict. For one banded metric four measured outcomes point in
different directions at once, and for another the strongest available review reports insufficient
evidence that changing it affects injury or performance at all. A scale that shaded one end
favourably would assert what the literature declines to.

The band SHALL NOT carry a preferred end, and the runner's position within or outside it SHALL be
reported as a position.

#### Scenario: No element grades the runner

- **WHEN** the guided view renders for any analysis
- **THEN** no rendered element carries red, green, amber, emerald, rose or yellow semantics, and no
  rendered text applies a grading word to the runner's own value

#### Scenario: A band is worded as a population, not a goal

- **WHEN** a band renders
- **THEN** its wording attributes the range to the population that was measured, and states neither
  a target nor a recommended value

### Requirement: A value outside its band is reported as outside, never silently clamped

Where a measured value falls outside the domain the scale renders, the marker SHALL be clamped to
the edge **and** the view SHALL state in words that the value lies outside. It SHALL NOT render as
though the value sat at the domain's extreme.

This is not hypothetical: this repo's own standing regression anchor for one banded metric reads
below that band's lower bound, for a reason already recorded in this repo — the whole
vertical-oscillation family underfits peaky waveforms. The correct response is to show the reading
where it falls and say so; moving the band to contain it would destroy the only property that makes
the band worth citing.

#### Scenario: A value below the band's domain says so

- **WHEN** a metric's value is lower than the lowest value the scale's domain covers
- **THEN** the marker renders at the domain's lower edge and the view states that the value is below
  the rendered range

#### Scenario: A value above the band's domain says so

- **WHEN** a metric's value is higher than the highest value the scale's domain covers
- **THEN** the marker renders at the domain's upper edge and the view states that the value is above
  the rendered range

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

### Requirement: Banding controls whether a scale renders, not whether the metric renders

A metric that was measured but carries no defensible reference band SHALL still render its value,
its description, its own caveats, and its research and remediation links. Only the **scale** is
withheld.

Eight of this system's thirteen metrics have no citable range in the unit this system reports them
in — including the metric most often asked about. Omitting them would hide the majority of the
measurement behind the minority that happens to be citable; showing them with an invented scale
would be the error this whole capability exists to avoid. They render, without a scale, and each
SHALL be able to state why no band is available.

An unbanded metric MAY be presented less prominently than a banded one, and SHALL NOT be presented
as less valid.

#### Scenario: An unbanded metric renders its value and its links

- **WHEN** a metric was measured and its guidance carries no band
- **THEN** the view renders that metric's value, its description and its research and remediation
  links, and renders no scale for it

#### Scenario: An unbanded metric can say why it has no band

- **WHEN** an unbanded metric's entry is expanded
- **THEN** the reason no reference band is available for it is rendered

### Requirement: A metric not measured on this clip collapses with a reason and a capture hint

A metric the analysis excluded SHALL be rendered in a collapsed group, and each entry SHALL name why
it was excluded and give a concrete, actionable suggestion for capturing a clip that would measure
it.

"Not measured" with no reason is indistinguishable from a broken page, and the reasons are already
known to the system — the metric's own caveat, or the hint the background real-world-scale pass
leaves for the centimetre metrics. A reader who films from the front cannot know that the metrics
they are missing need a side view unless the page tells them.

The suggestion SHALL be about capture — camera angle, clip length, keeping the runner at a constant
distance — and SHALL NOT suggest that the runner change how they run.

The suggestion SHALL match the cause of the exclusion, not merely the metric. A metric can be
excluded because the camera angle cannot support it, or because the clip gave too little to measure
— too few strides, gaps in detection, no real-world scale — and those need different advice: telling
a reader whose clip was simply too short to move the camera sends them to re-film for the wrong
reason. Each metric therefore carries one suggestion for a camera-angle exclusion and one for every
other cause, and the view SHALL render the one that matches.

#### Scenario: An excluded metric names its reason and a capture hint

- **WHEN** a metric is excluded from the results for this analysis
- **THEN** it renders in a collapsed group, naming why it was excluded and giving a concrete
  suggestion for capturing a clip that would measure it

#### Scenario: A camera-angle exclusion gets a camera-angle suggestion

- **WHEN** a metric is excluded because the camera angle of this clip cannot support it
- **THEN** its capture suggestion names the camera angle that would measure it

#### Scenario: Any other exclusion gets a suggestion for that cause

- **WHEN** a metric is excluded for a reason other than the camera angle
- **THEN** its capture suggestion addresses that cause — clip length, keeping the whole body in
  frame, or the real-world scale — rather than the camera-angle suggestion

#### Scenario: The excluded group is collapsed, not omitted

- **WHEN** an analysis excludes one or more metrics
- **THEN** those metrics are present in the rendered output in a collapsed group, and are not absent
  from the page

### Requirement: Exactly one results view is mounted at a time

The runner tour, the results summary and the classic results view SHALL NOT be mounted
simultaneously. The choice between them SHALL be exclusive. The tour and the summary SHALL each
render exactly one guided results shell, never a hidden second copy. The tour SHALL mount no metric
card and so no evidence canvas; its evidence is mounted when the reader switches to the summary or
the classic view. The summary SHALL mount each metric's card (and so its evidence) at most once; a
collapsed summary row SHALL hide its content without unmounting it.

This is forced by the DOM, not chosen for tidiness. Session evidence hands out real canvas elements
and each is mounted by replacing a host's children with it. **A DOM node has exactly one parent.**
Mounting two views would silently move every evidence canvas into whichever rendered last, emptying
the other view's imagery with no error raised anywhere — a failure that looks like missing evidence
rather than like a bug in view selection.

For the same reason neither the guided view, the runner tour nor the results summary SHALL acquire
session evidence itself. Each SHALL receive evidence as input from the single existing acquisition, so that
switching views moves the canvases rather than duplicating or re-extracting them.

#### Scenario: Only one view is in the document

- **WHEN** the session has an analysable clip and any view is selected
- **THEN** exactly one of the three results views is present in the document, and never two

#### Scenario: Switching views preserves the imagery

- **WHEN** the reader switches from the tour to the summary, to the classic view and back to the
  summary
- **THEN** the tour shows no evidence imagery, and from the summary on the imagery renders in the
  view that is mounted, the same canvas elements move with each switch, and no image is lost

#### Scenario: The guided view does not acquire evidence itself

- **WHEN** the guided view, the runner tour or the results summary renders
- **THEN** it renders at most the evidence it was given as input and starts no evidence acquisition
  of its own

#### Scenario: Collapsed summary rows keep their imagery

- **WHEN** the results summary renders with every row collapsed
- **THEN** each evidence canvas is already in the document inside its metric's row, exactly once,
  and opening the row shows that same canvas rather than mounting a new one

### Requirement: The guided view announces completion with the same words the classic view does

When the analysis has completed, every results view — the runner tour, the results summary and the
classic view — SHALL render exactly one status role beginning with the exact text "Analysis
complete." A view that wraps the guided view SHALL rely on the guided view's line and SHALL NOT
render a second one.

That literal is a hard external coupling, not a copy decision: this repo's end-to-end spec and its
A/B measurement driver both wait on those exact words. Rendering them in every view means a harness
can drive any of them, and means the default can change without breaking either instrument. Exactly
one match matters as much as the words: both instruments locate the line strictly, and a second match
fails them as surely as none.

#### Scenario: The completion line is present and verbatim

- **WHEN** any results view renders for a completed analysis
- **THEN** exactly one element with a status role contains the text "Analysis complete."

### Requirement: Every outbound reference is from a verified set and opens safely

Every link the guided view renders SHALL use https, SHALL open in a new browsing context with
`rel="noopener noreferrer"`, and SHALL be a member of a set of references verified as reachable,
pinned in the source so that an unverified reference cannot be added silently.

A guidance page whose citations rot is worse than one with no citations, because it still looks
attributable. Sources that could not be retrieved SHALL NOT be linked, and their absence SHALL NOT
be filled by a secondary source restating them.

#### Scenario: Links are https, safely targeted, and from the pinned set

- **WHEN** the guided view renders any outbound reference
- **THEN** its URL is https, it opens in a new browsing context with `rel="noopener noreferrer"`,
  and it is a member of the pinned verified set

### Requirement: The guided view changes no measurement

The guided view SHALL be a presentation of an analysis result that already exists. It SHALL NOT
change any metric's value, confidence, caveat, view fit, tier, exemplar, crop or image, SHALL NOT
alter the development-only diagnostics or evidence-coverage output, and SHALL NOT alter how the
existing results view renders when it is the one selected.

A metric that reads wrong today reads identically wrong here. That is deliberate: this capability
interprets measurements, it does not correct them, and a reading that disagrees with a published
band is evidence about the measurement rather than a reason to adjust the band.

#### Scenario: Selecting the guided view changes nothing that was measured

- **WHEN** the same analysis is rendered by the guided view and by the existing results view
- **THEN** every metric's value, confidence, caveat, tier and evidence are identical in both, and
  the development-only diagnostics output is unchanged by the selection

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

### Requirement: Every scale states that its band is observed, not a target

Every rendered scale SHALL carry, visible beside the graphic and outside any disclosure, a short
label stating that the band is an observed range and not a target. The text alternative listing the
band's zones SHALL describe them as observed zones or an observed range, not as reference or
recommended ones.

A range drawn as a coloured span beside a marker reads, by default, as a range to be inside. The
requirement that a band is a population and never a goal is met in the words of the provenance line,
but a reader looking at the graphic has not read that line yet. The label puts the same statement
where the eye already is.

#### Scenario: A scale says it is observed, not a target

- **WHEN** a banded metric's scale renders
- **THEN** the words "Observed, not a target" render beside it, outside the card's disclosure

#### Scenario: The zone list names observed zones

- **WHEN** a screen reader reaches a scale's list of zones
- **THEN** the list is named as observed zones (several zones) or an observed range (one range), and
  not as reference zones

### Requirement: A studied-change line is framed as the runner's own choice

Where a card renders its one studied-change line, the line SHALL open with words making the change
conditional on the runner choosing it, and SHALL NOT open with an imperative. For the step-rate
metric the line SHALL name the change ("If you choose to raise step rate:"); for every other metric
it SHALL read "If you choose to change your form:".

A measured value is not, by itself, a reason to change gait. A bare "Try:" in front of a studied
change reads as advice to do it; the conditional states what was studied for a runner who has
already decided to change, and leaves the decision with them.

#### Scenario: The step-rate line names the change as a choice

- **WHEN** the step-rate metric's studied-change line renders
- **THEN** it opens with "If you choose to raise step rate:"

#### Scenario: Every other line is framed as a choice to change form

- **WHEN** any other metric's studied-change line renders
- **THEN** it opens with "If you choose to change your form:", and no studied-change line opens with
  an imperative such as "Try:"

### Requirement: A running-economy consequence is stated across runners, never as the effect of changing

A metric's guidance record MAY carry one running-economy consequence: a sentence stating what
published work found, between runners, about this quantity and energy cost, with the side of the
band that association points away from (its costly side). Where it does, the sentence SHALL cite one
of that metric's own verified sources, and every number it contains SHALL appear in that source's
own summary.

The consequence is guidance data, not rendered copy: no results view renders its sentence or its
link. Its costly side is what the data is for. It SHALL be the side opposite the one the metric's
studied change moves toward, and it decides cue eligibility: a reading earns a cue only strictly
beyond its band's outermost finite bound on that side (runner-feedback, "A cue appears only where the
studied change applies to this value"). A metric with no consequence SHALL never earn a cue.

The sentence is kept as the record that costly side rests on, and the record SHALL hold it to the
same rules whether or not anything renders it. The sentence SHALL open "Across runners" and SHALL
state an association between runners, not the effect of one runner changing. Its subject SHALL be
the quantity. It SHALL NOT address the reader, SHALL NOT use a causal verb such as raises, reduces,
causes or improves, SHALL NOT apply a grading word, SHALL NOT name a target, and SHALL NOT mention
injury. It SHOULD be in plain language: a statistic belongs in the source's summary, not in the
sentence.

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

- **WHEN** the guidance record is read
- **THEN** every consequence's sentence opens "Across runners", contains no "you" or "your", no
  causal verb, no grading word and nothing about injury

#### Scenario: The costly side is opposite the studied change

- **WHEN** the guidance record is read
- **THEN** every metric carrying a consequence has a studied change, and its costly side is below
  the band when that change moves higher and above it when that change moves lower

### Requirement: The runner tour is the default results view

With no view explicitly selected and no remembered landing, the runner tour SHALL render. The
system SHALL offer three results views — the runner tour, the results summary and the classic
table — and SHALL mount exactly one of them.

Exactly one `view` parameter whose value is exactly `tour`, `summary` or `classic` SHALL select
that view. The legacy value `guide` SHALL select the runner tour. Every other address, including an
absent, empty, unknown, repeated or differently-cased parameter, SHALL select the remembered landing
view when one is set, and the runner tour otherwise. An explicit selection, `guide` included, SHALL
take precedence over the remembered landing.

When the reader skips or finishes the tour, the system SHALL remember the summary as the landing
view in browser storage, and SHALL switch to the summary. Replaying the tour SHALL NOT change the
remembered landing. Unavailable or throwing storage SHALL NOT prevent a view from rendering; it SHALL
read as no remembered landing.

Selecting the classic view SHALL write `view=classic` to the address, so a reload or a shared link
renders the classic view. Selecting the tour or the summary SHALL remove the `view` parameter from
the address rather than write a value.

Each switch the reader makes SHALL add a history entry that records the view it shows, so the
browser's Back and Forward step through the views the reader visited without leaving the page.
Returning to an entry SHALL restore the view that entry records, and SHALL NOT add an entry of its
own. The entry the page loaded on SHALL record the view it opened with. An entry that records no
view, such as one an in-page link created, SHALL leave the view on screen unchanged.

Each view SHALL offer keyboard-operable controls to the others: the tour a control to skip to the
summary; the summary, below its results, a control to replay the tour and a control to open the
classic table; the classic view a control to show the summary. Each view SHALL mark one entry
point at its top: a heading in the tour and the summary, and the show-summary control in the classic
view. After a switch, focus SHALL move to the new view's entry point, never to a control further
down the page.

Selecting a view SHALL NOT require a routing library.

#### Scenario: No selection and no landing renders the tour

- **WHEN** the results render with no view selected and no remembered landing
- **THEN** the runner tour renders

#### Scenario: A remembered summary landing renders the summary

- **WHEN** the results render with no view selected and the summary remembered as the landing view
- **THEN** the results summary renders

#### Scenario: Skipping or finishing the tour remembers the summary

- **WHEN** the reader skips or finishes the tour
- **THEN** the summary renders, the summary is remembered as the landing view, and the address
  carries no `view` parameter

#### Scenario: Unavailable storage still renders a view

- **WHEN** browser storage throws on every access
- **THEN** the runner tour renders, and skipping it still switches to the summary

#### Scenario: An older guided link renders the tour

- **WHEN** the page loads with `?view=guide`, whether or not a landing is remembered
- **THEN** the runner tour renders

#### Scenario: An explicit classic selection survives a reload and is shareable

- **WHEN** the reader selects the classic view
- **THEN** the address carries `view=classic`, so reloading or sharing it renders the classic view

#### Scenario: Each view offers keyboard-operable controls to the others

- **WHEN** any of the three views renders
- **THEN** it offers native buttons, operable from the keyboard, that reach the other views as listed
  above, and activating one moves focus to the new view's entry point

#### Scenario: Browser Back returns to the previous view

- **WHEN** the reader moves from the summary to the classic view and then presses the browser's Back
- **THEN** the summary renders again with its evidence imagery intact, the address carries no `view`
  parameter, and the page has not been left

#### Scenario: No routing library

- **WHEN** the dependencies are inspected
- **THEN** no routing library is installed, and the view is read from and written to the address
  directly

