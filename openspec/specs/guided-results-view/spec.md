# guided-results-view Specification

## Purpose
An opt-in second results page (`?view=guide`) that presents each metric against a published
reference band where one can be cited — with its source, population and sample size on screen —
and demotes metrics with no defensible band, or not measured on this clip, to collapsed groups with
a reason, without changing any measurement and without displacing the classic view as the default.
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

Seven of this system's twelve metrics have no citable range in the unit this system reports them
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

The guided view and the existing results view SHALL NOT be mounted simultaneously. The choice
between them SHALL be exclusive.

This is forced by the DOM, not chosen for tidiness. Session evidence hands out real canvas elements
and each is mounted by replacing a host's children with it. **A DOM node has exactly one parent.**
Mounting both views would silently move every evidence canvas into whichever rendered last, emptying
the other view's imagery with no error raised anywhere — a failure that looks like missing evidence
rather than like a bug in view selection.

For the same reason the guided view SHALL NOT acquire session evidence itself. It SHALL receive
evidence as input from the single existing acquisition, so that switching views moves the canvases
rather than duplicating or re-extracting them.

#### Scenario: Only one view is in the document

- **WHEN** the session has an analysable clip and either view is selected
- **THEN** exactly one of the two results views is present in the document, and never both

#### Scenario: Switching views preserves the imagery

- **WHEN** the reader switches from one results view to the other and back
- **THEN** evidence imagery renders in the view that is mounted, and no image is lost by the switch

#### Scenario: The guided view does not acquire evidence itself

- **WHEN** the guided view renders
- **THEN** it renders the evidence it was given as input and starts no evidence acquisition of its
  own

### Requirement: The guided view announces completion with the same words the classic view does

When the analysis has completed, the guided view SHALL render a status role containing the exact
text "Analysis complete."

That literal is a hard external coupling, not a copy decision: this repo's end-to-end spec and its
A/B measurement driver both wait on those exact words, and today they exist only in the classic
view. Rendering them in the guided view means a harness can drive either view, and means the default
can be changed later without breaking either instrument.

#### Scenario: The completion line is present and verbatim

- **WHEN** the guided view renders for a completed analysis
- **THEN** an element with a status role contains the text "Analysis complete."

### Requirement: The classic results view remains the default

With no view explicitly selected, the existing results view SHALL render. The guided view SHALL be
reachable by an explicit selection that survives a reload and can be shared as a link, and SHALL be
reachable by a visible control that names both destinations and is operable from the keyboard.

Defaulting to the new view would put every existing reader in front of a page whose content is
research commentary, and would make the existing view's behaviour conditional on a parameter no
existing instrument passes. The new view is opt-in until someone decides otherwise, and that
decision is not part of introducing it.

Selecting a view SHALL NOT require a routing library.

#### Scenario: No selection renders the classic view

- **WHEN** the results render with no view explicitly selected, or with an unrecognised selection
- **THEN** the existing results view renders

#### Scenario: An explicit selection survives a reload and is shareable

- **WHEN** the reader selects the guided view
- **THEN** the selection is reflected in the page's address so that reloading or sharing it renders
  the guided view

#### Scenario: The control is reachable and names both destinations

- **WHEN** the view control renders
- **THEN** it is operable from the keyboard and carries an accessible name identifying both views

### Requirement: The guided view ranks metrics into three groups by what can be said about them

The guided view SHALL present metrics in three groups: those measured with a reference band,
expanded and ranked; those measured without one, collapsed; and those not measured on this clip,
collapsed. Rank within the banded group SHALL be a fixed property of the guidance data, ordered by
the strength of the evidence behind each band rather than by the metric's value on this clip.

Ranking by the runner's own numbers would make the page's structure a judgement about the runner,
which is the thing this capability does not do. Ranking by evidence strength makes the page's
structure a statement about the research, which is what it is for.

Where a metric's evidenced intervention is the same as another metric's, that remediation content
MAY be attached to both, so that an unbanded metric's actionable answer is still reachable from a
banded one.

#### Scenario: Banded metrics render expanded and in their fixed rank order

