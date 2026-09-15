# Design

## D1. Where "pending" comes from

`useSessionEvidence` already computes a `ClipEvidencePlan` per clip before deciding whether to open a
decoder — that is what `canReuseCachedEvidence` compares. `plannedMetrics` reads the same selection
`buildSections` makes, one step earlier and off the plan instead of the result: for each metric, the
entry at that metric's winning clip (`sourceIndices`), kept where its status is `'planned'`.

It has to be the plan rather than the eventual evidence, because the placeholder's whole job is to be
up *before* the pixels exist.

## D2. Pending excludes what is already on screen

`extracting` carries the previous pass's sections forward (`strides-3ui`). Those cards are showing
correct pictures. `pending` therefore subtracts them:

```
pending = planned.filter(m => !carried.some(s => s.metric === m))
```

- **First extraction** — `carried` is empty, so every planned metric is pending. This is the window
  the reader most often sees.
- **Scale-pass re-extraction** — the eleven carried metrics keep their images and are not pending;
  `verticalOscillationCm`, which the first plan marked `metric-excluded` and the grafted plan marks
  `planned`, is.
- **Clip added or removed** — `sameClipSet` already refuses to carry sections (a `clipIndex` is a
  position, and the positions moved), so everything planned is pending again. That is the right
  answer for the same reason it is right on a first run.

## D3. Why the state carries metric ids and not rendered entries

`SessionEvidenceState` is about extraction, not about cards, and `EvidenceSection` means "pixels that
exist". A pending entry has no pixels, so folding it into `sections` would make that type's meaning
conditional — and `sections` is mirrored into `sectionsRef` and carried into the *next* run, where a
stale placeholder would ride along as if it were imagery.

The composition into card-shaped entries happens where the cards are assembled
(`MultiClipVideoSession`), which is also where `sourceIndices` is already in hand.

## D4. `MetricCardEvidence.pending` is optional

Every existing construction of that type is settled imagery, and an optional field leaves all of them
— including `EvidenceSection`, which is structurally assignable — untouched. A required `pending:
false` on every settled entry would be a field that is always false.

## D5. What the placeholder is

A `w-36` square (the thumbnail's own width) with the `animate-pulse` treatment the clip strip already
uses for "working", marked `aria-hidden`, plus a plain sentence, inside a region marked
`aria-busy="true"`. Two signals rather than one: an animated block alone says nothing to a reader
with motion reduced or a screen reader running.

**The sentence is deliberately not a live region**, unlike this app's other progress affordances
(`ClipLoadStatus`, `DemoVideoButton`, `WebcamCapture`), and the difference is cardinality: those are
one-per-page, this is one per pending card. Measured live on `park-side-landscape`, a first
extraction has **six** cards pending simultaneously and the scale-pass plan takes it to **seven** —
seven live regions carrying one identical sentence would announce a single event seven times.
`aria-busy` on the awaiting region states the same fact without narrating it.

No caption and no `<figure>` — there is no picture to caption, and captioning an empty box would be a
statement about an image that is not there.
