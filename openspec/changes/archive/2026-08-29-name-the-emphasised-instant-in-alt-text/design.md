# Design

## D1 — Why the emphasis belongs in the text alternative and not the caption

The caption already carries it implicitly: every paired label reads `X, ghosted against Y`, and
*ghosted against* names a subject and a foil. The caption is not the problem.

The problem is that the requirement governing the **text alternative** asked only that it name the
metric and the side, and the alt string is what a screen reader announces for the image node itself.
`MetricsPanel.tsx:166` renders `<EvidenceCanvas alt={altFor(item.plan)} />` and the caption is a
sibling `<figcaption>`. A reader moving through the figure does reach both — the linear read was
checked and is sound — but the image node's own description claimed a symmetric blend for an image
that is no longer symmetric.

So this is a correction to a description that quietly went stale when the weighting shipped, not a
new affordance.

## D2 — Why "the first instant named above" rather than the metric's own words

Two rejected alternatives:

- **Repeat the base instant's phrase** ("Most forward trunk lean is shown solid"). Requires slicing
  the label at its comma, which is a parsing dependency on prose that each metric writes freely.
  `trunkLean.ts` and `kneeFlexion.ts` already differ in shape.
- **Emit a structured base/ghost description per metric.** Every metric module would have to write a
  second string, and `evidenceCaptions.ts` exists precisely so the words live in one place.

Referring to the first named instant costs nothing and is stable, because the ordering is not
incidental: `EvidenceFramePlan.base` is what the label names first, in all four paired metrics. If a
metric ever emitted `Y, ghosted against X` the clause would be wrong — so the invariant is stated in
`altFor`'s doc comment where a future author of a paired label will see it.

## D3 — Why single-frame and demoted-pair images are excluded

A demoted pair carries `ghost: null`. Nothing is blended, one frame is drawn, and the caption
already says *"Shown as one frame: the paired instant was too similar to tell apart."* Adding an
emphasis clause would describe a second position that is not in the image — the same class of error
as the reference-posture overlay the results-view spec forbids. Asserted directly rather than left
to reading: the suite covers both the single-frame and the demoted-pair shapes.

## D4 — The clobber hazard this change waited on

The requirement modified here also carries the *"at most one detached decoder open at a time"*
clause. `strides-3uy` was in flight against that same concurrency property when this work was done.

Per CLAUDE.md's recorded incident, a MODIFIED block replaces the whole requirement body, two changes
modifying the same requirement clobber each other silently, and `openspec validate --strict` does not
catch it. So the code shipped first and this delta was deliberately held until `strides-3uy` landed.

It turned out `share-one-detached-video-decoder` **ADDED** a new requirement to `video-input` rather
than modifying this one — so no reconciliation was needed in the end. The wait was still correct: it
was not knowable in advance, and the cost of waiting was one ordering step against a failure mode
that is invisible when it happens.
