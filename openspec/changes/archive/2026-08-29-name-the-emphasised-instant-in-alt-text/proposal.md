# Name the emphasised instant in evidence alt text

## Why

`weight-evidence-ghost-below-base` made a ghosted evidence photograph asymmetric: it composites
65/35 toward its base instant, and `evidenceAnnotations.ts` already drew the base's marks solid
against the ghost's faded ones. A sighted reader therefore learns which instant the card's
measurement is about **twice over** — once from the weighting, once from the marks.

Neither channel is text. `altFor` (`src/results/evidenceCaptions.ts`) said only:

> Two frames of the same runner blended into one image.

— which states the *shape* of the image and not its *emphasis*. A reader using a screen reader got
the fact that two instants are blended, with nothing to say which one is the subject. The caption's
`X, ghosted against Y` label implies it, but the caption is a sibling node, and the requirement
governing the text alternative asked only that it name the metric and the side.

This is a gap rather than a contradiction — nothing said the wrong thing — but it is exactly the
kind of gap that closes silently: with no requirement asserting the emphasis, a later edit could
drop the clause and no gate would notice.

## What changes

The text alternative for a blended image says which of the two instants is shown emphasised.

Naming the **first** instant is general rather than a per-metric claim: every paired `label` this
repo emits is `"X, ghosted against Y"` with the base named first — `bounceInstants.ts:236`,
`kneeFlexion.ts:117`, `overstriding.ts:96`, `trunkLean.ts:83`.

Single-frame and demoted-pair images are unaffected: they carry `ghost: null`, nothing is blended,
and there is no second instant to point at. Claiming an emphasis there would describe an image that
is not on screen.

## Impact

- `openspec/specs/results-view/spec.md` — one MODIFIED requirement, *Evidence renders as annotated
  thumbnails inside the metric card*: its text-alternative prose and its scenario *A ghosted
  thumbnail says it is one runner, not two people*.
- `src/results/evidenceCaptions.ts` — `altFor`'s blended shape sentence.
- `src/results/evidenceCaptions.test.ts` — **new file**; `altFor` and `captionFor` had no direct
  test, covered only transitively by one `getByRole('img', { name: … })` assertion in
  `MetricsPanel.test.tsx`, which left the single-frame, demoted-pair and per-side branches
  unasserted.

No behaviour change to any image, metric, crop or annotation. Text only.