- **WHEN** the guided view renders an analysis in which several banded metrics resolved
- **THEN** they render expanded, in the order their guidance data specifies, independently of their
  measured values

#### Scenario: The two other groups render collapsed and expand on demand

- **WHEN** the guided view renders
- **THEN** the unbanded and the not-measured groups render collapsed, and expand to reveal their
  entries

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

### Requirement: The three bounce measures are introduced together, each linking to its own entry

The guided view SHALL render one introduction to the three measures of bounce — relative to torso
length, in centimetres, and relative to stride length — stating that they describe related motion on
different scales and answer different questions. For each measure the introduction SHALL name what
it is relative to, show its value or that it was not measured on this clip, and link to that
metric's own entry.

The introduction SHALL NOT move any of the three out of the group it belongs to. Each still renders
in its own banded, unbanded or not-measured group, with its own card, evidence and limits; the
introduction is a signpost, not a parallel grouping. Following one of its links SHALL reveal and
focus the target entry even where that entry sits inside a collapsed group.

Three numbers that all say "bounce" in different units, scattered across three groups, read either
as one finding stated three times or as three findings that disagree. Introducing them together says
which question each one answers before the reader meets them apart.

#### Scenario: The introduction names all three measures and links each

- **WHEN** the guided view renders an analysis
- **THEN** one section introduces the three bounce measures, naming for each what it is relative to,
  its value or that it was not measured, and a link to that metric's own entry

#### Scenario: Each measure still renders in its own group

- **WHEN** the bounce introduction renders
- **THEN** each of the three metrics also renders in the group its guidance and tier place it in,
  unchanged

#### Scenario: A link into a collapsed group reveals its target

- **WHEN** the reader follows the introduction's link to a metric whose group is collapsed
- **THEN** that group opens and the metric's entry receives focus

### Requirement: A running-economy consequence is stated across runners, never as the effect of changing

A metric's guidance MAY carry one running-economy consequence: a sentence stating what published
work found, between runners, about this quantity and energy cost, with the side of the band that
association points away from. Where it does, the sentence SHALL cite one of that metric's own
verified sources, and every number it contains SHALL appear in that source's own summary.

The sentence SHALL open "Across runners" and SHALL state an association between runners, not the
effect of one runner changing. Its subject SHALL be the quantity. It SHALL NOT address the reader,
SHALL NOT use a causal verb such as raises, reduces, causes or improves, SHALL NOT apply a grading
word, SHALL NOT name a target, and SHALL NOT mention injury. It SHOULD be in plain language: a
statistic belongs in the source's summary, not in the visible sentence.

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

The view SHALL render an "Energy cost" section after the completion line and before the contents
list. A story SHALL receive a headline only when its spokesman is in the banded group, is at the
normal confidence tier, carries an economy consequence, and reads strictly beyond its band's
outermost published finite bound on the side that consequence names as costly. A value exactly on
that bound SHALL NOT trigger.

A spokesman at the caveated tier that reads past that bound SHALL NOT receive a headline. The section
SHALL instead state in one line that it reads past that point with its card's confidence wording, and
link to its card. A low-confidence reading is not a finding to lead the page with, and dropping it
silently would hide the one position the section exists to report.

A spokesman whose band is withheld or whose tier is excluded SHALL NOT trigger. The costly side SHALL
be the side opposite the one the metric's studied change moves toward, so that a headline never sits
beside a studied change pointing further out.

The threshold is the outermost position the cited population was published at, on the side the
association points away from. It SHALL NOT be presented as a target, and the band SHALL keep no
preferred end.

#### Scenario: Bounce above the cited range earns a headline at the normal tier

- **WHEN** vertical oscillation in centimetres reads 10.4 cm against a 6.0–9.5 cm band, at the
  normal tier
- **THEN** a bounce headline renders

#### Scenario: A caveated reading past its point is sent to its card instead

- **WHEN** vertical oscillation in centimetres reads 10.4 cm at the caveated tier
- **THEN** no headline renders, and the section says it reads above 9.5 cm with its card's confidence
  wording and links to its card

#### Scenario: Bounce inside or below the range earns none

