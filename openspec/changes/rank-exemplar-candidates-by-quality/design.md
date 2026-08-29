# Design

## The bug, stated precisely

```ts
// today, in both modules
let mostForward = surviving[0]
let mostUpright = surviving[0]
for (const sample of surviving) {
  if (sample.value > mostForward.value) mostForward = sample
  if (sample.value < mostUpright.value) mostUpright = sample
}
const forwardQuality = scoreExemplarInstant(instant(mostForward), 'extreme', distribution)
```

Selection is by value; scoring happens after. `scoreExemplarInstant` therefore acts as a *veto on one
candidate*, not as a ranking over many — and `pairQuality` is a `min`, so one vetoed end is the whole
exemplar. The candidate set is never consulted again.

`quality = detectionFactor × typicality`, and for role `'extreme'`
`typicality = min(1, |v − median| / (3·MAD))`. That product already balances "extreme enough to be
evidence" against "well enough tracked to be readable". Nothing new has to be invented to fix this:
the fix is to rank by the score that already exists, in the order the spec already implies.

## Why the median split, and why it is not an extra rule

Quality is sign-blind for an extreme instant — typicality reads |v − median|, so the most forward
lean and the most upright frame can score identically. An unconstrained "two best-scoring candidates"
rule would happily return the two most forward frames on a clip where the forward end is better
tracked, and a ghost of two near-identical frames depicts nothing.

Splitting at the median and taking the best on each side is the smallest constraint that keeps the
image a range, and it is also **exactly** the best-scoring valid pair rather than an approximation of
it. `pairQuality` is a minimum over two independent scores, so for a pair constrained to one
candidate from each side,

```
max over pairs of min(q_high, q_low) = min( max over the high side of q, max over the low side of q )
```

— the per-side argmax *is* the argmax pair. No O(n²) search, no tie-break heuristic standing in for a
search.

Sides are taken inclusively (`value >= median` and `value <= median`) so a candidate sitting exactly
on the median is eligible for either end rather than silently ineligible for both. With a usable
distribution such an instant scores 0 for the extreme role and never wins anyway; with an unusable
one (fewer than five instances, or a zero MAD) it can win, and losing it would have been a coverage
regression relative to today for no reason anyone could state.

## Tie-break: more extreme wins

Qualities tie often — most visibly when the distribution is unusable and every typicality term is the
flat 0.5 fallback, which is exactly the shape of `overstriding`'s own unit fixture (five identical
ratios, MAD 0). On an exact quality tie the candidate further from the median wins.

That single rule is what makes the change a **strict generalisation** rather than a rewrite: when
every candidate is equally well tracked, quality rises strictly with distance from the median among
survivors, so the per-side argmax is the per-side value extreme and the selected pair is bit-identical
to today's. Both modules' existing exemplar fixtures assert the same timestamps and the same quality
after the change as before, unedited. The behaviour only diverges where tracking quality actually
differs — which is the defect.

The final tie (equal quality, equal deviation) keeps the earlier candidate, matching today's `>` /
`<` scan, so selection stays deterministic and order-stable.

## Shared helper, not two copies

`selectExtremePair` lives in `src/heuristics/exemplars.ts`, beside `scoreExemplarInstant` and
`pairQuality`, and takes the candidates plus a `toInstant` projection:

```ts
selectExtremePair<T>(
  candidates: readonly T[],
  toInstant: (candidate: T) => ExemplarInstant,
  distribution: ExemplarDistribution,
): ExtremePair<T> | null      // { base, ghost, quality }
```

`trunkLean` and `overstriding` differ only in what a candidate is (`LeanSample` vs `StrikeSample`)
and in the seed (`overstriding`'s seed depends on which foot struck), both of which the projection
absorbs. Everything else was already identical, comment for comment — the two hard-reject filters,
the extremes scan, the two `scoreExemplarInstant` calls, the `null` guard, the `pairQuality` call, and
the base/ghost rule with its two paragraphs of identical reasoning. Duplicating the ranking as well
would have made a third and fourth copy of a rule this repo already single-sources at
`MIN_EXEMPLAR_QUALITY`.

`strides-zp6` records that three further `buildExemplars` implementations share this shape. They are
not touched here — this change is a bug fix, and converting metrics that do not have the bug is a
refactor with its own risk. But the helper is deliberately written to be adoptable by them: nothing
in it knows about lean, strikes, or sides.

The helper also absorbs the two hard rejects (`cropDerivable`, `isOutlier`) by routing every candidate
through `scoreExemplarInstant`, whose `null` return already means both. Both call sites were running
those filters and then re-running them inside the score — the pre-filter existed only so the argmax
scan would not pick a rejected candidate, and with ranking there is no separate scan to protect.

## Base and ghost are unchanged

The instant further from the median is drawn at full opacity and the nearer one is ghosted, with ties
going to the high end — the same rule, and the same reasoning, both modules carried before. It moves
into the helper verbatim; it does not become a function of quality. A range ghost is *about* its far
end, and that is a claim about the measurement, not about how well the frame tracked.

## Labels stay as they are

`trunkLean`'s label still reads *"Most forward trunk lean, ghosted against the most upright frame"*,
and `overstriding`'s still reads *"Furthest-reaching footstrike, ghosted against the closest-landing
one"*. Both were already scoped to survivors rather than to the raw frame set — the outlier bound has
always meant "most forward one that is not a tracking glitch". This change widens that same scoping
from one hard reject to a ranked score; it does not change its kind, and a caption hedging with
"among the frames the analysis could read clearly" would be a worse sentence in a card that already
carries a confidence figure.

## Spec delta: ADDED, not MODIFIED

The requirement being clarified — *Exemplar instants are ranked and gated by a per-instance quality
score* — already mandates ranking, and its scenario *An interpolated instant ranks below an equivalent
detected one* already says the detected instant "is preferred". The code contradicts the spec; the
spec does not need its meaning changed. Nothing in the existing requirement becomes false.

The one sentence that could read as tension is the outlier scenario's *"the most extreme surviving
instant is used instead"*. It is a statement about clips where the candidates differ in extremity, not
in tracking, and the new requirement states explicitly that on such a clip the selection still is the
most extreme survivor — so the two agree rather than compete, and the older scenario keeps a
truthful, testable meaning.

Practical reason to prefer ADDED as well: a MODIFIED block replaces the **whole** requirement body, so
two in-flight changes modifying the same requirement clobber each other silently at archive time
(CLAUDE.md records this happening for real on 2026-08-18). This ticket ships in a wave alongside other
evidence work in the same capability. An added requirement cannot participate in that failure.

## Not in scope

- `MIN_EXEMPLAR_QUALITY` (0.5), the 3-MAD outlier bound, `EVIDENCE_CROP_MIN_SIDE_PX` (320) — all
  unchanged. The fix does not need them and moving one to make coverage appear would be editing a
  criterion to match a result.
- GitHub #70 finding 1: the typicality ramp needs `|v − median| ≥ 1.5·MAD` to clear the gate at all,
  and `overstriding`'s measured `maxDevMads` on the multiperson clip is 1.389 — no instant can clear
  it at any `detectionFactor`. Ranking cannot reach that; it is a different axis. `overstriding` is
  expected to still emit nothing, and that is not a failure of this change.
- The three other `buildExemplars` copies (`strides-zp6`), and every metric whose exemplar is
  representative rather than a range.
