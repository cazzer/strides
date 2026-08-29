# Design — fall back to the next-best croppable pair

## The tension

Pair ranking is **pure**: `selectExtremePair` lives in `src/heuristics/exemplars.ts`, sees frames
and values, and nothing else. Pair *croppability* is **display-shaped**: it is decided by
`isTooFarApartPair` against `EVIDENCE_MAX_PAIR_CROP_GROWTH` (2.5), `EVIDENCE_CROP_PADDING_MULTIPLIER`
(1.6) and `EVIDENCE_CROP_MIN_SIDE_PX` (320) — three constants whose stated derivations are about a
112 px card thumbnail, not about running form.

The purity boundary is load-bearing rather than decorative: this repo's unit suite runs where
`getContext('2d')` returns `null` by deliberate choice, precisely so that geometry decisions cannot
hide inside draw calls. So the fix may not simply teach `exemplars.ts` what a crop is.

## Options considered

### (a) Pass a pair-admissibility predicate into `selectExtremePair`

`selectExtremePair(candidates, toInstant, distribution, isAdmissiblePair?)`, with the caller
supplying the frame-size-dependent test. In isolation this is the most attractive option and it is
the only one that gives an **exact** search — the selection walks the true ranked order and stops at
the first admissible pair, with no arbitrary prefix.

It fails on where the caller *is*. `selectExtremePair` is called from `buildExemplars` inside
`computeTrunkLean` / `computeOverstriding`, which are called from `computeFormHeuristics`, which is
called from `useVideoAnalysis`. Frame size enters the app at `planClipEvidence`, downstream of all
of that. Supplying the predicate therefore means threading either the frame size or the predicate
itself through `computeFormHeuristics` and its config type — i.e. importing a display concept into
the pure layer's public signature, which is exactly what the boundary exists to prevent. The
alternative, having `trunkLean.ts` build the predicate itself, requires `src/heuristics/` to import
the three display constants from `src/results/evidenceFrames.ts` — a layering inversion, and a
second home for thresholds whose whole design is that they have one.

**Rejected.** Not because it is unclean in form — an opaque predicate parameter is a perfectly
respectable inversion — but because there is no honest way to reach the call site with one.

### (c) Re-rank from the metric's full candidate set in the evidence layer

**Rejected, and it is worse than the ticket suggests.** It duplicates ranking logic that
strides-9mb just finished single-sourcing, *and* it does not actually work with the data on hand:
`planMetricEvidence` receives `MetricResult` plus `RobustPoseFrame[]`. It has no per-instance values
and no `ExemplarDistribution`, so it cannot tell which frames were candidate instants, which side of
the median each sits on, or what any of them would score. Making it able to would mean shipping the
metric's entire per-instance sample series across the boundary — a far larger contract widening than
option (b)'s, in exchange for the duplication.

### (b) Return a ranked list and let the evidence layer walk it — **chosen**

The heuristics layer ranks; the evidence layer, which legitimately holds frame size and the display
constants, tests drawability. Neither learns anything about the other. This is also how
`planMetricEvidence` **already** consumes exemplars — "the budget is applied AFTER this layer's own
drops, so a metric whose first choice cannot be resolved here still spends its second — and without
re-sorting, because the emitting metric already ranked them". The change extends an existing
mechanism rather than inventing one.

## What it cost the `MetricExemplar` contract

One optional field:

```ts
alternates?: MetricExemplar[]
```

