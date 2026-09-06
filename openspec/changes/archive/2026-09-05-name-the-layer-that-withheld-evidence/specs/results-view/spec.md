# results-view

## ADDED Requirements

### Requirement: A metric with no evidence names the layer that withheld it

When a metric that renders a card produces no evidence image, the reported reason SHALL distinguish
**a metric that offered the evidence layer no exemplar candidate at all** from **one whose
candidates reached that layer and were rejected there** — and, among the latter, SHALL distinguish
rejection by the shared exemplar quality gate from rejection by this layer's own resolution and
framing rules.

A single undifferentiated "every candidate was gated out" verdict SHALL NOT be used for all three.
It is not merely vague, it misdirects: where the metric offered nothing, the framing rules named by
that verdict never ran, and a reader acting on it goes looking at crop geometry and display
constants that are not involved.

Where the metric offered nothing, the reason SHALL NOT claim which of the two possible causes
applied — the metric formed no candidate, or the metric's own application of the shared quality gate
kept none. Those two are not distinguishable from this layer, and a reason that picked one would be
a guess presented as a verdict.

This is a diagnostic distinction only. It SHALL NOT change whether a metric has evidence, which
image is drawn, any crop, any exemplar, or any reported metric value; the outcome carries the same
"no evidence" status and the same empty exemplar list in all three cases.

#### Scenario: A metric whose own selection kept no candidate says so

- **WHEN** a metric renders a card, the clip's frames are usable, and the metric reports no exemplar
  at all — as an overstride metric does on a clip where no pair of footstrikes sits far enough from
  the metric's own median for the extreme-role quality ramp to clear the shared threshold
- **THEN** the reason states that no candidate was offered to this layer, and does not attribute the
  absence to this layer's own resolution or framing rules

#### Scenario: A candidate that fails the re-asserted quality gate is named as such

- **WHEN** a metric offers an exemplar scoring below the shared minimum exemplar quality, which this
  layer re-asserts rather than trusting from upstream
- **THEN** the reason states that the offered candidates fell below the quality gate, distinct both
  from offering nothing and from being undrawable

#### Scenario: A candidate that cleared the gate and cannot be drawn is named as such

- **WHEN** a metric offers candidates that all clear the quality gate, and every one of them fails
  this layer's own rules — a timestamp that resolves to no sampled frame, a frame with no derivable
  crop box, or a pair that can be neither ghosted nor demoted
- **THEN** the reason states that the candidates could not be drawn, distinct from their never
  having been offered

#### Scenario: The development-only coverage output carries the distinguished reason

- **WHEN** an evidence run completes in a development build and emits its separately-prefixed
  evidence coverage output for a metric with no evidence
- **THEN** that metric's record carries the distinguished reason verbatim, so which layer withheld
  the image is readable without a probe patch
- **AND** that output remains parseable as JSON and carries nothing image-shaped — no canvas, blob,
  object URL or data URI
