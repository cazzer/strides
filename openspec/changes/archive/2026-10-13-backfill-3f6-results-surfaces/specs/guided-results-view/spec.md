## ADDED Requirements

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
