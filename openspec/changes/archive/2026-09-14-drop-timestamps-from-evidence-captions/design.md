# Design

## D1. What the caption becomes

Three shapes in, two sentences out:

| plan shape | before | after |
|---|---|---|
| blended pair | `{label}. 0.20 s and 0.60 s into the clip.` | `{label}.` |
| demoted pair | `{label}. {demotion sentence} 0.40 s into the clip.` | `{label}. {demotion sentence}` |
| single instant | `{label}. A single frame, 0.40 s into the clip.` | `{label}.` |

`formatSeconds` loses its last caller and goes with the clause.

## D2. Why `A single frame,` goes too

It reads as a shape statement and was one, but only incidentally — it existed as the carrier for the
single-instant timestamp, which is why it is a subordinate clause of one rather than its own
sentence. Keeping it alone under a card would be a sentence saying an image is one image, next to
the image.

The shape statement is load-bearing in exactly one place and survives there untouched: `altFor`,
which says `A single frame from the clip.` or names the blend explicitly. Alt text is read with none
of the card and none of the neighbouring thumbnails around it, so "one frame or two" is not
recoverable from context there the way it is for a sighted reader looking at the picture.

A demoted image is the one case where the caption keeps a second sentence, and it is not a shape
statement — `Shown as one frame: the paired instant was too …` says why the picture is not the pair
its label describes. `strides-ddj` is the standing argument for it and nothing here touches it.

## D3. Why not keep the timestamp behind a title attribute or a hover

Rejected as a smaller version of the same problem. A clip time is not actionable in this card at any
level of prominence — there is nothing to seek — so hiding it makes it undiscoverable rather than
useful, and adds an affordance a reader has to find out about.

## D4. Blast radius

`captionFor` has one caller, `MetricsPanel.tsx`. `EvidenceFramePlan` is unchanged — both timestamps
stay on the plan, which is what `extractFrames.ts` seeks to and what the `[evidence-coverage]` line
reports. So the pixels are bit-identical and every dev-only diagnostic line is byte-identical; only
the `<figcaption>` text is shorter.

The A/B driver (`scripts/ab-person-selection.mjs --evidence`) captures `[evidence-coverage]`, not
caption text, so a before/after run is expected to differ on `elapsedMs` alone. That is a
confirmation that nothing else moved, not evidence the change failed to land — the caption is
checked by unit test instead, the same split `resolve-the-overstriding-sampling-instant` used for a
caveat-only change.
