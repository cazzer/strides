# Drop timestamps from evidence captions

## Why

Every evidence thumbnail's caption ends with when in the clip it was taken — `0.20 s and 0.60 s
into the clip`, or `A single frame, 0.40 s into the clip.` — and that clause is the only part of
the caption a reader cannot act on.

The number is a position in a clip the reader is not scrubbing. The card carries no player, no
timeline and no seek affordance, so nothing on screen turns `0.40 s` into anything the reader can
look at. What the reader needs from a caption is *what am I looking at*, which the metric's own
label already says in the metric's own words — "Most forward trunk lean, ghosted against the most
upright frame", "heel-like footstrike, left foot".

The clause was written when these images were figures in a standalone evidence gallery
(`EvidenceGallery.tsx`, deleted by `strides-ac9.3`), where a caption stood alone under a large
figure and had room to be exhaustive. In a metric card the caption sits under a 144 px thumbnail
beside a description, a value, a confidence line and a caveat — the same crowding argument that
already removed the "not two people" disclaimer from these captions (`aed9a84`).

The timing information is not lost to anyone who needs it: the dev-only `[evidence-coverage]` line
reports every exemplar's `timestamp` and `pairedTimestamp` to full precision, which is where a
harness reads them from today and where this repo's own instructions already say to read them
rather than screen-scraping card text.

## What Changes

- **The caption is the metric's own label**, and for a demoted pair the label plus the sentence
  naming which rule took the pair apart. Nothing else.
- **The `and … into the clip` clause is removed** from the blended-pair caption, the demoted
  caption and the single-frame caption.
- **`A single frame, …` is removed with it.** That sentence existed to host the timestamp and to
  mark the shape; the shape statement survives where it is actually needed — in the text
  alternative, which is read out of context and still says `A single frame from the clip.`
- The demotion sentences (`collapsed-pair`, `far-apart-pair`) are untouched, and so is the alt
  text.

## Impact

- `src/results/evidenceCaptions.ts` only — `captionFor`. No plan, no crop, no extraction, no
  annotation, no metric value.
- **No image changes and no computed value moves.** `EvidenceFramePlan` still carries both
  timestamps; only the sentence rendered under the image is shorter.
- **No change to `[evidence-coverage]`**, so an A/B `before.txt`/`after.txt` is expected to be
  identical outside `elapsedMs` — the driver does not capture caption text.
- Two test files assert the removed clause and are repointed:
  `src/results/evidenceCaptions.test.ts` and `src/results/MetricsPanel.test.tsx`.
