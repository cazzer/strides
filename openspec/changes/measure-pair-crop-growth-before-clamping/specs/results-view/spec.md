# results-view

## ADDED Requirements

### Requirement: A ghosted pair is judged on the crop it demands, not the crop the frame can supply

The system SHALL reject a two-instant evidence exemplar whose two instants are too far apart to
share one legible image, and SHALL make that judgement on the crop each side **demands** — the
subject's own box, padded, floored against a degenerate box — and SHALL NOT let the frame's own
`min(width, height)` cap enter the comparison.

The rejection criterion is a ratio: the crop the pair demands divided by the crop the better-framed
of its two instants demands alone, which is the factor by which ghosting shrinks the subject on
screen. Clamping the numerator to what the frame can supply destroys that quantity precisely where
it matters: once the pair's demand exceeds the frame, the numerator stops growing while the
separation does not, so every pair past that point — including one at opposite edges of the frame —
reports the same number as one at half the separation.

The two clamps SHALL be treated differently, because they are different. A floor binds from below
and genuinely cancels: a pair whose union the floor already frames costs the reader nothing a single
would not also have paid, and SHALL read as no growth. A cap binds from above and does not cancel;
it SHALL be excluded from the measure.

Excluding the cap SHALL NOT be implemented as, or degenerate into, a test of whether a crop reached
the cap. On a small source the cap binds on every crop, so such a test would delete every ghost on
every webcam clip. The retained floor is what keeps a small source safe: the union's long side
cannot exceed the frame's own larger dimension, so with the denominator resting on the floor the
ratio is bounded, and on a frame small enough that bound sits below the rejection threshold for every
pair the source can produce.

A pair rejected on this criterion SHALL be dropped rather than demoted to one of its instants. Every
paired caption this system emits is a statement about two instants, and no surviving half carries it.

The crop rectangle that is actually drawn SHALL be unchanged by this: the drawn crop remains padded,
squared and clamped to the frame bounds. Only the judgement changes.

#### Scenario: Opposite edges of a large frame are distinguished from adjacent instants

- **WHEN** a metric emits a pair on a 3840×2160 clip whose subject box is a full-body 320×1240, at
  three separations — adjacent, half a frame apart, and at opposite edges of the frame
- **THEN** the three readings are distinct and strictly increasing, and the opposite-edge pair is
  rejected, rather than all three passing on readings that differ by under a tenth

#### Scenario: A runner who crossed the frame produces no evidence image at all

- **WHEN** a metric's two extreme instants put the runner at opposite edges of the frame, so their
  union crop would saturate at the frame's own dimension and centre on background with neither
  runner inside it
- **THEN** the pair is dropped and that metric reports no evidence, rather than rendering a crop of
  empty background captioned as a measurement

#### Scenario: An ordinary pair on a small source is still ghosted

- **WHEN** a clip is small enough that every crop reaches the frame cap — a 320×240 webcam
  recording — and a metric emits an ordinary pair on it, at any separation the source can produce
  and for any subject size the frame can hold
- **THEN** the pair is ghosted normally, because the retained floor bounds the ratio below the
  rejection threshold there, and no ghost on that clip is deleted

#### Scenario: The drawn crop is unaffected by the change of measure

- **WHEN** a pair passes the criterion and is ghosted
- **THEN** the rectangle both instants are drawn through is exactly the padded, squared,
  frame-clamped rectangle it was before, so no surviving image changes

#### Scenario: The development-only coverage output reports the reading it was judged on

- **WHEN** an evidence run completes in a development build and emits its separately-prefixed
  evidence coverage output
- **THEN** each exemplar record carries the growth reading for the image it produced, as a number
  beside the crop side already reported, and an explicit absence for a single-instant exemplar and
  for a pair demoted to its base
- **AND** that output remains parseable as JSON and carries nothing image-shaped — no canvas, blob,
  object URL or data URI
