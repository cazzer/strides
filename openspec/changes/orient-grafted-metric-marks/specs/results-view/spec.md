## MODIFIED Requirements

### Requirement: A measurement mark that needs a per-instant side is drawn on every instant that states one

Where a mark builder needs to know which side of the body an instant was measured on before it can
place a mark, it SHALL draw that mark for **every** instant whose side is resolvable, and SHALL
resolve that side from the instant's own per-instant statement before falling back to the
exemplar's clip-level one. An exemplar whose two halves were measured on different sides is the
case this exists for: reading one side for the whole exemplar draws the second half's mark from the
wrong limb, or — where the builder refuses a mismatch — draws nothing on that half at all.

A metric SHALL NOT be exempted from this by its identity. Two metrics reporting the same per-side
quantity in different units SHALL draw the same measurement geometry: a unit conversion is not a
reason for one thumbnail to lose the mark its sibling keeps, and a reader comparing the two cards is
comparing the same measurement.

Where a mark is directional, its orientation SHALL be read from the plan the mark is drawn from —
the frames, travel direction and per-instant signs that plan carries — and never from the metric's
identity. A directional mark whose orientation is not derivable from its own plan
(`travelDirection` indeterminate, or a degenerate per-instant sign) SHALL still draw its measured
span, unoriented; withholding a direction SHALL NOT withhold the measurement. There SHALL be no
set of metric ids whose polarity is suppressed independently of what their plan supports: a metric
whose evidence is planned from the pass that measured it has a derivable, correct polarity, and
withholding it would withhold a correct answer while leaving the reader no way to tell that from a
genuinely underivable one.

This is the rendering half of `form-heuristics`'s per-instant-side contract, and it is stated
because the two halves failed independently: a metric can satisfy its own contract's letter while
the mark that depends on it is never drawn, and nothing between them notices. Concretely, the
ankle-offset caliper is the whole of what a step-width image has to show — the hip-width segment and
the hip-midline plumb are context for it — so a step-width thumbnail without its caliper is a
picture of everything except the measurement.

#### Scenario: An opposite-side pair draws its measurement mark on both halves

- **WHEN** a step-width metric's evidence renders as a ghosted pair of opposite-foot plants
- **THEN** the ankle-offset caliper is drawn on both the base and the ghost, each measured from the
  ankle that half's own strike was measured from

#### Scenario: A unit sibling draws the same measurement mark as the metric it mirrors

- **WHEN** two metrics report the same per-side quantity in different units and both plan evidence
  for the same clip
- **THEN** both thumbnails carry the same measurement geometry, and neither is reduced to its
  context marks alone

#### Scenario: An unresolvable side drops only the marks that need it

- **WHEN** an instant's measured side cannot be resolved from anything the metric stated
- **THEN** the marks that do not depend on a side are still drawn, and the side-dependent mark is
  omitted rather than anchored on a guessed limb

#### Scenario: A suppressed polarity still draws the span

- **WHEN** a directional mark's orientation is not derivable from its own plan
- **THEN** the measured span is still drawn, unoriented, and only its direction indicator is
  withheld — withholding a direction never withholds the measurement

#### Scenario: A grafted metric orients its marks from the pass that measured it

- **WHEN** a metric grafted from the background scale pass plans a directional mark, and that
  plan's frames are the scale pass's own
- **THEN** the mark is oriented from that plan exactly as its non-grafted unit sibling would be,
  and its polarity is not withheld on account of the metric's identity
