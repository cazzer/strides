# Design — what actually drops `verticalRatio`'s stride pair

## D1. Method

Two temporary probes, added / measured / reverted per CLAUDE.md's cycle (`git status` clean
afterwards, verified):

1. `[vr-exemplar-probe]` in `useVideoAnalysis.ts`'s dev diagnostics effect — dumps
   `verticalRatio.exemplars` as the METRIC emits them, before any planning.
2. `[plan-drop-probe]` on every `return null` path in `planExemplarFrames`
   (`evidenceFrames.ts`) — names which gate refused the pair, with its numbers.

Driven headless on real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), Demo 1, dev server on this
checkout's derived port, `[evidence-coverage]`'s LAST line read.

## D2. The metric emits it. Planning drops it.

The first probe settles the ticket's "upstream gate or planning gate" question outright:

```json
{"value": 0.03104188269001885, "exemplars": [
  {"kind":"bounceCycle","quality":1,"timestamp":5.36,"pairedTimestamp":5.00,"alternates":0},
  {"kind":"stridePair", "quality":1,"timestamp":4.84,"pairedTimestamp":6.16,"alternates":0}]}
```

`verticalRatio` emits **both** exemplars, and the stride pair at **quality 1.0** — the ceiling.
`MIN_EXEMPLAR_QUALITY` is not involved, `MAX_EXEMPLARS_PER_METRIC` is not involved, and neither of
the ticket's two named suspects is: `ceee2dc`'s period gate would have removed pairs (the metric
would report `no-period-consistent-pairs` and a null value; it reports 0.0310419), and
`strides-cjl`'s re-timing moves the instants without removing them.

The `[evidence-coverage]` line then shows `verticalRatio` as `status: 'planned'` carrying only the
`bounceCycle`. The loss is entirely inside planning.

## D3. The gate is `isTooFarApartPair`, and `4fac355` is what moved it

```json
{"metric":"verticalRatio","kind":"stridePair","reason":"too-far-apart",
 "growth":4.530600578247163, "baseT":4.84, "ghostT":6.16}
```

4.5306 against `EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`. The constant has **not** moved — it has been
2.5 since `f2920fa` first introduced the guard. What moved is how the growth is measured.

`4fac355` ("Measure a ghosted pair's crop growth before the frame cap clamps it") replaced
`computeCropRect(...).side` with `evidenceCropSideDemand(...)` in `evidencePairCropGrowth`. The old
numerator ran through `computeCropRect`, whose `min(frameWidth, frameHeight)` cap binds at **2160**
on Demo 1's 3840×2160 frame. Both readings were measured on the identical pair, in one run, by
computing the pre-`4fac355` expression alongside the current one:

| reading | value | verdict against 2.5 |
|---|---|---|
| `clampedGrowth` (pre-`4fac355`) | **2.3679** | passes — the pair rendered |
| `growth` (current) | **4.5306** | fails — the pair is dropped |
| union crop side the pair DEMANDS | **4132.8 px** | on a 3840 × 2160 frame |

## D4. Why the loss is correct, not a regression

The demanded union crop side is **4132.8 px on a 3840 px-wide frame**. The pair does not merely
want a large crop; it wants one **wider than the video**. Pre-`4fac355` that demand was silently
clamped to 2160 and the guard then compared clamped-to-clamped, so the ratio it computed was not a
statement about this pair at all — past the cap every sufficiently-separated pair reads the same
number, which is the defect `4fac355`'s own commit message describes.

So the image CLAUDE.md nominated as best was drawn through a crop that could not contain both
instants it was captioned for. That is the same failure the `trunkLean`-on-multiperson bullet
already records ("side 1080 on a 1920×1080 clip, showing the runner twice and tiny at opposite
edges"), reached by the same route, and it is exactly what the guard exists to stop.

There is no fallback to reach for: the probe reports `alternates: 0`. `buildStridePairExemplar`
emits exactly one pair — the one whose displacement sits closest to the median, which *is*
`strideLengthPx` — so `planExemplarWithFallback` has nothing to walk to. Contrast `trunkLean` on
the same clip and the same run, which offered 17 ranked candidates and eventually found one under
the threshold.

## D5. The finding worth keeping: this exemplar kind is structurally unreachable here

Adding alternates would not help, and the reason is geometric rather than incidental. A stride pair
is *defined* as two same-side footstrikes one stride apart, so it necessarily spans a full stride of
subject translation. `verticalRatio` is side-view-gated, so the only camera angle on which it
resolves at all is the one where a stride's translation is fully in-plane and therefore maximal. On
Demo 1 the solo crop demand is 4132.8 / 4.5306 ≈ **912 px** and the union demand 4132.8 px — a
ratio near the stride-length-to-body-width ratio of any running human. Every stride pair on this
clip is the same shape, because a stride pair on a side view *is* that shape.

So `stridePair` is not an unlucky pair on one clip; it is an exemplar kind that a square,
subject-scaled crop cannot express for a side-view metric. Recovering the image would need a
different construction — a wide letterboxed crop rather than a square one, or a composed
side-by-side rather than a ghost — which is a product decision, not a threshold. Filed as a
follow-up bead rather than guessed at here.

Two things NOT to do, recorded so they are not re-derived:

- **Do not raise `EVIDENCE_MAX_PAIR_CROP_GROWTH`.** 4.53 is not marginally over 2.5; admitting it
  would also re-admit `trunkLean`'s 6.1–6.8 pairs on the same clip and the multiperson
  whole-frame crop the guard was filed for.
- **Do not demote the pair to its base instant.** `isTooFarApartPair` refuses demotion on purpose,
  and this exemplar is the case that most needs the refusal: its label is "One stride: consecutive
  left-foot strikes, ghosted together", a claim about two instants that a single frame cannot make.
