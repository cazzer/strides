# Measure a ghosted pair's crop growth before the frame cap clamps it

## Why

`evidencePairCropGrowth` (`src/results/evidenceFrames.ts`) is the guard that stops a metric card
from shipping an unreadable ghost — a runner who crossed the frame between the two instants, unioned
into a crop that is mostly background with a smudge at each edge (gh #71). It reads
`cropSide(union) / max(cropSide(base), cropSide(ghost))` with **both** sides passed through
`computeCropRect`, which applies a `min(frameWidth, frameHeight)` cap.

That cap binds on the numerator long before the separation stops growing, so past a certain point
every pair reads the same number. Measured by calling the exported function with synthetic boxes on
3840×2160 with a 320×1240 full-body box:

| pair geometry | growth | verdict at `EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5` |
|---|---|---|
| adjacent | 1.000 | pass |
| half a frame apart | 1.0887 | pass |
| **opposite edges of the frame** | **1.0887** | **pass** |

The worst pair a 4K clip can produce scores 1.09 against a threshold of 2.5, and is
indistinguishable from one at half that separation. On a 4K clip with a large subject the guard is
structurally incapable of firing at any separation.

The constant's own doc asserted the measure is "self-cancelling under both of `computeCropRect`'s
clamps, since a floor or a cap that binds on the pair's crop binds on the single's too". That is
true of the floor and false of the cap: a floor binds from below and genuinely cancels, a cap binds
from above and annihilates the signal instead.

**Observed live, not hypothetical.** After `strides-9mb` ranked exemplar candidates by quality,
Demo 1's `trunkLean` pairs app `t=6.16` with `t=3.96`. The source keyframes put the runner at the
far right edge at 6.16 and the far left edge at 3.96, having crossed the whole frame between them.
The union crop saturates at 2160, centres on empty track, and **both** runners fall outside it. The
rendered image is bare track and fence — no runner, no annotation — shipped as evidence for a 13.3°
trunk lean. `MIN_EXEMPLAR_QUALITY`'s own doc says "better to show nothing than a picture nobody
should read as evidence".

## What Changes

- The growth measure reads the crop side each box **demands** — padding and the degenerate-box floor
  — instead of the crop `computeCropRect` can supply. The frame cap leaves the measure; it stays on
  the crop that is actually drawn, which is unchanged.
- `EVIDENCE_MAX_PAIR_CROP_GROWTH` (2.5), `EVIDENCE_CROP_MIN_SIDE_PX` (320),
  `EVIDENCE_CROP_PADDING_MULTIPLIER` (1.6) and `MIN_EXEMPLAR_QUALITY` (0.5) are **unchanged**. The
  fix needs no threshold move, and moving one would be editing a criterion to match a result.
- The false "self-cancelling under both clamps" claim in `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s doc is
  replaced with the asymmetry that actually holds, plus why a demand ratio is not the "did the crop
  hit the cap" test that same doc correctly rejects.
- The development-only `[evidence-coverage]` line gains a `cropGrowth` number beside the existing
  `cropSidePx` on each exemplar record, so the threshold's calibration bracket can be re-measured on
  real footage without a probe patch.

## Impact

- Affected specs: `results-view`
- Affected code: `src/results/evidenceFrames.ts` and its tests; four test files that construct an
  `EvidenceFramePlan` literal.
- No user-visible change except the one intended: a pair that cannot be ghosted legibly is dropped,
  and the metric card falls back to no evidence rather than to a picture of empty track.
- No drawn crop changes. `computeCropRect` is untouched.
