# form-heuristics

## ADDED Requirements

### Requirement: A range exemplar offers ranked alternative pairs, not only its winner

A metric that emits a range exemplar SHALL emit, with it, the **lower-ranked pairs it did not
choose**, ordered by the same score that chose the winner. Whether a pair can actually be drawn as
one legible image depends on the subject's pixel geometry and on display constants that the
measurement layer does not hold and SHALL NOT acquire; the layer that does hold them therefore
receives a ranked list to walk rather than a single take-it-or-leave-it choice.

The first entry of that list SHALL be exactly the pair the metric would have emitted on its own, so
that adding alternatives cannot change which pair a clip renders when the winner is drawable.

Every alternative SHALL be a complete, independently renderable exemplar of the same kind, carrying
its own two instants, its own quality and its own crop keypoints — all of which genuinely differ per
pair. An alternative SHALL NOT itself carry alternatives: the list is one level deep, and a
consumer SHALL be able to stop reading after the entry it selects.

Alternatives SHALL be subject to the same emission gate as the winner. A pair scoring below the
minimum exemplar quality is not evidence merely because a better pair could not be drawn, and SHALL
NOT be offered as a fallback.

Offering alternatives SHALL NOT change how many images a metric may produce. The alternatives belong
to one exemplar and describe one image; the per-metric exemplar budget continues to count images.

#### Scenario: The winner is unchanged by the presence of alternatives

- **WHEN** a metric selects its range pair over a candidate set that yields several eligible pairs
- **THEN** the first pair offered is the same one the single-best selection returns for that same
  candidate set, with the same two instants, the same base/ghost order and the same quality

#### Scenario: Alternatives are ranked by the same score as the winner

- **WHEN** a metric offers alternative pairs
- **THEN** they are ordered by the quality each pair would itself be emitted with — the weaker of
  its two ends — highest first, and each still spans the metric's median with one end on each side

#### Scenario: An alternative below the emission gate is not offered

- **WHEN** the candidate set yields pairs whose quality falls below the minimum exemplar quality
- **THEN** those pairs are absent from the offered list, so a consumer walking it can never reach a
  pair that would have been gated out had it been chosen first

#### Scenario: A metric with no eligible pair offers nothing

- **WHEN** no pair spans the metric's median with two eligible ends, or every eligible pair depicts
  no range because its two ends share one measured value
- **THEN** the metric emits no range exemplar and no alternatives, exactly as before

### Requirement: The ranked pair search is bounded independently of the candidate count

The search that produces the ranked pair list SHALL be bounded by a fixed cap on how many ranked
ends it considers **on each side** of the median, and SHALL NOT evaluate the full cross product of
eligible instants. On this repository's own reference footage a single metric reaches roughly sixty
eligible instants, which is on the order of nine hundred pairs; the emitted list, and the number of
drawability tests a consumer can be made to run, SHALL NOT scale with that.

The bound SHALL be expressed per side rather than as a count of pairs. A pair is undrawable because
of where its ends sit, and a list of the best N *pairs* can be dominated by one unlucky end repeated
against many partners, whereas a per-side bound guarantees that many distinct alternatives exist for
each end.

Within the bound the ranking SHALL be exact: every pair formed from the retained ends is scored and
ordered, with no approximation of the ordering.

#### Scenario: A large candidate set yields a bounded list

- **WHEN** a metric's eligible instants number in the dozens, so the unbounded pair count is in the
  hundreds
- **THEN** the number of pairs offered is capped by the per-side bound and does not grow with the
  candidate count

#### Scenario: Both ends have distinct alternatives

- **WHEN** the winning pair is offered along with its alternatives
- **THEN** the list contains pairs that replace the first end while holding the second, and pairs
  that replace the second while holding the first, so neither end alone can exhaust the list
