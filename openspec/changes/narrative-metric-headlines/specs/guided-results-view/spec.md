# guided-results-view

## ADDED Requirements

### Requirement: A metric may carry a cited consequence, and a consequence describes the quantity rather than the runner

A metric's guidance MAY carry one sentence naming what published work measured as following from
that quantity. Where it does, the sentence SHALL be attributable to one of that metric's own already
verified sources, and every number it contains SHALL appear in that source's own summary.

The subject of the sentence SHALL be the quantity, not the runner. "Greater vertical oscillation
raises oxygen consumption" is a property of the measurement and is true whoever reads it; "your
bounce is excessive" applies a grading word to this runner's value and remains forbidden. A
consequence SHALL NOT state or imply a target, and SHALL NOT be phrased as advice.

A consequence SHALL NOT contradict a mandatory note rendered for the same metric. Where the
literature measured a mechanical quantity, the sentence SHALL name that quantity and SHALL NOT
generalise it to an outcome the record does not support.

The absence of a consequence is a finding rather than an omission, and SHALL NOT be filled by
importing a source from another metric or by weakening the attribution rule.

#### Scenario: A consequence cites one of its own metric's sources

- **WHEN** a metric's guidance carries a consequence
- **THEN** the source it cites is among that metric's own research or remediation links

#### Scenario: A consequence carries no number its source does not state

- **WHEN** a metric's guidance carries a consequence containing a number
- **THEN** that number appears in the cited source's own summary

#### Scenario: A metric with no measured consequence carries none

- **WHEN** a metric's record contains no published outcome attributable to the quantity
- **THEN** that metric's guidance carries no consequence, and none is substituted from another metric

### Requirement: Headlines above the fold admit only a metric the reader can act on

The view SHALL render a headline group above the other groups. A metric SHALL be admitted to it only
where all of the following hold: the analysis resolved a value for it on this clip, its guidance
carries a consequence, and it carries a studied cue that applies to the runner's own value under the
rule that already withholds a cue pointing further out of a band the value is already outside.

A metric that is measured but carries no cue SHALL NOT be promoted into this group, and the group
SHALL NOT be filled by relaxing any of the three conditions.

Admission is a statement about the evidence available for a metric, not about the runner. The group
SHALL NOT be introduced by wording that characterises the runner's form, and SHALL NOT apply a
grading word, a pass/fail colour or an icon to any value it renders.

A metric not admitted SHALL render below the fold exactly as it does today, with its value, its
description, its caveats and its links intact. Promotion SHALL NOT remove a metric from the groups
below.

#### Scenario: A measured metric with an applicable cue is admitted

- **WHEN** a metric resolved a value, carries a consequence, and carries a cue that applies
- **THEN** it is eligible for the headline group

#### Scenario: A withheld cue withholds the headline

- **WHEN** a metric's cue is withheld because the value already lies outside its band on that side
- **THEN** that metric is not admitted to the headline group

#### Scenario: A metric with a consequence but no cue stays below the fold

- **WHEN** a metric carries a consequence and no studied cue
- **THEN** it is not admitted to the headline group, and it renders below the fold unchanged

### Requirement: Metrics measuring one physical story yield one headline between them

Where two or more metrics report the same physical quantity or the same intervention, at most one
headline SHALL render for them. The metric that speaks for the story SHALL be the eligible member
with the lowest presentation rank, so the choice does not depend on the runner's values.

Vertical oscillation in centimetres and as a fraction of torso length are one quantity in two units,
fitted from one spectral fit; step rate and overstriding are one intervention, and this system's own
record already has the step-rate metric carrying the overstriding metric's remediation links for
that reason. Rendering each of them as its own headline would present one finding as two.

A member that does not speak for its story SHALL still render below the fold.

#### Scenario: Two units of one quantity produce one headline

- **WHEN** both the centimetre and the torso-fraction vertical-oscillation metrics are eligible
- **THEN** exactly one headline renders for them, and the other metric renders below the fold

#### Scenario: The spokesman does not depend on the runner's values

- **WHEN** a story has more than one eligible member
- **THEN** the member with the lowest presentation rank speaks for it, whatever values were measured

### Requirement: Headlines render in evidence order, never in order of the runner's readings

Headlines SHALL render in ascending presentation rank of the metric that speaks for each. The order
SHALL NOT depend on how far a value sits from its band, on the magnitude of any value, or on any
other property of the runner's readings.

Presentation rank orders the banded metrics by the strength of the evidence behind their bands.
Ordering the top of the page by the runner's own numbers would make the page's structure a judgement
about the runner, which this view does not make anywhere else.

#### Scenario: Two headlines render in rank order

- **WHEN** two headlines are eligible
- **THEN** they render in ascending presentation rank, whatever the measured values were

### Requirement: A clip with no actionable finding says so rather than manufacturing one

Where no metric satisfies the admission rule, the view SHALL state that this clip produced nothing
actionable and direct the reader to the measurements below. It SHALL NOT relax the admission rule,
promote a metric carrying no cue, or author a headline not traceable to a cited consequence and a
cited cue.

An empty headline group is a routine outcome rather than an error: a clip filmed from the front
excludes most metrics before this rule is reached, and a clip whose every applicable cue is withheld
produces none by construction.

#### Scenario: No eligible metric produces an honest empty state

- **WHEN** no metric satisfies all three admission conditions
- **THEN** the view states that nothing actionable was found on this clip and renders the groups
  below unchanged, and no headline renders

### Requirement: A headline reads correctly for a metric that has no band

A headline SHALL render its metric's value, its consequence with that consequence's citation, and
its cue with that cue's citation. Where the metric carries a reference band, the headline SHALL also
state where the value sits relative to it, as a position.

Where the metric carries no band, the headline SHALL omit the position and SHALL NOT substitute a
comparison against any other range. Two of the metrics this rule can admit are unbanded, so a
headline that depended on a band would silently drop them.

#### Scenario: An unbanded metric's headline omits the position

- **WHEN** an admitted metric carries no reference band
- **THEN** its headline renders its value, consequence and cue, and states no band position

#### Scenario: A banded metric's headline states its position

- **WHEN** an admitted metric carries a reference band
- **THEN** its headline states where the value sits relative to that band, as a position rather than
  a grade
