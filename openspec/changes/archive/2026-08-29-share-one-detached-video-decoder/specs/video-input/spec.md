## ADDED Requirements

### Requirement: One transient video decoder across every feature that opens one

More than one feature decodes a clip's retained source blob on a transient `<video>` element of its
own — poster derivation and evidence-frame extraction today. The system SHALL hold **at most one such
decoder open at a time counted across all of them**, not one per feature, and SHALL enforce that
through a single shared serialization point that every transient decoder passes through.

A per-feature ceiling does not compose. Two features, each correctly bounded at one decoder, permit a
global peak of two; a third would permit three. These are full-resolution decoders held open at the
clip's own dimensions — 4K for this app's own reference footage — and they are opened while a live
sampling run competes for the same memory and GPU, which is the reason the ceiling exists at all. The
bound therefore SHALL be stated and enforced globally rather than assembled out of per-feature
guarantees.

The features SHALL NOT be relied on to stay apart in time. Posters are derived when a clip is added
and extraction runs after that clip's analysis, which separates them in practice on this app's own
footage, but nothing holds those windows apart: a slow decode on a large clip, or a faster analysis
path, overlaps them. Ordering that arises from measured timings is not a guarantee.

The serialization point SHALL survive a decode that fails outright, including one that throws. A
failure in one feature's decode SHALL NOT prevent any decode queued behind it from taking its turn,
**including a decode belonging to a different feature** — sharing one queue must not give either
feature a new way to wedge the other. The failure SHALL still reach whoever asked for that decode
rather than being swallowed on their behalf.

Work with nothing to decode SHALL NOT take a place in the queue. A request with no source bytes, or
one already abandoned, opens no decoder, so making it wait behind one would be latency for nothing.

This requirement constrains only how many transient decoders may be open and how they are ordered. It
SHALL NOT be read as a schedule: each feature keeps its own answer for when it runs, and one of them
deliberately runs during sampling while another runs only after analysis.

#### Scenario: A poster derivation and an evidence extraction asked for in the same tick

- **WHEN** a poster derivation and an evidence extraction are both requested before either has opened
  a decoder
- **THEN** the second one's decoder is opened only after the first one's has been torn down, so one
  decoder is open at any instant rather than one of each

#### Scenario: The ordering does not depend on which feature asked first

- **WHEN** an evidence extraction is requested before a poster derivation, rather than after it
- **THEN** the two are serialized against each other exactly as they are in the other order — the
  shared ceiling has no preferred kind of decoder

#### Scenario: One feature's failed decode does not block another's

- **WHEN** a transient decode fails outright, including by throwing
- **THEN** the failure reaches whoever requested that decode, and a decode requested by a different
  feature still gets its turn afterwards

#### Scenario: A request with nothing to decode waits for nothing

- **WHEN** a transient decode is requested with no source bytes, or is abandoned before it starts
- **THEN** it resolves without taking a place in the queue, and does not delay behind a decode
  already in progress