Self-referential rather than a new narrower type, for two reasons. First, `types.ts` cannot import a
type from `exemplars.ts` — `exemplars.ts` imports `types.ts`, so the narrower type would have to be
declared in `types.ts` anyway, doubling the delta for nothing. Second, almost every field genuinely
varies per pair: `timestamp`, `pairedTimestamp`, `quality`, `cropKeypoints` (context keypoints are
included only when they resolve *in that pair's own frames*), and for `overstriding` also `side`,
`measuredSide` and `pairedMeasuredSide`. Only `kind` and `label` are constant. A "narrower" type
would have been `MetricExemplar` minus two fields.

Documented as **one level deep**: an alternate never carries alternates of its own.

What it did *not* cost:

- **`[evidence-coverage]` schema: unchanged.** `summarizeEvidenceCoverage` reads
  `EvidenceFramePlan` items, never `MetricExemplar` — verified by reading it. Its
  `timestamp`/`pairedTimestamp`/`quality`/`cropGrowth` now describe whichever pair was drawn, which
  is the point, and is the instrument this change is verified with.
- **`[analysis-diagnostics]`: unchanged.** `analysisDiagnostics.ts` contains no reference to
  exemplars at all.
- **`selectExemplars` and `MAX_EXEMPLARS_PER_METRIC`: unchanged.** A range metric still emits
  exactly one `MetricExemplar`; the alternates hang off it. The budget still counts images.
- **`planExemplarFrames`: unchanged.** The fallback is a new wrapper around it, so all of its
  existing drop rules and their tests apply to every candidate pair unmodified.
- **`scalePassGraft.ts`: unchanged.** It carries `exemplars` verbatim, so alternates ride along.

### ⚠️ This edits `src/heuristics/types.ts`, which the briefing reserved for `strides-ich`

Flagged prominently because it was an explicit instruction. The edit is a **single purely additive
optional property plus its doc comment**, inserted inside `interface MetricExemplar` (types.ts:97-152).
`strides-ich` owns view detection and confidence, whose types live at lines 11-51 and 381-651 —
disjoint hunks that git merges without conflict. There is no version of options (a), (b) or (c) that
does not touch a reserved file: (a) needs `index.ts` *and* the config type in `types.ts`, (c) needs a
much larger `types.ts` change. The only way to avoid `types.ts` entirely was to carry alternates as
**sibling** entries in `metric.exemplars` and teach the evidence layer to keep at most one planned
item per `(kind, side)`. That was rejected: it makes an entry in `exemplars` sometimes an image and
sometimes an alternate for a different entry, keys the distinction on an implicit tuple nothing
declares, forces a semantic change to `MAX_EXEMPLARS_PER_METRIC`, and would have needed the doc on
`MetricResult.exemplars` rewritten — in `types.ts`.

## The search and its bound

### Why a bound is needed at all

strides-9mb's shortcut was `max over pairs of min(q_high, q_low) == min(max q_high, max q_low)` —
the per-side argmax *is* the argmax pair, so the winner needs no search. Wanting the *next* best
admissible pair breaks that identity: admissibility is not separable across the two sides, so the
ordering must be over pairs. On Demo 1 `trunkLean` the eligible set is ~59 instants, roughly 30 per
side, i.e. **~870 pairs**. Enumerating that blindly, and shipping it, is not acceptable.

### The bound: `EXEMPLAR_PAIR_ENDS_PER_SIDE = 6`

Rank the ends on each side of the median exactly as before, keep the best **6 per side**, and form
all ≤ **36** pairs. Cost per range metric: one sort per side, `O(n log n)`, plus a 36-element sort —
constant in the candidate count. The evidence layer runs at most 36 `planExemplarFrames` calls per
exemplar, each two `findNearestFrame` scans and a handful of box computations.

**Bounded per side, not per pair, deliberately.** A pair is undrawable because of *where its ends
sit*. The best N pairs, ranked purely by quality, can be dominated by a single positionally-unlucky
end paired against many partners — which is precisely the Demo 1 failure, where one end is at the
frame's right edge. A per-side bound structurally guarantees six distinct alternatives for each end,
so neither end alone can exhaust the list.

Six rather than four: the fallback only has to find one admissible partner, and the marginal cost of
two more ends per side is two more sort entries and at most twenty more cheap plan attempts. Six
rather than sixteen: the list is carried on `FormHeuristicsResult`, which lives in React state and
is grafted across passes, and 36 small objects per range metric is already generous for a mechanism
whose expected depth is one.

### Ranking within the bound is exact, not approximate

Because the retained set is small enough to enumerate in full, every pair is scored and the list is
totally ordered — there is no best-first frontier and therefore no monotonicity obligation on the
tie-break.

Order: `pairQuality` descending, then **the sum of the two ends' own per-side ranks** ascending.

The tie-break matters and is not arbitrary. Ties are common rather than exotic — with no usable
distribution every typicality term is the flat 0.5 fallback, so an entire candidate set can score
identically. Using per-side rank keeps `betterEnd`'s existing rule as the only rule: each side is
ordered by `(quality desc, deviation desc)` exactly as `betterEnd` prefers, and `(0, 0)` is the
unique minimum of `i + j`, so **the head of the list is provably the pair `selectExtremePair`
already returned**. A tempting alternative — break ties by the widest total deviation — fails that:
a lower-quality end can carry a larger deviation, so `(1, 0)` could tie on the minimum and outrank
`(0, 0)`, silently changing which pair every clip renders.

`selectExtremePair` is accordingly reimplemented as `selectExtremePairs(..., 1)[0] ?? null` rather
than kept as a parallel implementation, so the two cannot drift.

## Preserved from strides-9mb, item by item

- **Candidates ranked by `scoreExemplarInstant`** — unchanged; both sides are ranked by it and
  `pairQuality` is still the minimum of two such scores.
- **One end per side of the median** — unchanged, and now enforced per *pair* rather than once:
  every pair in the list draws one end from each side. Sides remain inclusive, so an instant sitting
  exactly on the median is eligible for either.
- **Hard rejects stay ineligible, not low-ranked** — unchanged: `scoreExemplarInstant` returning
  `null` (no derivable crop; beyond the outlier bound) skips the candidate before it enters either
  side's ranking, so no alternate can promote a tracking glitch.
- **Base/ghost by distance from the median** — unchanged, applied per pair.

One rule generalises rather than being preserved verbatim. Today, a winning pair whose two ends
share a value returns `null` outright; since `high.value >= median >= low.value`, that can only
happen when both ends sit exactly *on* the median. Such a pair is now **skipped and the next
considered** rather than terminating the search — the same "one pre-chosen pick vetoes many"
correction this change is about, in its smallest form.

It cannot change the winner, and the argument is worth stating because it is what makes the
generalisation safe. With a usable distribution a median-valued instant scores typicality 0, so any
off-median candidate on the same side outranks it (a tie at 0 breaks on deviation, which also
prefers the off-median one). `highs[0].value === lows[0].value` therefore requires *every* value to
equal the median — a clip whose measurement never varied, which returned nothing before and returns
nothing now. Where the skip actually bites is deeper in the list: this repo's own test fixture has
two median-valued candidates, so the median-against-median combination genuinely arises as a
*candidate alternative*, and skipping it is what stops a degenerate "range" of zero width being
offered as a fallback.

## Falling back on any failure, not only on far-apart

`planExemplarFrames` returns `null` for several reasons: the ghost not snapping, both halves landing
on one frame, near-identical boxes, no derivable crop box, no crop rect — and the far-apart
rejection. The walk retries on **all** of them. Each is "this particular pair cannot be drawn", and
a lower-ranked pair may suffer from none of them; retrying only on far-apart would fix one symptom
of a defect that is about the absence of a fallback.

This weakens nothing. Each candidate is planned by exactly the same function under exactly the same
rules, and the emission-quality gate is re-asserted per candidate the way `planMetricEvidence`
already re-asserts it for the winner. In particular a far-apart pair is still *dropped* rather than
demoted to its base — the fallback replaces the whole pair, it never rescues half of one, so
`isTooFarApartPair`'s stated reason (every paired label is a claim about two instants) is untouched.

## Constants

Byte-identical, verified by `git diff`:

| constant | value |
|---|---|
| `MIN_EXEMPLAR_QUALITY` | 0.5 |
| `EVIDENCE_MAX_PAIR_CROP_GROWTH` | 2.5 |
| `EVIDENCE_CROP_MIN_SIDE_PX` | 320 |
| `EVIDENCE_CROP_PADDING_MULTIPLIER` | 1.6 |
| `OUTLIER_BOUND_MADS` | 3 |

`MAX_EXEMPLARS_PER_METRIC` (2) is also unchanged in value *and* in meaning. `computeCropRect` and
the drawn crop are untouched.

## Expected effect, and what would count as a finding

Demo 1 `trunkLean` should emit a pair whose crop contains the runner at both instants, at a
`cropGrowth` in the range every surviving pair on the three test clips already occupies — 1.000 to
2.190 — and certainly below 2.5, since anything at or above it is what the walk rejects. The
multiperson `kneeFlexion` anchor at 2.190 is not reachable by this change: its winner is already
drawable, so the walk stops at entry one and nothing about it moves.

If instead all 36 pairs on Demo 1 `trunkLean` are inadmissible, that is a legitimate result to
report with its numbers — the correct response would be to widen the per-side bound only if the
measured growths show admissible pairs sitting just outside it, and never to move 2.5.
