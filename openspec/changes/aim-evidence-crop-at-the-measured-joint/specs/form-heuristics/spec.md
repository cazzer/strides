# form-heuristics — delta

## MODIFIED Requirements

### Requirement: Metrics emit exemplar instants as timestamps, never frame indices

Every metric SHALL be able to report, alongside its existing `MetricResult` fields, an optional
`exemplars` list naming the specific instants in the clip that produced its result. Each exemplar
SHALL identify its instant(s) **only** by `timestamp` — seconds on the clip's own media clock, the
same clock `RobustPoseFrame.timestamp` carries — and SHALL carry a second, optional
`pairedTimestamp` when the exemplar depicts a two-instant range. The exemplar type SHALL NOT
contain a frame-index field of any kind.

The reason is a boundary that is invisible at the call site: metrics are computed over the
**presence-trimmed** frame array while the rest of the application holds the **untrimmed** array, so
an index produced by a metric does not address the array its consumer holds — off by exactly the
number of frames the presence trim removed, which is zero on a clip where the subject is present
from the first frame and non-zero on precisely the clips this evidence is most useful for. Because
the presence trim returns a slice of the *same* frame objects, timestamps are valid on both sides of
that boundary and indices are not.

An exemplar SHALL additionally carry: a `quality` score in `[0, 1]` (see "Exemplar instants are
ranked and gated by a per-instance quality score"), a `kind` discriminating what the instant depicts,
a `side` where the metric is per-side and **both** instants share that side, a short human-readable
`label` for captioning, and the `cropKeypoints` — the keypoint names whose positions define the
region of the frame this exemplar is about. `cropKeypoints` SHALL be named by the metric that emitted
the exemplar, not re-derived downstream from the `MetricId`, so that knowledge of what a metric
measured lives only in the module that measures it.

An exemplar MAY additionally name the ONE keypoint its card's number is about — the joint a reader
is being asked to look at. `cropKeypoints` cannot answer that question: it bounds the region the
image must CONTAIN, and its centre is wherever that region's geometry puts it, which for a joint at
one end of a limb chain is systematically off-centre. A metric whose picture is of one joint SHALL
name it. A metric whose number is a relation between two positions — an amplitude, a stride length,
a width across a midline — SHALL NOT, because there is no single joint at the centre of such a
picture and naming either end would emphasise a point the card is not reporting on.

Like `cropKeypoints`, that name SHALL be stated by the metric that took the measurement and SHALL
NOT be re-derived downstream from the `MetricId`.

A metric whose exemplar pairs two instants that need **not** share a side SHALL additionally state
the side each instant's own measurement was about, per instant. `side` cannot express this: it is a
pair-level claim, present only when both instants share a side, so on a deliberately opposite-side
pair it is absent — and with it goes any way for a consumer to know which limb each half of the
evidence was measured from. Three metrics are in this position, and for all three the mixed pair is the
common case rather than an edge: **both** step-width metrics — the hip-width ratio and its
centimetre sibling, which are separate `MetricId`s emitting their own exemplars — construct
their pair from adjacent **opposite-foot** strikes, and overstriding pairs a far-reaching strike with a close-landing one — one drawn from
each end of its range, where each end is filled by the best-scoring surviving candidate at that
end and extremeness is only a tie-break — which nothing constrains to one foot.

That per-instant side SHALL be **stated by the metric that took the measurement**, and a consumer
SHALL NOT infer it from the order of `cropKeypoints`. The measured limb's keypoint does happen to be
ordered first in all three metrics' crop sets, but that ordering is a private consequence of how those
three modules concatenate their per-instant seeds, is not part of this contract, and would invert silently
if either module reordered a seed. An instant whose side no metric stated SHALL be represented as an
explicit absence rather than defaulted to a side: a mark anchored on a guessed limb is a confident
picture of a measurement nobody took.

This obligation SHALL be satisfied by **every** metric with that shape, and SHALL NOT be counted per
measured quantity: two metrics reporting the same quantity in different units are two emitters, and
each states its own per-instant sides. Where several metrics share this construction, they SHALL
share **one implementation** of it rather than parallel copies, so that the obligation cannot be met
by one and silently dropped by another.

A metric SHALL emit **at most two** exemplars, ranked by `quality` descending, where a two-instant
ghosted pair counts as one exemplar. A metric with no instant clearing the gate SHALL omit the field
entirely rather than emitting a low-quality exemplar.

Emitting exemplars SHALL NOT change any metric's `value`, `confidence`, `viewFit`,
`interpolatedFraction`, `frameCoverage`, `sampleSize`, or `caveat`.

#### Scenario: A one-joint metric names the joint its number is about

- **WHEN** a metric whose number is read at a single joint — a knee angle at peak flexion, a thigh
  lift measured to the knee — emits an exemplar
- **THEN** that exemplar names that joint, and a metric reporting an amplitude or a stride length
  names none, so a consumer can tell "no joint is at the centre of this picture" from "the metric
  forgot to say"

#### Scenario: An exemplar addresses its instant by timestamp across the presence-trim boundary

- **WHEN** a metric emits an exemplar on a clip whose presence window is strictly narrower than the
  full clip
- **THEN** resolving that exemplar's `timestamp` against the **untrimmed** frame array finds the same
  frame object the metric itself saw in the **trimmed** array

#### Scenario: A metric emits at most two exemplars, ranked

- **WHEN** a metric has more qualifying instants than the per-metric budget
- **THEN** it emits exactly two, and they are the two highest-`quality` qualifying instants

#### Scenario: A metric with no qualifying instant omits the field

- **WHEN** every candidate instant for a metric fails the quality gate
- **THEN** that metric's result carries no `exemplars` field at all, rather than an empty or
  low-quality one, and every other field of its result is unchanged

#### Scenario: Exemplars never move a number

- **WHEN** a metric is computed over any frame sequence, with and without exemplar emission
- **THEN** its `value`, `confidence`, `viewFit`, `interpolatedFraction`, `frameCoverage`,
  `sampleSize`, and `caveat` are identical

#### Scenario: A single-instant exemplar is expressible without a null second instant

- **WHEN** a metric's evidence exists only at one moment (a footstrike), so no honest second instant
  exists
- **THEN** the exemplar carries no `pairedTimestamp` at all, rather than a null one that would read
  as a missing half of a pair

#### Scenario: An opposite-side pair states each instant's own side

- **WHEN** a metric emits a paired exemplar whose two instants were measured on different sides of
  the body — step width's constructed opposite-foot pair, or an overstride range whose two extreme
  strikes fall on different feet
- **THEN** the exemplar carries no single pair-level `side`, and each instant separately names the
  side its own measurement was taken on, so the two differ

#### Scenario: A unit sibling of a per-side metric states its own per-instant sides

- **WHEN** two metrics report the same per-side quantity in different units, and both emit an
  opposite-side paired exemplar for the same clip
- **THEN** each metric's own exemplar names both instants' sides, and neither relies on the other
  having done so

#### Scenario: A per-instant side is never inferred from keypoint ordering

- **WHEN** a consumer needs to know which side one instant of an exemplar was measured on
- **THEN** it reads only what the metric stated — falling back to the pair-level `side`, whose own
  contract covers both instants whenever it is present — and an exemplar with neither resolves to an
  explicit absence, even where `cropKeypoints` happens to lead with one side's keypoint

## ADDED Requirements

### Requirement: A representative-instant exemplar offers ranked alternatives on the same terms as a range exemplar

A metric that selects ONE representative instant from a pool of scored candidates SHALL emit, with
it, the **lower-ranked candidates it did not choose**, ordered by the same score that chose the
winner, on exactly the terms a range exemplar's alternatives are already offered: first entry
identical to what the metric would have emitted alone, every entry a complete and independently
renderable exemplar of the same kind, one level deep, each subject to the same emission gate, and
none of it changing how many images the metric may produce.

The reason is sharper here than for a range. Such a metric ranks candidates by nearness to its own
median, and that score is **structurally unable to separate two candidates equidistant from the
median** — which an even candidate pool produces by construction, at bit-identical quality. Emitting
only the head therefore hands the choice to whatever order the candidates were built in, and
construction order is not evidence about which instant makes the better picture. Offering the list
moves that decision to the only layer that can see the frame.

#### Scenario: A tied candidate is offered rather than discarded

- **WHEN** a metric's candidate pool contains two instants its own score cannot separate
- **THEN** both are offered, head and alternative, so the consumer rather than the build order
  decides between them

#### Scenario: Offering the list does not change the winner

- **WHEN** a metric that offers alternatives is computed over a candidate set with a single
  best-scoring instant
- **THEN** the emitted exemplar is the one the metric emitted before alternatives existed, with the
  same instants and the same quality
