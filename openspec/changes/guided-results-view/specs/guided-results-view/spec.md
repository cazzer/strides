# guided-results-view

## ADDED Requirements

### Requirement: A reference band renders only with its provenance on screen

A reference band SHALL render its source, the population it was measured over, and its sample size
in the same view as the band itself — visible without hovering, expanding or following a link.
Where the band is arithmetic on published numbers rather than a published range, it SHALL also
declare that it is derived, and the derivation SHALL be attributable to the definitions it rests on.

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
- **THEN** the band's source, the population it was measured over and its sample size are all
  present in the rendered output alongside the band

#### Scenario: A derived band says it is derived

- **WHEN** a band's bounds are arithmetic on published numbers rather than a published range
- **THEN** the rendered band states that it is derived, in addition to naming the sources the
  derivation rests on

#### Scenario: A band without provenance does not render

- **WHEN** a metric's guidance carries bounds but no source, population or sample size
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
below that band's published lower bound, for a reason already recorded in this repo — the whole
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

Where a band publishes more than one zone, every zone boundary SHALL be rendered, not merely the
outer envelope of all zones — a five-zone percentile table collapsed to its extremes discards the
information the reader came for.

#### Scenario: The scale's accessible description carries value, unit and bounds

- **WHEN** a scale renders for a metric with a band
- **THEN** its accessible name or an equivalent text alternative contains the measured value, the
  metric's unit and the band's bounds

#### Scenario: Every published zone boundary renders

- **WHEN** a metric's band publishes multiple percentile zones
- **THEN** each zone's boundary is rendered, not only the lowest and highest bounds across all zones

### Requirement: The speed caveat renders wherever speed materially moves the metric

This system cannot measure running speed. Where a banded metric's published values move materially
with speed, that metric SHALL render a caveat saying so, in the same view as its band.

Without it the view makes a comparison it cannot support: a runner filmed at a jog is placed on the
same scale as a runner filmed at race pace, and reads worse for the pace rather than for the form.
The effect is not marginal on the metric most affected — its published means at the slowest and
fastest measured speeds sit about two and a half standard deviations apart.

The caveat SHALL distinguish, where the sources do, between an effect **within** a runner as their
own pace changes and a correlation **between** runners at their self-selected pace, because those
are different claims and only one of them is usually measured.

A metric for which no speed dependence was established SHALL NOT render the caveat, and its absence
SHALL NOT be read as a finding that none exists.

#### Scenario: A speed-sensitive banded metric carries the caveat

- **WHEN** a metric whose guidance records a material speed dependence renders with its band
- **THEN** a caveat stating that the system cannot measure speed, and that this metric moves with
  it, renders alongside that band

#### Scenario: A metric with no established speed dependence does not carry it

- **WHEN** a banded metric whose guidance records no speed dependence renders
- **THEN** no speed caveat renders for that metric

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

#### Scenario: An excluded metric names its reason and a capture hint

- **WHEN** a metric is excluded from the results for this analysis
- **THEN** it renders in a collapsed group, naming why it was excluded and giving a concrete
  suggestion for capturing a clip that would measure it

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
