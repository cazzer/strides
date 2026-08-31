# results-view — delta

## ADDED Requirements

### Requirement: A measurement mark that needs a per-instant side is drawn on every instant that states one

Where a mark builder needs to know which side of the body an instant was measured on before it can
place a mark, it SHALL draw that mark for **every** instant whose side is resolvable, and SHALL
resolve that side only from what the metric stated — the per-instant side first, falling back to the
pair-level `side`, whose own contract already covers both instants whenever it is present.

On a ghosted pair whose two instants were measured on **opposite** sides, that means the mark is
drawn **twice**: once per half, each anchored on the limb that half's own measurement was taken
from. Drawing it on only one half would attribute both measurements to one limb, which is the error
the per-instant side exists to prevent.

An unresolvable side SHALL suppress only the marks that genuinely depend on it, and SHALL NOT
suppress the rest of that metric's geometry. Suppression SHALL be a **visible** absence rather than
a silent one: an image that keeps its context marks while dropping the mark that depicts the
measurement itself reads as complete and deliberate, and gives a reader no signal that the thing
they came to see is missing. Where the measurement mark cannot be drawn for every instant that
should carry it, that SHALL be observable — in the coverage a test can assert, not only by looking
at the picture.

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

- **WHEN** a metric's directional polarity is deliberately withheld, as it is for a metric grafted
  from a different pass
- **THEN** the measured span is still drawn, unoriented, and only its direction indicator is
  withheld — withholding a direction never withholds the measurement
