# Design — measure pair crop growth before clamping

## Context

`isTooFarApartPair` / `evidencePairCropGrowth` (`src/results/evidenceFrames.ts`) is gh #71's guard,
shipped by `strides-ac9.11`. It answers "would ghosting these two instants shrink the runner past
legibility". `strides-492` is the finding that on a large frame it cannot answer that at all.

Everything below is arithmetic on the repo's own exported functions and on box geometry already
recorded in `evidenceFrames.test.ts`. No live browser run was performed — that is the user's step,
and `cropGrowth` on the `[evidence-coverage]` line is the instrument this change adds for it.

## The saturation, measured

`computeCropRect(box, W, H, 1.6, 320).side = min(max(max(w, h) × 1.6, 320), min(W, H))`. The old
measure passed the union AND each single through that, so both ends could saturate at `min(W, H)`.

3840×2160, full-body box 320×1240 (solo demand `1240 × 1.6 = 1984`; cap 2160):

| pair geometry | union box width | old (capped) | new (demand) |
|---|---|---|---|
| adjacent | 640 | **1.0000** | 1.0000 |
| half a frame apart | 2240 | **1.0887** | 1.8065 |
| opposite edges | 3840 | **1.0887** | **3.0968** |

The old column's last two rows are the same number to every decimal: the union crop saturated at
2160 in both cases, so the numerator stopped carrying separation. Two further rows from the ticket,
reproduced exactly:

| clip / subject | pair geometry | old | new |
|---|---|---|---|
| 3840×2160, torso 260×620 | opposite edges | 2.1774 | 6.1935 |
| 1920×1080, small subject 90×300 | opposite edges | 2.2500 | 6.4000 |

Note the second row: even a *varying* old reading was varying only because the denominator moved.
On the 4K row the guard was structurally incapable of firing at any separation.

### Why the cap, and not the floor

The two clamps are not symmetric and the constant's doc had them merged:

- The **floor** binds from BELOW. It raises the denominator and the numerator alike. A pair whose
  union the 320 px floor already frames genuinely costs the reader nothing a single would not also
  have paid, and 1 is the honest reading. Charging the pair for the floor would silently convert
  this guard into a "subject too small" guard — a different question, about a framing decision the
  demoted single inherits anyway. `evidenceFrames.test.ts`'s "cannot fire on two small boxes the
  320 px floor already frames together" already pins that, and it still passes byte-for-byte.
- The **cap** binds from ABOVE. It truncates the numerator only, and only past the point where the
  question gets interesting. It measures what the frame can SUPPLY; the criterion is about what the
  pair DEMANDS.

So: drop the cap, keep the floor. `evidenceCropSideDemand(box) = max(max(w, h) × 1.6, 320)`.

Dropping the floor as well was considered and rejected. A degenerate box (a single resolvable
keypoint, so `max(w, h) = 0`) would give a solo demand of 0, `evidencePairCropGrowth` would return
`null` for want of a denominator, and `isTooFarApartPair` would answer `false` — a far-apart pair of
degenerate boxes would sail straight through the guard that exists to catch it.

### Why this is not the "did the crop hit the cap" test the doc rejects

`EVIDENCE_MAX_PAIR_CROP_GROWTH`'s doc correctly rejects a cap test: "`computeCropRect`'s cap binds
on every crop on a small source, so a cap test would delete every ghost on a 320×240 webcam clip."
That rejection stands, and the demand ratio is not it:

1. It never asks whether any clamp bound. It is a continuous ratio of two demands, defined
   identically at every frame size.
2. It keeps the floor, and the floor is what makes a small source safe — provably, not empirically.
   On a frame whose larger dimension is `D`, the union's long side cannot exceed `D`, so the
   numerator cannot exceed `D × 1.6`, while the denominator rests on 320 for any subject a small
   frame can hold. Growth is therefore bounded by `D × 1.6 / 320`, which reaches 2.5 only at
   `D ≥ 500`. **On a 320×240 webcam clip the ceiling is 1.6 and this guard cannot fire at any
   separation, for any subject size.** Checked at three points in the new unit test: adjacent
   (1.000), opposite edges (1.600), and a large subject at opposite edges (1.600).

