# Design — metric-frame-evidence

This document is the contract the eight sibling tickets of #59 implement against. Every decision
below was made once, here, so it is not re-litigated per-ticket. Where a research claim carried on
#59/#60 turned out to be wrong, the corrected fact is stated inline and marked **[correction]**.

The same marker now also covers a second and third source of correction, both later than the
original draft, so the history of what changed stays legible rather than silently rewritten:

- **corrections from #61's implementation.** #61 has shipped (`cdaee0d`) and `src/heuristics/exemplars.ts`
  is the de-facto reference for the shared gate. Where #61 deliberately diverged from this document
  because the rule as drafted contradicted another decision in it, the **shipped** rule is what is
  stated below. #62/#63/#65 import from that file; they must not re-implement a superseded rule.
- **corrections from a design review**, where a decision was missing outright rather than wrong —
  a number a ticket would otherwise have had to invent, or an observable with no owner.

## Context

`computeFormHeuristics` runs over a **presence-trimmed** frame array
(`runClipAnalysisPipeline.ts:58-60`); the UI holds the **untrimmed** `robustFrames`
(`runClipAnalysisPipeline.ts:68`, stored at `useVideoAnalysis.ts:348`). Nearly every metric already
computes the instants that drove its result and drops them on the line that builds the
`MetricResult`. This change stops dropping them, ranks them, and renders them as cropped —
sometimes ghosted — stills.

Two structural facts make the whole thing cheap:

- `FootstrikeCandidate` (`footstrikes.ts:9-13`) and `Extremum` (`extrema.ts:1-7`) **already carry
  `timestamp`**, and `RobustPoseFrame.timestamp` (`pose/robustness/types.ts:34`) is in scope inside
  every per-frame metric loop. No new plumbing is needed to name an instant.
