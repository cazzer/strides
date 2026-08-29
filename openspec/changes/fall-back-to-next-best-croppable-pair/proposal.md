# Fall back to the next-best croppable pair

## Why

`rank-exemplar-candidates-by-quality` (strides-9mb) fixed "the score vetoes one pre-chosen instant
instead of ranking many" at the **instant** level. The identical defect survives one level up, at
the **pair** level, and that change exposed it.

`selectExtremePair` returns the single best-scoring pair. Whether that pair can actually be *drawn*
is not part of its score and structurally cannot be: the heuristics layer is pure, has no frame
size, and holds none of the display constants the judgement is made of. The evidence layer then
applies `isTooFarApartPair` and **drops an un-croppable pair outright**. Nothing tries the next-best
pair. One un-croppable winner gates the metric out entirely, even when the same clip offers many
well-scoring pairs that would ghost cleanly.

Measured on Demo 1 `trunkLean` (2026-08-29, real GPU, 3 trials): the ranked winner is app t=6.16
ghosted against t=3.96. Source keyframes put the runner at the far RIGHT edge at 6.16 and the far
LEFT edge at 3.96, having crossed the whole 3840 px frame between them. Its union crop demand is
≈6144 px against a solo demand of ≈900 — growth ≈6.8 against a 2.5 threshold, rejected with a large
margin and correctly so. But **18 instants on that clip clear 1.5 MAD**, many of them close together
in time. A croppable pair almost certainly exists; it is simply never considered.

This is the ticket that gives Demo 1 `trunkLean` a *usable* image. strides-9mb got it to emit;
strides-492 stopped it emitting a blank one; this one gets it to emit a good one.

## What Changes

- **`selectExtremePairs`** (new, `src/heuristics/exemplars.ts`) returns a **ranked list** of
  candidate pairs rather than only the winner, built from the best-ranked ends on each side of the
  metric's median. `selectExtremePair` becomes the one-element wrapper over it, so the two can never
  disagree about which pair is best.
- **A range exemplar carries its lower-ranked pairs with it**, as `MetricExemplar.alternates` — one
  new optional field, purely additive, at most one level deep.
- **The evidence layer walks that list** and plans the first pair it can actually draw, instead of
  dropping the metric when the winner is un-croppable.
- **No threshold moves.** `MIN_EXEMPLAR_QUALITY`, `EVIDENCE_MAX_PAIR_CROP_GROWTH`,
  `EVIDENCE_CROP_MIN_SIDE_PX`, `EVIDENCE_CROP_PADDING_MULTIPLIER` and the 3-MAD outlier bound are
  byte-identical. Nothing about the drawn crop changes.

## Impact

- Affected specs: `form-heuristics` (ranked pair list), `results-view` (the fallback walk).
- Affected code: `src/heuristics/exemplars.ts`, `src/heuristics/trunkLean.ts`,
  `src/heuristics/overstriding.ts`, `src/heuristics/types.ts` (one optional field),
  `src/results/evidenceFrames.ts`.
- `[analysis-diagnostics]` is untouched — it never carried exemplar data. `[evidence-coverage]` is
  untouched in *schema*; its `timestamp`/`pairedTimestamp`/`quality`/`cropGrowth` now report
  whichever pair was actually drawn, which is exactly the instrument this change is verified with.
- A metric that emits no exemplars today, and one whose winner is already croppable, are both
  bit-identical: the walk stops at the first entry, which is the pair strides-9mb already selected.
