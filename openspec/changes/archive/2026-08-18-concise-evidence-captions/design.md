# Design

## The one decision: caption drops it, alt text keeps it

`captionFor` and `altFor` (`src/results/evidenceCaptions.ts`) both say the two-bodies thing today.
Only the caption loses it.

They are read under different conditions. A caption is read *inside the card* — the metric's label is
one line above it, the annotated image is right there, and "ghosted against" has already established
one subject. Alt text is read *instead of* the image, by a reader who has neither the picture nor
necessarily the surrounding card in view, so the shape of the image ("two frames blended into one")
is load-bearing information rather than a restatement.

Keeping them symmetric would mean either re-adding boilerplate to the caption or removing real
information from the alt text. Neither is better than letting the two strings differ.

## What the caption becomes

Before (Demo 1, `verticalOscillation`):

> Highest point of the bounce, ghosted against the lowest. The two overlapping positions are the same
> runner at two instants of the same run, blended into one image — not two people. 1.20 s and 1.44 s
> into the clip.

After:

> Highest point of the bounce, ghosted against the lowest. 1.20 s and 1.44 s into the clip.

The `demotedFromPair` and single-frame branches are untouched — neither ever carried the sentence.

## Why the original sentence existed, and why that reason expired

`2026-08-17-metric-frame-evidence` wrote it for a standalone gallery, where an image sat alone under a
section heading. `2026-08-17-inline-annotated-evidence` deleted the gallery and moved every image into
its metric's card, but carried the caption strings across "verbatim in intent" rather than re-deciding
them against the new surround. This change is that re-decision.

That same epic's design.md already flagged the sentence as actively wrong in one measured case: the
Demo 2 `armSwingSymmetry` crop includes a bystander, and the caption insisted "not two people" over an
image containing two. Removing the claim removes that contradiction as a side effect; it is not the
motivation, and the crop defect (`EVIDENCE_CROP_MIN_SIDE_PX`) is untouched and still open.

## Not in scope

- Annotation geometry, crops, planning, extraction — no pixels change.
- The other two caption branches.
- `EVIDENCE_CROP_MIN_SIDE_PX` / the bystander crop.
