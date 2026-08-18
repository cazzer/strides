# Concise evidence captions

## Why

Every blended evidence thumbnail carries a two-sentence caption. The first sentence is the metric's
own words for the pair — *"Highest point of the bounce, ghosted against the lowest."* The second is
boilerplate: *"The two overlapping positions are the same runner at two instants of the same run,
blended into one image — not two people."*

That second sentence is dead weight in the card layout it now lives in. It was written for a
standalone gallery figure, where an image sat alone under a heading with room to explain itself. The
gallery is gone (`2026-08-17-inline-annotated-evidence`, `strides-ac9.3`); the caption now sits in a
metric card beside a description, a number, a confidence line and a caveat, and it is the longest
line in the card while saying the least.

It is also redundant with the sentence above it. "Ghosted against" already names one subject at two
moments — a runner cannot be ghosted against somebody else. The disclaimer restates in twenty-eight
words what the label established in three.

## What changes

- Blended captions drop the "same runner … not two people" sentence. A ghosted caption becomes the
  metric's label plus the two timestamps.
- Alt text is unchanged. It keeps "Two frames of the same runner blended into one image", because
  alt text is read out of context — a screen-reader user gets no metric card around it.
- `results-view`'s captioning clause and its scenario are narrowed to match.

## Impact

- `src/results/evidenceCaptions.ts` — one branch of `captionFor`.
- `src/results/MetricsPanel.test.tsx` — the assertion that pinned the removed sentence.
- `openspec/specs/results-view/spec.md` — via the delta in this change.

No image, plan, extraction or annotation behaviour changes. Nothing outside the caption string moves.