A cap test on that same clip would have rejected everything. The two are opposites, not variants.

## The calibration bracket

`2.5` is bracketed by two images that were extracted and looked at (`strides-ac9.11`, 3 trials,
bit-identical): it must exceed **2.190** (`kneeFlexion` on `e2e/fixtures/multiperson-track.mp4`, two
clearly legible runner positions) and must not reach **3.375** (the same clip's `trunkLean`, #71's
whole-frame crop). Both were read under the capped formula.

**Direction is guaranteed.** The denominator is unchanged (the floor is retained, and the cap never
bound on a solo crop in any measured pair). The numerator loses only a ceiling. So every reading is
`new ≥ old`, and a reading moves at all only if that pair's own union crop was capped.

### The upper side: safe, and provably so

`3.375 = 1080 / 320` exactly — union at the cap over solo at the floor. It was a saturated reading
whose true value was always larger. `BROKEN`'s boxes are on record in `evidenceFrames.test.ts`
(34×79 at x=300 and 53×131 at x=1410 on 1920×1080):

- solo demand: `max(79 × 1.6, 320) = 320` and `max(131 × 1.6, 320) = 320` → 320
- union: 1163 px wide → `1163 × 1.6 = 1860.8`
- **new reading 5.815**, against 3.375 before.

It moves further from the threshold, not nearer. The upper bracket cannot break under a monotone
increase, so this side needs no live confirmation.

### The lower side: predicted unchanged at 2.190, to be confirmed live

The 2.190 pair's box geometry was not recorded, so its new reading is argued rather than computed.
Under the capped formula, `2.190 = min(unionDemand, 1080) / soloDemand`. Two cases:

- **Case A — the cap did not bind** (`unionDemand ≤ 1080`). Then the new reading equals the old one:
  **2.190 exactly**, and the bracket holds with the same 0.31 of margin it had.
- **Case B — the cap bound.** Then `soloDemand = 1080 / 2.190 = 493.2`, i.e. that pair's subject box
  had a long side of exactly `493.2 / 1.6 = 308.2` px.

Case A is much the likelier, on evidence from the same clip. On `multiperson-track.mp4` the runner
is small: the `trunkLean` torso boxes measured there are **79 px and 131 px** tall. A `kneeFlexion`
box (hip→knee→ankle plus context) on the same runner in the same clip cannot plausibly be 308 px —
that is 2.4× the larger of the two torso boxes. A box that small pads to 126–210 px and lands on the
320 px floor, which puts `unionDemand = 2.190 × 320 = 700.8` px, comfortably under the 1080 cap. The
cap did not bind, and the reading does not move.

The two other recorded pairs corroborate: both are unchanged, because neither union comes near its
clip's cap.

| pair | clip | old | new |
|---|---|---|---|
| `STRIDE_PAIR` — Demo 1 `verticalRatio`, the best ghost measured | 3840×2160 | 2.0675 | **2.0675** |
| `LOPSIDED` — Demo 1 `kneeFlexion`, legible and lopsided | 3840×2160 | 1.9150 | **1.9150** |
| `BROKEN` — multiperson `trunkLean`, #71's crop | 1920×1080 | 3.3750 | **5.8150** |

So of the thirteen readings on record, exactly one is expected to move, and it is the broken one.

**This is still a prediction on the 2.190 pair and is to be confirmed live before landing.** That is
what `cropGrowth` on `[evidence-coverage]` is for. If it comes back at or above 2.5, the correct
response is to stop and report, not to move the threshold: `EVIDENCE_MAX_PAIR_CROP_GROWTH` sits in a
gap that two reviewed images define, and moving it is a decision to reclassify one of them.

### One thing the instrument cannot show

