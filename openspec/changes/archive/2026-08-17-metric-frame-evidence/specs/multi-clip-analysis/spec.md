# multi-clip-analysis (delta)

## ADDED Requirements

### Requirement: The fusion source clip is exposed as a machine-readable per-metric index

The system SHALL expose, as a pure function sitting alongside per-metric fusion, a mapping from each
`MetricId` to the zero-based index of the clip whose `MetricResult` won that metric. The mapping
SHALL be derived with the **same** selection rule fusion itself uses, so the two can never disagree
about which clip won a metric. Given a single input the mapping SHALL report index `0` for every
metric.

This SHALL be a sibling function rather than a change to the fusion function's return shape. Fusion's
guarantee that a single input is returned by reference, unchanged, is load-bearing for proving that
adding this capability moves no number, and altering its return shape would force that guarantee to
be re-established rather than simply preserved.

Consumers needing to know which clip a fused metric came from SHALL read this mapping. They SHALL NOT
recover it by parsing the human-readable provenance sentence fusion appends to the winning metric's
caveat: that sentence is copy for a reader, not a data channel.

#### Scenario: The sibling mapping agrees with fusion on every metric

- **WHEN** several clips are fused
- **THEN** for every `MetricId`, the mapped index names the same clip whose `MetricResult` fusion
  selected for that metric

#### Scenario: A single clip maps every metric to index zero

- **WHEN** exactly one result is given
- **THEN** every metric maps to index `0`, and fusion's own single-input reference-identity behaviour
  is unchanged

### Requirement: Exemplar instants are resolved against the clip that produced them

Because fusion selects the **whole** winning `MetricResult` per metric, a metric's exemplar
timestamps can refer to a different clip than the one a consumer is displaying, and a naive consumer
would resolve them against the wrong clip's frames — landing on a real-looking but wrong moment, or
on the first or last frame of an unrelated clip.

The system SHALL therefore resolve a fused metric's exemplars — both the frames used to derive their
crop regions and the media they are extracted from — against the clip named by the per-metric source
index above, never against a clip chosen by display position or by assuming the first clip. Exemplars
SHALL NOT be dropped on fusion: discarding them would remove all evidence for every metric whose
winner is not the first clip, degrading the capability precisely when a user has done the extra work
of adding a second clip.

An exemplar SHALL NOT itself carry a clip identifier. Exemplars are produced by the per-clip metric
computation, which has no concept of a clip session; a clip identifier written there would be
meaningless for a single-clip run and would duplicate, and eventually contradict, the source index.

Where a metric's result was replaced by a second pass over the **same** clip, its exemplar timestamps
remain on that clip's media clock and SHALL remain valid; their crop regions SHALL be derived by
resolving those timestamps against the frames the consumer actually holds for that clip, dropping any
exemplar that resolves to no nearby frame. However, when the two passes over that clip are judged to
have selected **different subjects**, the replaced metrics' exemplars SHALL be dropped entirely — a
crop derived from one subject's position, captioned with a number measured from another's, would
assert an identity the system knows to be in doubt, and an image asserts that identity far more
strongly than a caveat sentence can qualify it.

When more than one clip is present, the interface SHALL indicate which clip a metric's evidence came
from.

#### Scenario: A metric won by the second clip resolves against the second clip

- **WHEN** two clips are fused and a metric's winning result came from the second clip
- **THEN** that metric's exemplars are resolved against the second clip's frames and media, not the
  first clip's, and the interface indicates which clip the evidence came from

#### Scenario: Exemplars survive fusion rather than being discarded

- **WHEN** a metric's winning result came from a clip other than the first
- **THEN** its exemplars are still available as evidence, rather than dropped because they crossed a
  fusion boundary

#### Scenario: A metric replaced by a same-clip second pass keeps its evidence

- **WHEN** a metric's result is replaced by a second pass over the same clip, and that pass's subject
  agrees with the first pass's
- **THEN** its exemplar timestamps are resolved against the frames the consumer holds for that clip,
  and any exemplar with no frame within the snapping tolerance is dropped

#### Scenario: A diverged second pass loses its evidence entirely

- **WHEN** a metric's result is replaced by a second pass over the same clip whose selected subject
  is judged to have diverged from the first pass's
- **THEN** that metric's exemplars are dropped and no imagery is rendered for it, while the replaced
  value, its confidence, and its divergence caveat are unaffected
