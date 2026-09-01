## ADDED Requirements

### Requirement: A paired exemplar's label names its base instant first

Where a metric emits an exemplar whose label names its two instants SEPARATELY — the
"X, ghosted against Y" form — the LEADING clause SHALL describe the instant drawn at full opacity,
the base, and the trailing clause the ghost. Everything downstream is built on that ordering: the
alt text tells a reader who cannot see the image that the first instant named is the solid one, and
a pair demoted to a single frame keeps its label beside one body, where a leading clause describing
the OTHER instant is a flatly false statement about the picture.

This SHALL NOT be read as a rule over every paired label. A metric may instead name the PAIR as one
whole — "One stride: consecutive left-foot strikes, ghosted together", "Top and bottom of one
left-arm swing, ghosted together" — where no clause names an instant and there is no first instant
to be wrong about. Such a label has no ordering obligation, and acquires one only if its metric's
exemplar kind becomes demotable to a single frame, at which point the label itself is what has to
change: a caption naming a stride or a swing is a claim one frame cannot carry, whichever end it
kept. The interface layer already scopes its own equivalent statement to exactly the metrics
emitting the separately-naming form, and the two SHALL agree.

A metric that selects its base by DISTANCE FROM ITS OWN MEDIAN SHALL derive its label from which end
won, and SHALL NOT hardcode one end. Which end is further from the median is a property of the
clip's own distribution rather than of the metric: a clip spending most of itself at one extreme
puts the OTHER extreme further from the median. At small sample sizes that choice can turn on the
last bit of the median itself — with two surviving samples the median is the rounded mean of the
pair, so a single unit in the last place decides which end wins — and a hardcoded label is then not
merely usually right, it is unpredictable.

The selector SHALL report which end became the base as part of the pair it returns, rather than
leaving each metric to re-derive it. Re-deriving invites a second comparison that can disagree with
the first, and the comparison has already been made where the base was chosen.

Stating this SHALL NOT change which pair is selected, how pairs are ranked, or how ties are broken.
It reports a decision that has already been taken.

#### Scenario: The below-median extreme becomes the base and the label leads with it

- **WHEN** a range metric's distribution is such that the end BELOW its median is the further from
  it, so that end is the one drawn at full opacity
- **THEN** the emitted exemplar's timestamp is that end's, and the label's leading clause describes
  that end — not the above-median end the opposite distribution would have produced

#### Scenario: An exact tie resolves to the above-median end, and the label follows

- **WHEN** the two ends of a pair are exactly equidistant from the metric's median
- **THEN** the above-median end is the base, exactly as it was before this requirement was stated,
  and the label leads with it
