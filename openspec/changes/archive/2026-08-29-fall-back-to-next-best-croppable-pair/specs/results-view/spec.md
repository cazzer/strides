# results-view

## ADDED Requirements

### Requirement: An undrawable exemplar falls back to the next-best pair before the metric loses its evidence

When an exemplar offers ranked alternative pairs, the system SHALL walk that list in order and plan
the **first pair it can actually render**, and SHALL report that the metric has no evidence only
once every offered pair has failed. Dropping the metric on the strength of its first pair alone
makes coverage hinge on the geometry of one frame pair, which is the same defect as scoring a
single pre-chosen instant instead of ranking many — one level up.

The walk SHALL fall back on **any** reason the pair could not be rendered, not only on the two
instants being too far apart to share a crop. A pair whose ghost does not resolve to a sampled
frame, whose two instants land on the same frame, whose boxes are near-identical, or which has no
derivable crop region, is as undrawable as one that is too far apart, and a lower-ranked pair may
suffer from none of them.

Falling back SHALL NOT weaken any drop rule. Each candidate pair SHALL be planned by exactly the
same rules the winner is planned by, including the emission-quality gate, so a fallback pair can
only be rendered on terms the winner would also have had to meet. In particular, a pair too far
apart SHALL still be dropped rather than demoted to one of its instants — the fallback replaces
the pair, it never rescues half of one.

The rendered result SHALL describe the pair that was actually drawn. The instants, the quality and
the growth reading reported for the image SHALL be the selected pair's own, so that a reader —
and the development-only evidence coverage output — is never told about a pair the image does not
show.

The per-metric image budget SHALL be applied after the walk, unchanged: a fallback consumes the
slot its exemplar already owned and SHALL NOT let one metric render more images than before.

#### Scenario: An un-croppable winner is replaced rather than dropped

- **WHEN** a metric's best-scoring pair puts the subject at opposite edges of the frame, so ghosting
  the two would shrink the subject past legibility, and a lower-ranked pair sits close enough
  together to share a crop
- **THEN** the lower-ranked pair is rendered, and the metric reports evidence rather than reporting
  that all its candidates were gated out

#### Scenario: A drawable winner is untouched

- **WHEN** a metric's best-scoring pair can be rendered
- **THEN** it is rendered and no alternative is examined, so the image, its instants, its quality
  and its growth reading are exactly what they were before alternatives existed

#### Scenario: No offered pair is drawable

- **WHEN** every pair a metric offers fails to render, whatever the reason
- **THEN** the metric reports no evidence with the same reason it reported before, rather than
  rendering a pair that failed a drop rule

#### Scenario: The reported image describes the pair that was drawn

- **WHEN** a fallback pair is rendered in place of the winner
- **THEN** the reported instants, quality and growth reading are the fallback pair's own, not the
  rejected winner's

#### Scenario: Falling back does not enlarge the per-metric image budget

- **WHEN** a metric's exemplars each fall back to an alternative pair
- **THEN** the metric renders no more images than the per-metric budget already allowed, because
  the alternatives belong to the exemplars rather than adding to them