- **WHEN** vertical oscillation in centimetres reads 8.0 cm or 4.42 cm
- **THEN** no bounce headline renders

#### Scenario: Step rate below the 5th-percentile cut earns a headline

- **WHEN** step rate reads 150 steps/min at the normal tier, against a band whose lowest published
  bound is 153
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

### Requirement: An empty headline section says where each story stands, without grading

Where no story earns a headline, the section SHALL say, for each story in reader terms ("step rate",
"bounce in centimetres"), where it stands, from that story's own status:

- **inside** — that it is not past its point, naming the point;
- **past at a caveated tier** — the one line the headline requirement describes;
- **not measured** — that it could not be measured on this clip;
- **still being measured** — while the background scale pass is pending or running, that it is being
  measured with a second look at the clip, never that it could not be measured;
- **no band shown** — that there is no range shown to compare it with.

It SHALL NOT say a reading is not past its point unless that story was measured against a shown band
and is not past it. Every point it names SHALL come from a band the page shows; a band withheld for
missing provenance SHALL NOT be named, and no empty slot SHALL be printed in its place. Where no
measured story names its point, the section SHALL name the points for the stories still to be
measured, so the reader learns what the section reports.

The section SHALL direct the reader to the measurements below, SHALL use at most fifty words of its
own in every variant, SHALL be styled as secondary text rather than framed as a finding, SHALL NOT
promote another metric, and SHALL NOT apply a grading word.

#### Scenario: Neither reading past its point

- **WHEN** step rate reads 174 and bounce reads 4.42 cm
- **THEN** the section says step rate is not below the 5th percentile of Garmin's table and bounce in
  centimetres is not above 9.5 cm, and renders no headline

#### Scenario: One story not measured

- **WHEN** step rate is not measured and bounce reads inside its band
- **THEN** the section says where bounce stands and that step rate could not be measured on this clip

#### Scenario: The centimetre bounce still being measured

- **WHEN** the scale pass is still running and the centimetre bounce has no value yet
- **THEN** the section says it is being measured with a second look at the clip, and does not say it
  could not be measured

### Requirement: A headline states the position, the association, and the card's own cautions

A headline SHALL render, in this order: its spokesman's name as a heading; the value and its position
against the band, in words that name the range since no scale renders beside it, with the speed tag
where speed moves the metric; which clip it was measured from, exactly as that metric's card states
it, where the session holds more than one clip; the economy consequence with a link to its source;
the first sentence of every mandatory note on that metric; the metric's studied-change line exactly
where its card would render it; and a link to the metric's card, or, for bounce, to the introduction
of the three bounce measures.

The band's citation line, the metric's caveat and its confidence label stay on the card: a headline
renders only normal-tier readings, and the card is one link away. A headline SHALL render no evidence
image, no scale, no colour beyond the card's own neutral palette and no icon, and SHOULD stay near
sixty visible words of its own. A link SHALL move focus to its target, and the target SHALL be
scrolled clear of any sticky header. The completion line SHALL be unchanged.

#### Scenario: The bounce headline carries its position, association and cautions in order

- **WHEN** a bounce headline renders at 10.4 cm
- **THEN** it states "above the 6.0–9.5 cm range" and the speed tag, then the consequence linked to
  its source, then the first sentence of the metric's mandatory note, then the studied-change line
  opening "If you choose to change your form:", then a link to the bounce introduction, and it
  renders no citation line and no caveat

#### Scenario: The step-rate headline carries the pace caution

- **WHEN** a step-rate headline renders
- **THEN** it carries the speed tag, the sentence "180 steps per minute is not a target." and a link
  "Go to the Cadence card"

#### Scenario: A headline names its source clip in a multi-clip session

- **WHEN** a headline renders in a session of two clips
- **THEN** it states the clip and view its metric was measured from, the same words its card shows

#### Scenario: A headline link moves focus to its target

- **WHEN** the reader follows a headline's link
- **THEN** focus moves to the cadence card or to the bounce introduction's heading

#### Scenario: A headline renders no imagery

- **WHEN** a headline renders for a metric whose card has evidence images
- **THEN** the images render on the card and none renders in the headline section