`cropGrowth` rides on an exemplar record, and a rejected pair has no plan and therefore no record —
it surfaces as `all-gated-out` on that metric instead. So the line reports the *surviving* readings
(all necessarily below 2.5, the lower bracket among them) and not the rejected ones. That is enough
to confirm the lower bracket, which is the side at risk; the upper side is settled by the arithmetic
above and does not need a live number.

## The live failure this closes

Demo 1's `trunkLean` after `strides-9mb`: `t=6.16` at the far right edge, `t=3.96` at the far left,
on a 3840-wide clip. Union spans essentially the whole frame, so `unionDemand ≈ 3840 × 1.6 = 6144`.
Rejection needs `6144 / soloDemand ≥ 2.5`, i.e. `soloDemand ≤ 2457.6`, i.e. a subject box long side
of 1536 px or less. The largest evidence box measured anywhere on Demo 1 is 563 px. The pair is
rejected with roughly 2.7× of margin, and the card falls back to no evidence.

## Decisions

**D1 — `evidenceCropSideDemand` is its own two-line function, not `computeCropRect` with an infinite
frame.** Passing `Infinity` would work arithmetically but returns a whole rect whose `x`/`y` are
arithmetic on infinities, and a caller could read them. The re-derivation is a genuine drift risk
and is pinned by a test asserting the two agree exactly wherever the cap does not bind.

**D2 — `cropGrowth` lives on `EvidenceFramePlan`, not recomputed in the coverage summarizer.**
`planExemplarFrames` already holds both boxes; the summarizer holds neither, and re-deriving them
from the plan's resolved keypoints would be a second implementation of `frameCropBox` that could
disagree with the first. Cost: five test fixture literals gained a field. The plan is already where
`quality` and `demotedFromPair` live, both of which are likewise diagnostics rather than render
inputs.

**D3 — `cropGrowth` is `null` for a demoted pair, not 1.** A demoted pair draws no ghost, so the
quantity does not exist. Reporting 1 would say "ghosting was free" about an image that was not
ghosted.

**D4 — no threshold moved.** `EVIDENCE_MAX_PAIR_CROP_GROWTH` (2.5), `EVIDENCE_CROP_MIN_SIDE_PX`
(320), `EVIDENCE_CROP_PADDING_MULTIPLIER` (1.6) and `MIN_EXEMPLAR_QUALITY` (0.5) are byte-identical.
The fix does not need one, which is the point: the measure was wrong, not the criterion.

**D5 — the doc's false claim is replaced, not deleted.** The sentence "self-cancelling under both of
`computeCropRect`'s clamps, since a floor or a cap that binds on the pair's crop binds on the
single's too" is quoted in its replacement and then corrected, so a reader who remembers it finds
out why it is gone rather than wondering whether it was dropped by accident.

## Tests

- The three 4K geometries above, asserted distinct and strictly increasing, with opposite-edge over
  the threshold — plus the old formula recomputed inline and asserted to give the *same* number for
  half-frame and opposite-edge, so the regression is pinned from both sides.
- `evidenceCropSideDemand` equals `computeCropRect(...).side` on four boxes where the cap does not
  bind (D1's drift guard).
- Small-source safety on 320×240: adjacent, opposite edges, and a large subject at opposite edges,
  all kept. This replaces the old "cannot fire on a source too small to crop, where the cap binds on
  both sides" test, which asserted the saturation as a feature and used boxes outside the frame it
  named.
- `BROKEN` at 5.815, `STRIDE_PAIR` at 2.0675 and `LOPSIDED` at 1.915 — the bracket's arithmetic.
- The `min`-vs-`max` argument, restated against the threshold rather than against `BROKEN`'s value
  (which has moved): a `min` reading puts the legible `LOPSIDED` pair at 3.495, 40% past 2.5, and
  would drop it.
- `cropGrowth` populated on a planned pair, `null` on a single, `null` on a demoted pair, and
  present in the `[evidence-coverage]` payload.