- `trimToPresenceWindow` is `frames.slice(start, end + 1)`
  (**[correction]** — the file is `src/heuristics/presenceWindow.ts:53`, **not**
  `src/results/presenceWindow.ts` as #59/#60 state). `slice` copies references, so the trimmed
  array holds the *same* frame objects. Timestamps are therefore globally valid across the trim
  boundary; indices are not. See D4.

---

## D1 — The per-metric exemplar table

An **exemplar** is one renderable piece of evidence. It is either a **single instant** or a
**ghosted pair** of two instants blended into one image. A pair counts as one exemplar, because it
produces one image.

Two different *roles* an instant can play, and the distinction drives both this table and the
quality gate (D3):

- **Representative** — "this is what the reported number looks like". The instant's own value sits
  near the metric's reported median. Closeness to the median is *good*.
- **Extreme** — "this is one end of the range the metric measured". The instant's own value sits far
  from the median *by design*. Closeness to the median is *bad*; being an unbounded outlier is also
  bad. D3 handles both halves.

| `MetricId` | shape | instant A (base) | instant B (ghost) | role |
|---|---|---|---|---|
| `verticalOscillation` | ghost pair | bounce **trough** (body highest on screen) | bounce **peak** (body lowest) — the adjacent half-period | representative (the fit is the value) |
| `verticalOscillationCm` | ghost pair | same, from the **winning integration run's** fit | same | representative |
| `verticalRatio` | 2 exemplars: one pair each | (i) the bounce pair, as above; (ii) the **first** footstrike of the median stride pair | (ii) the **second**, same-side footstrike of that pair | representative both |
| `cadence` | **none** | — | — | see D7 |
| `trunkLean` | ghost pair | frame at the **max forward lean** surviving the outlier bound | frame at the **most upright** lean surviving it | extreme both |
| `overstriding` | ghost pair | **most**-overstriding strike surviving the outlier bound | **least**-overstriding strike surviving it | extreme both |
| `kneeFlexion` | ghost pair | flexion **peak** whose `valueDeg` is nearest the reported median | the **adjacent extension minimum** on the *same leg* | A representative, B context |
| `armSwingSymmetry` | up to 2 pairs, one per side | wrist-**high** frame of that side's median-amplitude half-swing | wrist-**low** frame of the same half-swing | representative |
| `footStrikePattern` | **single**, up to 2 | the strike whose offset ratio is nearest the median (then the next-nearest) | — | representative |
| `stepWidth` | ghost pair (constructed) | one strike of the best adjacent **opposite-side** strike pair | the other strike of that pair | representative |
| `stepWidthCm` | ghost pair (constructed) | same rule, over the centimetre offsets | same | representative |

**[correction] — the `(base)` / `(ghost)` column headers above are naming, not the blend plan.**
Which of a pair is actually drawn at full opacity is decided per run by **D11**'s rule (furthest
from the metric's own median for an extreme pair, closest to it for a representative one), and on
some clips that is instant **B**. Read the columns as "the instant this row is named after".

### Verification notes, per row

- **`kneeFlexion` — the ticket's claim holds.** `findLocalExtrema` emits alternating confirmed
  min/max, and `kneeFlexion.ts:141` throws every minimum away with
  `if (extremum.kind !== 'max') continue`. The extension troughs are free. **[correction]** the
  `FlexionPeak` interface is at `kneeFlexion.ts:130-134`, not `:135-146`; peaks are pushed at
  `:142` and carry only `frameIndex` — `extremum.timestamp` is discarded one token away on that
  same line. Adding `timestamp: extremum.timestamp` to that literal is the whole fix.
  The reported `value` is the **median** peak, so instant A must be *representative* (nearest the
  median), not the largest peak in the clip. Instant B is the adjacent minimum and is **not itself a
  measurement** — it is what makes the flexion angle legible. This asymmetry is deliberate and the
  caption must not imply the trough was measured.
- **`overstriding` — holds.** Per-strike quantity is `overstrideRatios` (`overstriding.ts:86`),
  `value = median(...)` at `:106`. Note the array is index-parallel to the *surviving* candidates
  only (`continue` at `:82` skips unresolvable strikes) — so a rank must be carried alongside the
  candidate, never recovered as `candidates[i]`.
- **`footStrikePattern` — holds.** Per-strike `offsetRatios` (`:136`), `value = median(...)` at
  `:155`, and `classifyFootStrike(ratio, band)` is already exported (`:54-58`), so a per-strike
  heel/midfoot/forefoot caption needs no duplicated threshold logic. Single-instant is correct:
  the metric only exists at the moment of strike. Two singles, not one pair, is how this metric
  spends its two-exemplar budget.
- **`stepWidth` / `stepWidthCm` — the ticket's claim is WRONG.** **[correction]** #60 proposes
  "left-foot strike + right-foot strike" as a pair *already computed*. It is not. Both metrics
  aggregate over **individual strikes measured independently against the hip midline**
  (`stepWidth.ts:114`, `stepWidthCm.ts:149`); there is no left/right pairing anywhere, and
  `detectFootstrikes` returns a single timestamp-ordered list with both legs merged
  (`footstrikes.ts:81-93`) whose consecutive entries are **not guaranteed to alternate sides**.
  The pair must therefore be *constructed*: among adjacent **opposite-side** entries in the ordered
  candidate list, take the pair minimising the mean `|offset − median|`. A ghost of two opposite
  feet at their respective plants is exactly what "step width" means, so this is honest — it is
  just not free. When no adjacent opposite-side pair exists (every strike on one side), demote to a
  **single** representative strike: one strike against the hip midline is one whole measurement, so
  a single frame is still honest here.
- **`trunkLean` — holds, with a caveat.** The loop is `for (const frame of frames)` at
  `trunkLean.ts:64-86` and records no identity; `frame.timestamp` is already in scope at the push
  site (`:85`). The reported `value` is `median(leanValues)` at `:97`. But the *extremes* of a
  per-frame distribution are, on real footage, the frames most likely to be tracking glitches —
  which is why the outlier bound in D3 is a hard reject here rather than a soft penalty.
- **`armSwingSymmetry`** — needs `SideSwing` widened to keep the extrema pair per half-swing
  instead of collapsing to `Math.abs(extrema[i].value − extrema[i−1].value)` at `:90`, plus a
  per-extremum interpolated flag it does not have today (`interpolatedCount` at `:71`/`:78` is
  per-**side** and per-**frame**). Note the median that picks the "median-amplitude half-swing" is
  **not** computed inside `computeSideSwing` — it lives in the caller at `:149-150`
  (`median(left.amplitudesPx) / torsoLengthPx`), so the index of the median amplitude has to travel
  back to the per-swing extrema pair. Up to one exemplar per side is what makes an *asymmetry*
  metric legible as a picture — two images side by side is the comparison.
- **`verticalRatio`'s denominator** — `estimateStrideLength` has exactly **one** production caller
  (`verticalRatio.ts:175`) and `StrideLengthResult` is never constructed as an object literal
  outside `strideLength.ts`, so widening it is safe; the only breakage is the two whole-object
  `toEqual`s at `strideLength.test.ts:144` and `:176`. **[correction]** `strideLength.ts:144-145`
  resolve the two *frames*; `:146-147` resolve the hip midpoints. Identity dies at `:151`
  (`displacements.push(d)` into a bare `number[]`).
- **`verticalRatio`** — spends its two-exemplar budget on numerator and denominator, distinguished
  by `kind`. This is the one metric where the two exemplars answer different questions, and the
  gallery must caption them as such.
- **VO family** — see D8 for the sign trap, and D7 for why `cadence` is not in this list.

---

## D7 — `cadence` ships **no exemplar**

**Decision: `cadence` emits no exemplars at all.** Not the borrowed bounce pair.

A cadence is steps per minute. It is a property of a *sequence*, not of any pair of instants. Two
stills of a bounce peak and trough depict the bounce's **amplitude** — which is precisely what
`verticalOscillation` reports and what `cadence` does not. Rendering the same two frames under both
cards would teach the user that this picture explains this number, and for cadence it would be
explaining the wrong one.

The two alternatives, and why each is rejected:

- **Borrow `verticalOscillation`'s bounce pair** (the fork #60 names). Rejected: the images would be
  byte-identical to the VO card's, so the gallery would show the same picture twice under two
  different numbers. That is worse than a gap — it manufactures a false explanation.
- **Two consecutive same-side footstrikes** (the plausible third option, named so nobody re-derives
  it). Rejected on a factual basis, not an aesthetic one: **cadence no longer reads footstrikes at
  all.** It is derived from `analyzeHipBounce`'s spectral fit, and `cadence.ts:101-103` says so
  explicitly. Footstrike instants did not produce cadence's number, so showing them as evidence for
  it would be a fabrication.

`cadence` therefore falls back to today's text-only card, which is a supported, designed state
(locked decision 1) — not a broken one. The epic's own principle settles it: *better to show nothing
than to invent a misleading picture for a metric with no good moment.*

A time-axis depiction is the only honest picture of a frequency. The app already has one for
`verticalOscillation` (`VerticalOscillationChart`), and drawn annotation is explicitly out of scope
for this epic.

---

## D2 — The per-metric crop-keypoint table

**The crop seed is exactly the set of keypoints the metric itself reads at that instant**, plus a
fixed per-metric *context set* added only where the seed is degenerate (fewer than two distinct
points, or a single segment that leaves the subject unrecognisable). Deriving the table from the
metric's own inputs rather than from taste means a crop can never show a body region the metric did
not measure.

| `MetricId` | seed — the keypoints the metric reads | context added | why the context |
|---|---|---|---|
| `verticalOscillation` | `left_hip`,`right_hip` (or `left_ear`,`right_ear` under `verticalOscillationSignal: 'earMid'`) | `left_shoulder`,`right_shoulder`,`left_knee`,`right_knee` | one midpoint is a zero-area rect; a torso band keeps the body recognisable while leaving the vertical delta a visible fraction of the crop |
| `verticalOscillationCm` | `left_hip`,`right_hip` | same as above | hip-pinned unconditionally — `verticalOscillationSignal` does **not** apply here |
| `verticalRatio` (numerator) | `left_hip`,`right_hip` | same as above | — |
| `verticalRatio` (denominator) | `left_hip`,`right_hip` at both strikes | + `left_ankle`,`right_ankle` | the stride is a **horizontal** displacement; the crop has to span it or the pair reads as no delta at all |
| `cadence` | — | — | no exemplar (D7) |
| `trunkLean` | `left_shoulder`,`right_shoulder`,`left_hip`,`right_hip` | `nose`,`left_ear`,`right_ear` | the head is how a viewer reads "upright" |
| `overstriding` | striking-side ankle, `left_hip`,`right_hip` | striking-side knee | a hip-to-ankle box with no knee reads as an empty diagonal |
| `kneeFlexion` | side `hip`,`knee`,`ankle` | none | three points already span the leg |
| `armSwingSymmetry` | side `shoulder`,`wrist` | side `elbow` | the elbow is the joint the swing bends at |
| `footStrikePattern` | striking-side `ankle`,`knee` | striking-side `heel`,`foot_index` **when resolvable** | a foot-strike picture that omits the foot is useless — but see the backend caveat below |
| `stepWidth` | striking-side `ankle`, `left_hip`,`right_hip` | other-side `ankle` **when resolvable** | a *width* needs both feet to read as a width |
| `stepWidthCm` | same as `stepWidth` | same | — |

**Backend caveat, load-bearing.** `left_heel`/`right_heel`/`left_foot_index`/`right_foot_index` are
in `COMMON_KEYPOINT_NAMES` but are **MediaPipe-only**. On MoveNet — the default primary backend —
`toPoseFrame` fills them as `{x:0,y:0,score:0}`, so they resolve `'unrecoverable'` with null
coordinates. Context keypoints are therefore **strictly optional**: the crop must be well-defined
from the seed alone, and any context point that does not resolve is simply omitted. A crop that
silently anchors at `(0,0)` because it trusted a heel keypoint is the exact failure this note
exists to prevent.

### Crop rect derivation

1. Union the resolvable seed ∪ context points **across both frames of a ghost pair**, in
   video-native pixels (`SkeletonOverlay.tsx:11-15` — keypoints are native-resolution, and both
   demo clips are 4K). A rect that moves between the two frames would make the ghost read as two
   different shots rather than one runner at two instants.
2. Pass that box to **`computeCropRect`** (`movenetCrop.ts:269`) with an evidence-specific padding
   multiplier and minimum side — **the two constants are fixed below, not left to #65**. Do **not**
   write a second crop-rect function: `computeCropRect` already produces a **square**, already
   clamps to `[0, frameWidth] × [0, frameHeight]` by shifting rather than shrinking, and is already
   unit-tested. Reusing it delivers D13's single aspect ratio for free.
3. Do **not** reuse `deriveBoundingBox` (`movenetCrop.ts:54`). It takes raw scored `Keypoint[]` and
   hard-excludes head and foot names via `BBOX_EXCLUDED_KEYPOINT_NAMES` — the opposite of what this
   table needs. A small pure `boundingBoxOfPoints(points)` local to `evidenceFrames.ts` is correct.

### The two crop constants — **[correction]**, these were never specified and #65 cannot land without them

```
EVIDENCE_CROP_PADDING_MULTIPLIER = 1.6
EVIDENCE_CROP_MIN_SIDE_PX        = 320
```

**One constant pair for every metric. Not a per-metric table.** The decision, not a hedge:

- Per-metric framing **already exists**, one layer up — it is D2's seed ∪ context table. A foot
  crop and a full-body crop differ because `footStrikePattern` seeds on ankle/knee(+heel/foot_index)
  and `trunkLean` seeds on shoulders/hips/head, so the *box* differs by an order of magnitude before
  any padding is applied. The multiplier is a **relative** enlargement of whatever box the metric's
  own inputs produced, so it tracks the region automatically. A second per-metric table would
  duplicate the first one's job in the one dimension D13 exists to hold constant — apparent subject
  scale across the gallery — and would be taste with no evidence behind it, exactly the argument
  D11 uses to refuse a per-metric opacity table.

**Why 1.6, and why not the tracking crop's number.** **[correction]** the existing tracking-crop
defaults are `paddingMultiplier: 1.75` / `minCropSidePx: 256`
(`trackingCropConfig.ts`, `DEFAULT_TRACKING_CROP_CONFIG`) — **not** the 1.8 / 150 pair quoted in
some notes, which come from the dynamic-valgus spike's experimental `deriveLegCropRect` on another
branch and were never this repo's shipped defaults. Either way they are the wrong number to copy,
because they buy something this crop does not need:

- The tracking crop's padding is **slack for motion**. Its box is one frame old and the subject
  moves before the next inference, so the multiplier has to cover that lag. The evidence crop's box
  is the union across **both frames it will actually draw** (step 1), so the motion is already
  inside the box; padding here buys *context* only.
- `computeCropRect` squares by taking `max(boxWidth, boxHeight)`, so on the tall-thin box a human
  produces the multiplier only controls the **long axis** margin — the short axis is already
  massively widened by squaring alone (a 1:3 box becomes a square ≈4.8× its own width at 1.6). At
  1.6 the long axis carries `(1.6 − 1)/2 = 30 %` of the box's own long dimension as margin at each
  end: enough to place the body region in its body, not so much that the subject reads small at
  gallery display size. 1.75 would push that to 37.5 % for no gain the ghost benefits from.

**Why a 320 px floor.** The floor is a guard against a **degenerate box**, not a target:
`side = max(boxW, boxH) × 1.6` is `0` for a seed that resolves to a single point — one hip with no
resolvable context, or `kneeFlexion` at an instant where hip/knee/ankle nearly align. Without the
floor that crop is empty. 320 native px is ~8 % of Demo 1's 3840 long edge and ~15 % of its 2160
short edge, and it is chosen against the **viewer**, not the detector: a gallery image is on the
order of 200–400 CSS px, so 320 native px survives a 2× DPR display without upscaling to mush,
where the tracking crop's 256 only ever had to satisfy a 192 px model input. Note the floor is
bounded above by the frame — `computeCropRect` applies `Math.min(..., min(frameWidth, frameHeight))`
**last**, so on a small source (a 320×240 webcam clip) the cap wins at 240 and the floor can never
demand pixels the source does not have.

Both constants live in `evidenceFrames.ts` next to the code that passes them, exported so #65's
tests and #68's report can name them.

### Where the table lives in code

`MetricExemplar` carries a `cropKeypoints: KeypointName[]` field, populated by the metric that
emitted it. The table above is the specification; the metric module is the single place it is
encoded. The alternative — a `switch (metricId)` in the pure plan layer or the gallery — puts the
knowledge of what a metric measured in a module that does not measure anything, where it will drift
the first time a metric changes its inputs. This also keeps `evidenceFrames.ts` metric-agnostic and
therefore trivially testable.

---

## D3 — The confidence gate

### What the score is built from — and what it is not

**Not keypoint score.** `ResolvedPoint` (`keypoints.ts:4-8`) carries only `{x, y, interpolated}` and
drops `RobustKeypoint.score`, and the robustness layer's own contract
(`pose/robustness/types.ts:23-26`, **[correction]** — the comment is at `:23-26`, not `:22-27`)
says it in as many words:

> Real score if detected; lerp of real neighbor scores if interpolated (informational only — reads
> as confident, consumers must gate on status, not score); 0 if unrecoverable.

**`ResolvedPoint` is deliberately NOT widened.** Four reasons, so this is not re-opened:
(a) `resolveMidpoint` synthesises a point from one or two real keypoints — there is no single score
to carry, and any aggregation rule would be invented; (b) the layer above explicitly directs
consumers to `status`, and a score field on `ResolvedPoint` is an invitation to ignore that;
(c) every signal this gate needs (`interpolated`) is already on the type; (d) crop derivation reads
`frame.keypoints` directly, where the real `status` lives, so nothing downstream needs a widened
`ResolvedPoint` either.

### The score

Per candidate instant, `quality ∈ [0, 1]` is the product of exactly two factors:

- **`detectionFactor`** (**[correction]** — drafted here as `resolutionFactor`, "the fraction of
  that instant's own metric-input **points** that resolved `'detected'`"; shipped in #61 as
  `detectionFactor(frame, seed)` at `exemplars.ts:142`, **counting per KEYPOINT, not per resolved
  input**). The shipped rule is the fraction of the instant's own crop-**seed keypoint names**
  (D2) that `resolvePoint` returns non-null and non-`interpolated` for, read straight off
  `frame.keypoints`.

  The distinction is load-bearing and the draft version is a live bug, so it is recorded here
  rather than left as an implementation detail. `resolveMidpoint` (`keypoints.ts:60-61`) returns
  `interpolated: true` whenever it stood **one side in for a pair — even when that side was itself
  `'detected'`**, by explicit design (its own doc comment says so). `trunkLean` resolves *two*
  midpoints (`trunkLean.ts:156`, `:161`); on a frame where both pairs are one-sided, a
  per-resolved-input reading is `0/2 = 0`, and the instant scores a flat zero however good the
  underlying keypoints were. CLAUDE.md measures that condition — the "single-ear interpolation
  tax" — at **17–22 % of frames on the track clip**, so the draft rule would gate the whole metric
  out on real footage. Counting keypoints makes one missing side cost one point out of N
  (`0.75` on a four-point torso seed, which is what #61's test pins), which is what
  "interpolation **penalises**, it does not disqualify" was always supposed to mean.

  Do not re-introduce the zero by "fixing" `detectionFactor` to read `ResolvedPoint.interpolated`
  from the metric's own resolved inputs. The flags at `overstriding.ts:87`,
  `footStrikePattern.ts:137`, `stepWidth.ts:115-117`, `stepWidthCm.ts:152-153`, `trunkLean.ts:84`
  and `kneeFlexion.ts:158` remain correct for the *metric's own* `interpolatedFraction`; they are
  the wrong input for this gate.
- **`typicalityFactor`** — role-dependent, per D1:
  - *representative* instants: `1 − min(1, |v − median| / (3 · MAD))`
  - *extreme* instants: `min(1, |v − median| / (3 · MAD))`

  where `median`/`MAD` are over the metric's **own** per-instance values (`overstrideRatios`,
  `offsetRatios`, `leanValues`, peak `valueDeg`, half-swing amplitudes). When `MAD === 0` or fewer
  than five instances exist there is no distribution to judge against: the factor is `1` for a
  representative instant and `0.5` for an extreme one — do not pretend to a confidence the data
  cannot support.

This is why the gate cannot be "distance from median is bad" alone, which is what a naive reading of
#59's mitigation column implies. For `trunkLean` and `overstriding` a large distance from the median
**is the exemplar**; penalising it would gate out exactly the instants the ghost exists to show.

### Hard rejects (a score is never computed)

1. **[correction] — the shipped rule is `cropDerivable`: reject only when NO seed keypoint
   resolves.** This was drafted as "any of the instant's **seed** keypoints (D2) is
   `'unrecoverable'` at that frame", which contradicts D2 one section above: D2's crop rect is the
   union of the **resolvable** seed ∪ context points, so a partially-resolvable seed still names a
   position and still produces a well-defined crop. Worse, most seeds in D2's table are bilateral
   pairs that `resolveMidpoint` resolves from a single side — so the drafted rule would discard
   instants the metric *successfully measured* and whose crop is perfectly derivable. Shipped as
   `cropDerivable(frame, seed)` (`exemplars.ts:126`): `seed.some((name) => resolvePoint(frame, name) !== null)`.

   **The asymmetry that hid the bug**, worth naming so nobody "confirms" the old rule from these
   two metrics: `stepWidth`/`stepWidthCm` resolve hip-mid through the **strict**
   `resolveBilateralPair` (`stepWidth.ts:195`, `stepWidthCm.ts:227`), so a frame with an
   unresolvable hip never becomes a candidate in the first place. For those two the old and new
   rules coincide exactly, and no test over them can tell the two apart.
2. **Outlier bound**, extreme instants only: `|v − median| > 3 · MAD`. A raw argmax that is a
   tracking glitch is rejected outright, not merely down-ranked. This is the guard that keeps
   `trunkLean`'s and `overstriding`'s ghosts from being two detector failures.
3. The metric's own per-instance degenerate case fired — concretely `stepWidth.ts:113`'s
   `Math.sign(sideHip.x − hipMid.x) || 1` fallback, where the `|| 1` silently invents a polarity.
4. **Snap failure**: the instant does not resolve to a sampled frame within the snap tolerance (D8).

### How a PAIR's quality aggregates — `min`, not mean

**[correction] — this document scored *instants* and never said how a ghosted pair combines them.**
#61 shipped `pairQuality(a, b) = Math.min(a, b)` (`exemplars.ts:190`); that is the rule, and
#62/#63 must use the same helper rather than inventing a mean.

Two reasons, and the second one is the interesting one:

- A ghosted pair produces **one image**, and one unreadable half makes one unreadable image. An
  average lets a strong instant carry a weak one over the threshold and ship exactly that.
- On an **extreme** pair, `min` is also a **narrow-range filter**, and a wanted one. Both instants
  of a `trunkLean`/`overstriding` pair are scored `'extreme'`, so both typicalities read
  `|v − median| / (3·MAD)`. When the clip's range is narrow, *both* ends sit close to the median,
  both typicalities are small, and the `min` gates the pair out — which is the correct outcome: a
  runner whose lean never varies has no range to picture. This is the same instinct as D12's
  near-identical demotion, one layer earlier and in value-space rather than pixel-space.

### Threshold, and what happens at zero survivors

`MIN_EXEMPLAR_QUALITY = 0.5`, and at most `MAX_EXEMPLARS_PER_METRIC = 2` survivors are kept, ranked
by `quality` descending. The comparison is `>=` (`exemplars.ts:258`), so a quality of exactly `0.5`
is kept — which matters, because the no-usable-distribution fallback for an extreme instant lands
on precisely that value.

**0.5 is a judgment call, not a derived number** — stated plainly, in the same spirit as
`presenceMinConsecutiveFrames`'s own doc ("a judgment-call threshold, not derived from real
footage"). It is **pre-registered for measurement in #68**: report per-clip, per-metric coverage.
A metric gated out on *every* clip is a finding to report, not a number to quietly tune down.

#### A measured structural risk to the EXTREME role, pre-registered rather than tuned around

**[correction] — surfaced by #61's implementation; recorded, deliberately not fixed.**
`MIN_EXEMPLAR_QUALITY` was **not** touched in response to it, and must not be touched in #62/#63/#65
either. The interaction is arithmetic, so it can be stated exactly:

An extreme instant's typicality is `|v − median| / (3·MAD)`, so clearing `0.5` at a perfect
`detectionFactor` needs `|v − median| ≥ 1.5 · MAD`. Whether any instant in a clip can reach that is
a property of the metric's own distribution *shape*, not of the runner:

| per-instance distribution | max deviation, in MADs | extreme instant can reach 0.5? |
|---|---|---|
| tightly bimodal (two clusters, e.g. left-foot vs right-foot strikes) | **1.0** | **never** |
| clean sinusoid, uniformly sampled in phase | **≈1.41** | **never** |
| uniform | 2.0 | yes |
| Gaussian, n ≈ 20–60 | ≈3.7–4.4 | comfortably |

`generateSyntheticGait` produces the bimodal case, and a *symmetric real gait* plausibly produces it
too — which puts `overstriding` and `trunkLean`, the epic's only two extreme-role metrics, at
structural risk of emitting **nothing on every clip**. The `usable === false` fallback does not
rescue them: it scores an extreme instant `0.5` flat, which clears only when `detectionFactor` is
exactly `1.0`.

**#68 measures this before anyone touches a number** (§8.6). A metric gated out on every clip is a
**finding** — it means the extreme role's ramp and the outlier bound are both keyed to the same
`3·MAD` and cannot both be right for a bimodal metric, which is a design question, not a threshold
question. Loosening `MIN_EXEMPLAR_QUALITY` to make the symptom go away would be editing a criterion
to match a result.

**Zero survivors:**

- At the metric layer, `MetricResult.exemplars` is **absent** (the optional field is simply not
  set). "This metric never emits exemplars" (`cadence`) and "this run's candidates were all gated
  out" both read as absent, which keeps eleven metric modules free of an empty-array-versus-
  `undefined` subtlety.
- At the plan layer (`evidenceFrames.ts`), that distinction *is* needed, and lives where the UI
  consumes it. The plan returns a discriminated result per metric:
  `{ status: 'planned', items: [...] }` or
  `{ status: 'no-evidence', reason: 'not-emitted' | 'all-gated-out' | 'metric-excluded' | 'frames-unavailable' | 'extraction-failed' }`.
  This is #65's "explicit no-evidence result the UI can branch on", satisfied without leaking a
  UI concern into `MetricResult`.
- At the UI layer, a `no-evidence` metric renders **exactly as it does today**: no gallery section,
  no deep link, no placeholder, no layout shift.

### D12 — Near-identical pairs demote

A ghost of two indistinguishable frames is a blurry mess, not a delta. In the **pure** plan, a pair
demotes to its base frame alone when either holds:

- the two per-frame crop boxes have IoU ≥ **0.98** (reuse `computeBoundingBoxIoU`,
  `movenetCrop.ts:111`), or
- both instants snap to the **same** sampled frame.

A metric with no honest single-instant semantics (D1: everything except `footStrikePattern`,
`stepWidth`, `stepWidthCm`) drops the exemplar instead of demoting it. Pre-registered for eyeball
verification on real clips in #68.

### D10 — Evidence is gated to metrics that render a card

Evidence renders only for metrics in tier 1 or tier 2 of the existing metrics panel — i.e. metrics
with `value !== null` and `viewFit !== 'unsuitable'`. Two reasons, both structural:

- `MetricCard` is documented as **never called for a tier-3 metric** (`MetricsPanel.tsx`, the
  `metricTier(metric) !== 'excluded'` guard at `:231`), so there is no card to hang a deep link on.
- Evidence for a metric the app declined to report is a picture explaining a number that is not on
  screen. `viewFit: 'unsuitable'` means the camera geometry cannot support the measurement — a crop
  from that clip would be a picture of a measurement that was not made.

The plan layer's `reason: 'metric-excluded'` names this case distinctly from `'all-gated-out'`.

---

## D4 — The timestamp invariant (write it down; a future contributor will need it)

> **Rule. An exemplar carries `timestamp`, in seconds on the clip's own media clock. It never
> carries a frame index. Do not add a frame-index field to `MetricExemplar`, not even an optional
> one, not even "for debugging".**

The reason is a boundary that is invisible at the call site:

- Heuristics run over the **presence-trimmed** array: `runClipAnalysisPipeline.ts:58-60` computes
  `metricFrames = trimToPresenceWindow(robustFrames)` and hands *that* to
  `computeFormHeuristics`.
- The UI holds the **untrimmed** array: the same function returns `robustFrames` at `:68`
  (its own doc: "Untrimmed — every sampled frame, for the skeleton overlay and diagnostics"), and
  `useVideoAnalysis.ts:348` stores that untrimmed array into React state. It is what
  `SkeletonOverlay` and the evidence extractor both see.
- A `frameIndex` produced by a heuristic indexes the **trimmed** array. Used against
  `robustFrames` it is off by exactly the number of leading frames the presence trim removed —
  which is `0` on a clip where the subject is present from frame one, and non-zero on precisely the
  clips this feature is most useful for. **A bug that is silent on the happy path and wrong on the
  interesting one is the worst shape of bug this epic can ship.**
- Timestamps have no such problem, because `trimToPresenceWindow` returns
  `frames.slice(windowStart, windowEnd + 1)` (`heuristics/presenceWindow.ts:53`) — `slice` copies
  *references*, so the trimmed array holds the **same `RobustPoseFrame` objects**. Every timestamp
  a heuristic can see is a timestamp that exists, unchanged, in the untrimmed array.

**Resolution rule.** Timestamp → frame uses `findNearestFrame(frames, t)`
(`results/skeletonGeometry.ts:85-108`), reused, never reimplemented. It is a binary search that
**clamps** — it returns `frames[0]` for a `t` before the start and the last frame for a `t` after
the end, and returns `null` only for an empty array. It has **no distance tolerance of its own.**
Callers must therefore apply one: reject the resolution when
`|found.timestamp − t| > snapToleranceSeconds`, where the tolerance is **half the median sampling
interval** of the frame array being resolved against. Without that check, a timestamp from a
different clip resolves silently to the first or last frame of this one.

**Test it directly, once, as a first-class case (#61):** an exemplar timestamp resolved against the
**untrimmed** `robustFrames` finds the same frame object the heuristic saw in the **trimmed** array,
on a fixture whose presence window is strictly narrower than the clip. This is the epic's most
likely silent-corruption bug; it does not get an incidental test.

---

## D5 — Cross-clip provenance: **tag, do not drop**

### The problem, restated precisely

`fuseFormHeuristicsResults` (`fuseHeuristics.ts:42-81`) selects the whole winning `MetricResult`
per metric and **spreads it** (`:57-62`). An `exemplars` field therefore travels across clips for
free — and lands in a fused result whose consumer holds a *different* clip's `robustFrames` and a
different clip's `sourceBlob`. The winning clip index is computed at `:56` and immediately dissolved
into a prose sentence by `fusionProvenanceCaveat` (`:9-11`). A gallery would have to regex an
English sentence to recover it.

`scalePassGraft.ts:98-106` spreads metric objects the same way, within a single clip.

### Decision

**Tag by resolution, not by mutation.** Three parts:

1. **`MetricExemplar` carries no clip identity.** It is produced by `computeFormHeuristics`, which
   knows nothing about clips and must not learn. A `clipId` there would be wrong-by-construction on
   every single-clip run and a layering violation on every multi-clip one.
2. **A sibling pure function `fusionSourceIndices(results): Record<MetricId, number>`** exposes what
   `:56` already computes, reusing the *same comparator* so the two cannot disagree.
   `fuseFormHeuristicsResults` itself is **not** changed — its single-clip reference-identity
   guarantee (`:48-50`) is load-bearing for the "this change moves no number" proof, and altering
   its return shape forces touching it. A test asserts the two agree on every metric for a
   multi-clip fixture; two comparators that silently diverge is the failure mode.
3. **The gallery resolves each metric's exemplars against `clips[fusionSourceIndices[metricId]]`** —
   that clip's `robustFrames` for crop rects, that clip's `sourceBlob` for extraction. Provenance is
   then correct **by construction**, not by a field that could be stale.

**Why not "drop on fuse"** — the other option #60 names. Dropping means a two-clip session shows
zero evidence for every metric whose winner is not clip 0. The feature would degrade exactly when
the user did the extra work of adding a second clip, and it would degrade *silently*. Dropping is
also not sufficient on its own: `scalePassGraft` grafts within one clip, where the exemplars are
already valid, so a blanket drop is a pure loss there.

### The scale-pass graft needs its own rule — and one of them is a correctness catch

The grafted `verticalOscillationCm` / `stepWidthCm` come from the **scale pass over the same clip**,
so their timestamps are on the same media clock and remain valid. But the scale pass samples
independently: its `RobustPoseFrame[]` are **not** the frames the UI holds. So:

- **Crop rects for grafted exemplars are derived against the PRIMARY pass's `robustFrames`**, by
  resolving the grafted timestamp with `findNearestFrame` + the snap tolerance (D4). Same body, same
  instant, a different detector's estimate of where its joints were. If no primary frame lands
  inside the tolerance, drop the exemplar — do not widen the tolerance to rescue it.
- **When `subjectAgreement.status === 'diverged'`, drop the grafted metrics' exemplars entirely.**
  Divergence means the two passes selected *different people*
  (`scalePassSubjectAgreement.ts`, #56). Deriving a crop from the primary pass's subject for a
  number the scale pass computed about somebody else would render a picture of the wrong person
  under a confidently-displayed metric. The existing divergence *caveat* is the right treatment for
  a number; it is not sufficient for an image, because an image asserts identity in a way a sentence
  does not. **Neither #59 nor #64 mentions this; it is a new constraint introduced here.**

---

## D6 — The two known risks, recorded as inherited acceptance criteria

### R1 — PTS-versus-`currentTime` drift (owner: #66 to mitigate, #68 to measure)

`sequentialSampling.enabled` defaults **`true`** (`samplingRobustnessConfig.ts:40`), so most MP4s
sample through WebCodecs, where the timestamp that eventually becomes `robustFrames[].timestamp` is
raw `sample.cts / sample.timescale` (**[correction]** — the demuxer's field is named **`ptsSec`**,
not `timestamp`, at `mp4Demux.ts:174`; `grep -n 'elst|edit|composition'` over that file returns
**zero** matches, so the "no edit-list adjustment" half of the claim is confirmed outright).
`HTMLVideoElement.currentTime` **is**
edit-list-adjusted and zero-based. CLAUDE.md records `park-approach.mp4` carrying
`elst media_time: 2002` at a 60000 Hz media timescale — roughly 33 ms, i.e. about two frames at
59.94 fps. Seeking a detached `<video>` to a `robustFrames` timestamp can therefore land on the
wrong frame, and the failure is *plausible-looking*: a near-neighbour frame of a running subject.

WebM/webcam clips take the `<video>`-playback path and use `metadata.mediaTime`, already in
`currentTime`'s domain, so they are unaffected — which is itself the diagnostic.

Inherited criteria:

- **#68 must report a measured per-clip offset**, ground-truthed against
  `ffmpeg -i clip -ss <t> -frames:v 1` (output seeking, `-ss` after `-i`). *A "looks fine" without a
  number does not close this.*
- **#68 must isolate the cause** by re-running with
  `{ sequentialSampling: { enabled: false } }` via `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__`
  (set with `page.addInitScript`, never `page.evaluate`) and reporting whether the offset changes.
- If the offset is non-zero, **#66 adds a one-time per-clip calibration offset** applied at seek
  time only — never written back into `robustFrames[].timestamp`, which is the sampling layer's
  own truth and is correct in its own domain.

### R2 — Webcam `duration === Infinity` (owner: #65, enforced by type discipline)

MediaRecorder WebM blobs commonly report an infinite duration, and `useVideoSource.ts:53` copies
`video.duration` into `metadata.durationSec` **unguarded**.

> **Rule. Extraction timestamps derive from `robustFrames[].timestamp` and nothing else. No
> fraction-of-duration arithmetic, anywhere, ever.** `metadata.durationSec` must not appear in
> `evidenceFrames.ts` at all — `metadata.width`/`metadata.height` are the only fields of that object
> this feature reads, and they come from `video.videoWidth`/`videoHeight`, which are sound.

A unit test on a metadata fixture carrying `durationSec: Infinity` must produce a well-formed plan.

### R3 — 4K memory (owner: #66)

Demo 1 is 3840×2160 and Demo 2 is 2160×3840. Never allocate a full-frame canvas per exemplar: use
the nine-argument `drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh)` to draw **only the crop rect**
into a canvas sized to the display crop. And hold **at most one detached decoder open at a time** —
extract every instant for one clip in a single pass, tear down, then move to the next clip.

---

## D8 — Deriving bounce instants from the fit, and the sign trap

### What the fit actually is

`fitSpectralSinusoid` fits, over time centred at the sample mean `tMean`
(`spectralFit.ts:307-329`) and values centred at their mean:

```
v − v̄  ≈  a·sin(ωτ) + b·cos(ωτ)  +  c + d·τ + e·τ²        where τ = t − tMean,  ω = 2π·f
```

`spectralFit.ts:386-387` takes `const [a, b] = bestFit.coefficients` and immediately collapses them
to `2·hypot(a, b)`. Neither `atan2(b, a)` nor `tMean` survives into `SpectralFitSuccess`
(`:94-115`), so today there is no way to name the bounce peak or trough frame.

`SpectralFitSuccess` gains **`phaseRadians = atan2(b, a)`** and **`tMeanSeconds = tMean`**. The
sinusoid component is then `A·sin(ωτ + φ)` with `A = hypot(a, b)`, and:

```
sinusoid maximum:  t = tMean + ( π/2 − φ)/ω  +  k/f
sinusoid minimum:  t = tMean + (−π/2 − φ)/ω  +  k/f          k ∈ ℤ
```

Derive the instants **from the phase**, never by scanning the raw signal for argmin/argmax. The fit
deliberately removes the `c + d·τ + e·τ²` trend, and the raw extremes are exactly the jittery
quantity the spectral estimator was adopted (#28) to replace. A scanned extreme would contradict the
amplitude the same metric reports.

### Instant selection and snapping

Choose the (maximum, adjacent minimum) pair whose midpoint is closest to the centre of the fit's own
`spanSeconds` — the most-supported cycle. Then **snap each instant to the nearest sampled frame**
via `findNearestFrame` + the D4 snap tolerance: the fit is continuous, the clip is not. If either
half fails to snap, the pair is rejected (hard reject 4 in D3).

### The sign trap — **read this before writing a caption**

**The pixel path and the centimetre path fit series with OPPOSITE sign conventions.**

- `hipBounce.ts:95` pushes `{ t: frame.timestamp, v: y }` where `y` is **raw image-y**, which is
  **downward-positive**. So on the `verticalOscillation` / `verticalRatio`-numerator / `cadence`
  fit, the sinusoid's **maximum is the runner's LOWEST on-screen position**.
- `verticalOscillationCm.ts:154` integrates `cumulative += (hipY[k−1] − hipY[k]) / stepScale`,
  which is **upward-positive**. So on that fit, the sinusoid's **maximum is the runner's HIGHEST
  position**.
- The `TimeseriesPoint` series exposed on `VerticalOscillationResult` is **neither** of those: it is
  `(runMeanSignalY − y) / torsoLengthPx` (`verticalOscillation.ts:207`) — sign-flipped *and*
  torso-normalized for charting — and is **not** the series that was fitted. Do not reach for it to
  disambiguate a fit's direction.

> **Rule. Exemplar labels are semantic — "highest point of the bounce" / "lowest point" — and the
> code must resolve maximum-versus-minimum against the sign convention of the series that was
> actually fitted, per fit, at the call site. Never assume "sinusoid max = top of the bounce".**

A mislabelled ghost here is invisible to every type check and every unit test that does not
explicitly assert direction, and it is a caption that tells the user the opposite of the truth.

### The `verticalOscillationCm` back-reference

`selectWeightedMedianFit` (`verticalOscillationCm.ts:178-197`) returns a bare `SpectralFitSuccess`
with **no back-reference to the `IntegrationRun` that produced it**. The run is where the timestamps
live: `IntegrationRun` is `{ hipY, timestamps, scales }` (`:41-47`). Carry the pairing through —
fit the runs into `{ fit, run }` tuples and select over those — so the winner's instants are
attributable to real frames. This is the awkward part of #62; budget for it.

#### How this metric gets a `detectionFactor` — **[correction]**, decided here, was undefined

**Widen `IntegrationRun` with a parallel `frames: RobustPoseFrame[]`** — one entry per run sample,
index-parallel to `hipY`/`timestamps`/`scales`, pushed at `buildRuns`'s existing loop
(`verticalOscillationCm.ts:58-76`) where `frame` is already the loop variable. One line, no new
lookups, no second traversal.

This matters because **`verticalOscillationCm` has no per-instance interpolated signal of its own,
and the fix drafted for the rest of the family does not reach it.** Verified against source:

- The metric builds its **own** series via `buildRuns` → `resolveMidpoint(frame, 'left_hip',
  'right_hip')` (`:63`) and pushes only `hipMid.y`; the flag is dropped on that line.
- Its module doc is explicit that `analyzeHipBounce`'s series is **never read** here — that second
  call exists for coverage/interpolation bookkeeping only and "its own spectral `fit` field is
  DELIBERATELY UNUSED". So there is no shared series to fix once.
- **[correction] to tasks §2.8**, which named the fix as "stop discarding `mid.interpolated` at
  `hipBounce.ts:83`". That file is the right one for `verticalOscillation`/`verticalRatio`/`cadence`
  and the wrong one for `verticalOscillationCm`, which does not go through it.

**Why `frames`, and not the obvious `interpolated: boolean[]`.** The obvious candidate does not fit
the gate that actually shipped. `exemplars.ts` is **frame-based**: `cropDerivable(frame, seed)`
(hard reject 1) and `detectionFactor(frame, seed)` both take a `RobustPoseFrame` and read
`frame.keypoints` directly, and `ExemplarInstant` is `{ frame, seed, value? }`. A bare
`interpolated: boolean[]` satisfies **neither** — it cannot derive a crop and cannot be scored —
so it would force this one metric onto a bespoke second scoring path, which is the thing D3's
"one implementation, imported by every metric" exists to prevent. Worse, it would encode the exact
bug C2 above corrects: the boolean it would carry is `resolveMidpoint`'s, which reads `true` for a
one-sided pair *even when that side was detected*.

**The pixel path needs no widening at all.** `analyzeBounceSignal`'s `hipY` is built with
`frames.map(...)` (`hipBounce.ts:79-87`) and is therefore **strictly index-parallel to `frames`**,
nulls included — and its callers already hold `frames`. An instant derived from the fit's phase is
snapped with `findNearestFrame` (D4), which returns the frame object itself. So
`verticalOscillation`/`verticalRatio` reach `detectionFactor` with no change to `hipBounce.ts`
whatsoever.

**Snap target**: snap against the frame array the fitted samples came from — the winning run's
`frames` for the centimetre path, the metric's own `frames` for the pixel path. A pixel-path snap
that lands on a frame with no resolvable hip is then caught by hard reject 1 rather than silently
cropping around nothing.

Without this decision `verticalOscillationCm` would carry an **undefined** `detectionFactor`, and
at `MIN_EXEMPLAR_QUALITY = 0.5` that is not a cosmetic gap — it silently decides whether the metric
emits evidence at all.

---

## D9 — Exemplars stay out of `[analysis-diagnostics]`

Epic constraint 4 says nothing image-shaped may be reachable from `diagnostics`, which
`useVideoAnalysis` `JSON.stringify`s to the console and the live-verification harness (and
`scripts/ab-person-selection.mjs`) parses.

**This is satisfied by construction and needs no code change.** `analysisDiagnostics.ts:132-139`
builds each `MetricDiagnostics` **field by field** — `value`, `confidence`, `viewFit`,
`frameCoverage`, `interpolatedFraction`, `sampleSize`, `caveat` — not by spreading the
`MetricResult`. Adding `exemplars` to `MetricResult` therefore cannot appear on that line.

**Decision: keep it that way. Do not add exemplars, exemplar counts, or exemplar timestamps to
`AnalysisDiagnostics`.** Consequences, both intended:

- the `[analysis-diagnostics]` JSON stays byte-identical for a run whose metrics are unchanged, so
  the harness contract needs no version bump;
- there is **no `analysis-diagnostics` spec delta** in this change, which is why #60 lists exactly
  three affected capabilities.

#68 needs per-clip evidence coverage. It gets it from a **separate dev-only console line owned by
the evidence pipeline** (a distinct prefix — and it must be matched exclusively, exactly as the
scale-pass line already forces on `[analysis-diagnostics]`), or from the rendered gallery. Never by
widening the existing line.

### The `[evidence-coverage]` line — **[correction]**, prefix, schema and owner were all unnamed

Drafted as "a separate dev-only console line owned by the evidence pipeline" and then **required**
by tasks §8.6, with no prefix, no schema and no module — so no ticket built it. Assigned here.

**Prefix: `[evidence-coverage]`.** Matched exclusively —
`text.startsWith('[evidence-coverage]')` — and no sub-prefixed sibling (`[evidence-coverage:…]`)
may be added later without the harness learning the `!startsWith('[evidence-coverage:')` guard
first. That is the whole lesson of `[analysis-diagnostics:scale-pass]` colliding with
`[analysis-diagnostics]`, and it is cheaper to write the rule down now than to re-learn it.

**Owner, split across two tickets so both halves are testable:**

- **#65** exports the pure summarizer `summarizeEvidenceCoverage(...)` from `evidenceFrames.ts` —
  plan in, payload out, no `console`, no DOM, unit-testable like the rest of that module.
- **#67** emits it, once per analysis run, from `EvidenceGallery.tsx`, `import.meta.env.DEV`-gated
  exactly as `useVideoAnalysis`'s two lines are, **after extraction has settled for every clip** so
  `'extraction-failed'` is a verdict rather than a pending state. **One line per run**, not one per
  clip — clips are an array inside the payload.

**Payload** — `JSON.stringify` of:

```ts
{
  clips: Array<{
    clipIndex: number
    frameCount: number            // that clip's robustFrames.length
    metrics: Partial<Record<MetricId, {
      status: 'planned' | 'no-evidence'
      reason: 'not-emitted' | 'all-gated-out' | 'metric-excluded' | 'frames-unavailable'
            | 'extraction-failed' | null      // null iff status === 'planned'
      exemplars: Array<{
        kind: MetricExemplarKind
        side?: 'left' | 'right'
        quality: number
        timestamp: number
        pairedTimestamp: number | null        // null on a single, or after a D12 demotion
        demotedFromPair: boolean              // D12 fired
        cropSidePx: number
      }>
    }>>
  }>
  sourceIndices: Partial<Record<MetricId, number>>   // fusionSourceIndices (D5), so N-clip
                                                     // provenance is checkable without the UI
}
```

Three constraints, all load-bearing:

- **Nothing image-shaped, ever** — no `ImageBitmap`, no canvas, no `Blob`, no object URL, no data
  URI. Numbers and enums only. This is epic constraint 4 applied to the new line rather than
  assumed to be about the old one. A crop *rect side* is a number and is fine; a crop is not.
- The line must `JSON.parse` cleanly on its own, with a fixed key order, so #68 can diff two runs.
- **It reports the plan, never a value.** No metric `value`/`confidence` may appear here —
  `[analysis-diagnostics]` already carries those, and duplicating them creates two sources of truth
  that can disagree.

`timestamp`/`pairedTimestamp` are on this line deliberately: they are the exact input §8.3's
`ffmpeg -i clip -ss <t> -frames:v 1` ground-truthing and §8.4's PTS-offset measurement need, and
without them #68 would have to read them off the DOM.

---

## D11 — Blend plan: which frame is base, and at what opacity

- **`timestamp` is the base**; **`pairedTimestamp` is the ghost.** The base is the instant that most
  directly corresponds to the reported value — for two symmetric extremes (`trunkLean`,
  `overstriding`) it is the more extreme one, because that is what the range is *about*. Fixing this
  in the type means the plan layer never has to re-derive which frame is which.

  **[correction] — "more extreme" means furthest from the metric's own median, and THIS RULE WINS
  over D1's `(base)` column header.** They agree in the common case and they diverge, so the
  precedence has to be written down. D1's table labels its instant-A column `(base)` and fills it
  with "max forward lean" and "most-overstriding strike" — read literally that is a *fixed* base per
  metric. It is not: on a clip that spends most of itself leaning forward the **median** lean is
  forward, so the **upright** frame is the one further from the median and becomes the base, while
  D1's header still says the forward one is. #61 shipped D11's rule —
  `forwardDistance >= uprightDistance ? mostForward : mostUpright` (`trunkLean.ts:88`), and the same
  comparison at `overstriding.ts:88` — so D1's `(base)` column is to be read as "the instant this
  row is named after", never as the blend's base. #63's `armSwingSymmetry` pair inherits the same
  rule.

  Note the **representative** metrics take the mirrored form of the same rule — base is the instant
  *closest* to the median (`stepWidth.ts:83-86`) — which is the identical statement "base is the
  instant the reported value is most directly about", read through that role's own definition of
  good.
- **Base at `globalAlpha = 1.0`, ghost drawn over it at `globalAlpha = 0.5`.** The composite is then
  `0.5·ghost + 0.5·base` — a symmetric 50/50 double exposure. On a static camera the background is
  identical in both frames and so reproduces exactly, while the two body positions each render at
  half weight: the classic read. Unequal opacities make the ghost look like a mistake rather than a
  second instant. **One fixed pair of constants for every metric** — a per-metric opacity table
  would be taste with no evidence behind it.
- The extractor must **await one `requestVideoFrameCallback` after `seeked` fires** before
  `drawImage`. `seeked` reports that the seek completed, not that the new frame is composited;
  drawing immediately can capture the previous frame — which on a running subject is a plausible,
  silently-wrong image.

---

## D13 — One aspect ratio across the gallery

Every crop is a **square** in native pixels, straight out of `computeCropRect`. The gallery then
scales squares to a single display size. This is what makes the gallery "read as a coherent set
rather than a ragged pile of different-shaped crops" (#59) — and it costs nothing, because the
reused function already produces squares and already clamps by shifting rather than shrinking, so
the returned side is always exactly what the padding math produced.

Note `computeCropRect` caps `side` at `min(frameWidth, frameHeight)`. On Demo 2 (2160×3840 portrait)
that is 2160 — ample. A subject who is genuinely taller than the frame is narrow gets a crop that
clips them vertically rather than a non-square rect; that is the correct trade for set coherence.

---

## Spec-delta shape (and why there are no MODIFIED blocks)

Three capabilities, **all `## ADDED Requirements`, zero `## MODIFIED`, zero `## REMOVED`**:

| capability | added requirements |
|---|---|
| `form-heuristics` | metrics emit exemplar instants; the spectral fit exposes its phase; the per-instance quality gate; cadence emits none |
| `results-view` | post-analysis extraction from a detached element; the evidence gallery; per-card deep link; the pipeline/diagnostics non-interference guarantee |
| `multi-clip-analysis` | machine-readable per-metric fusion source index; exemplars resolve against the clip that produced them |

This is deliberate. CLAUDE.md documents that MODIFIED/REMOVED deltas must reuse the **exact**
existing requirement title text, because the archive step matches by name and silently drops what it
cannot match. Nothing here *reverses* an existing requirement — every change is additive:

- form-heuristics' *"Output contract — value and confidence are always present, never NaN, never
  throws"* is untouched by an optional extra field.
- results-view's *"Metrics panel readouts with measurability and confidence tiers"* is untouched: the
  deep link rides the existing `chart?: ReactNode` slot on `MetricCard`
  (`MetricsPanel.tsx:86-89`, rendered at `:140`, wired by metric identity at `:236-242`), which the
  tier requirement does not describe.
- multi-clip-analysis' *"Per-metric confidence fusion across clips"* already says the **whole**
  `MetricResult` object is selected, and its *"Rich payload fields travel with the winning object"*
  scenario already covers a new payload field travelling. `fusionSourceIndices` is a **sibling**
  function, so the fusion requirement genuinely does not change.

Avoiding MODIFIED blocks entirely is therefore both correct and the safest path through the
archive-matching trap.

### ⚠️ One delta sentence now contradicts shipped code — **[correction]**, flagged, NOT edited here

`specs/form-heuristics/spec.md`, under *"Exemplar instants are ranked and gated by a per-instance
quality score"*, still carries the pre-#61 hard reject 1 verbatim:

> An instant SHALL be rejected outright, without a score, when: **any of the keypoints defining its
> crop region is `'unrecoverable'` at that frame**; …

That is the rule D3's first hard reject now corrects, and `exemplars.ts`'s shipped `cropDerivable`
violates its plain reading. It also **already contradicts this change's own `results-view` delta**,
which says crop rectangles are computed "from the **resolvable subset** of the exemplar's named
keypoints" — the two deltas cannot both be satisfied by any implementation whose seed is ever
partly unresolvable, which is most of them.

**Deliberately not edited in this correction pass**, because a spec delta is a different kind of
artifact from a design note and changing one is a decision for the ticket that owns it. It must be
fixed **before §8.10 archives this change**, or the wrong rule lands in `openspec/specs/` as the
authoritative contract. The fix is a one-clause rewrite of that first reject condition to *"no
keypoint defining its crop region resolves to a position at that frame — there being no region to
crop around"*; the block is `## ADDED`, so this is an ordinary edit to an unarchived delta, not a
MODIFIED-block matching problem. The three scenarios under that requirement are unaffected.

**Pre-existing spec drift noted, not fixed here:** results-view's tier requirement says "each of the
**ten** `MetricId`s". There are **eleven** (`heuristics/types.ts:37-48`) — `stepWidthCm` was added
without updating that count. Correcting it would require a MODIFIED block whose only content is a
numeral, on a requirement this change does not otherwise touch. Left alone deliberately; worth a
one-line follow-up.

---

## Risks

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| PTS-vs-`currentTime` drift lands a seek on the wrong frame | High — a plausible-looking wrong image | Measured per clip against `ffmpeg -ss` ground truth; calibration offset if non-zero; A/B `sequentialSampling` off to isolate | #66 / #68 |
| A ghost of two near-identical frames reads as a blurry mess | Medium | D12's IoU/same-frame demotion in the pure plan; eyeball verification on both demo clips | #65 / #68 |
| `trunkLean`/`overstriding` ghosts show two tracking glitches rather than a real range | Medium | D3 hard reject 2: the `3·MAD` outlier bound, applied before ranking | #61 |
| A mislabelled bounce caption ("peak" shown for the trough) | Medium — actively misinforms | D8's sign rule; a unit test asserting direction against a synthetic fixture with known geometry | #62 |
| Grafted centimetre exemplars picture the wrong person after a diverged scale pass | High | D5: drop grafted exemplars on `subjectAgreement.status === 'diverged'` | #64 |
| Widening `SpectralFitSuccess` perturbs the shared amplitude four metrics read | High | #62 is isolated for exactly this; assert `peakToPeakAmplitude` bit-identical, and hold the track-clip anchor (VO_cm 4.78–4.79 cm, `fit.frequencyHz × 60` == cadence) | #62 |
| Evidence extraction regresses analysis wall-clock time | Medium | Extraction runs strictly after `phase: 'ready'`, never inside the sampling loop; measured against a pre-change baseline | #66 / #68 |
| A metric is gated out on every clip and the gate is quietly loosened to fix it | Medium | `MIN_EXEMPLAR_QUALITY` is pre-registered; a universally-gated metric is a **reported finding**, not a tuning trigger | #68 |
| **`overstriding`/`trunkLean` emit nothing on ANY clip** — the extreme role's ramp is structurally unreachable on a bimodal per-instance distribution | High for those two metrics — the epic's only extreme-role rows, and the ghost is their whole point | **Measure first (§8.6).** Clearing `0.5` needs `\|v − median\| ≥ 1.5·MAD`; a tight bimodal distribution tops out at **1.0 MAD** and a clean sinusoid at **≈1.41**, so neither can ever reach it. `generateSyntheticGait` is bimodal and a symmetric real gait plausibly is too. `MIN_EXEMPLAR_QUALITY` was **deliberately not touched** by #61 and is not to be touched to fix this — the finding is that the typicality ramp and the outlier bound share one `3·MAD` scale, which is a design question. Full arithmetic in D3 | #68 |

## Open questions

- **Display size of a gallery image** is a #67 decision, not one this document makes. The crop rect
  is specified in native pixels precisely so that call stays downstream.
- **Whether two bounce cycles from the same fit are worth two exemplars**, or whether the second
  slot is better spent elsewhere for the VO family, is a judgment #68's coverage numbers should
  inform. The budget (`MAX_EXEMPLARS_PER_METRIC = 2`) is fixed; how a metric spends it is not.
