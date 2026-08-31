# Design — place a floored evidence crop on the subject

## D1. What data actually exists, and what does not

The ticket's original design note said to use the bounding boxes from
`src/results/retroactivePersonSelection.ts`. That data does not reach the planning layer and cannot be
made to: `selectRetroactivePersonOfInterest` derives a per-frame box with `deriveBoundingBox` purely to
score, segment and rank tracks, then discards every one of them and returns only
`PersonSelectionDiagnostics`, an aggregate for the dev console. Neither module imports the other in
either direction.

There is also no per-frame record of anybody else anywhere in the pipeline. `RobustPoseFrame` and
`PoseSample` carry no bounding box; detection is single-person per frame at the detector level. **There
is structurally no bystander to look up, and no rule can be written that names one.**

What *is* in hand at `computeEvidenceCropRect`, and was not being read, is the frame itself. Each
`RobustPoseFrame` carries a dense `keypoints` array with one entry per `COMMON_KEYPOINT_NAMES`, each
tagged `detected` / `interpolated` / `unrecoverable`. `frameCropBox` reads only the subset the exemplar
named — three points for a limb metric. The subject's own extent is one loop away.

Covering the subject and not covering what is beside them are the same act. That is the whole
mechanism.

## D2. The measurement this was designed against

A temporary `[crop-geometry]` probe (`cropGeometryProbe.experimental.ts` plus one call in
`planExemplarFrames`, both since reverted per CLAUDE.md's add-measure-revert cycle) dumped, for every
planned exemplar on all three test clips: the ROI box, its padded side, the crop returned, and the
subject box over all 19 keypoint names. Headless Chromium, real GPU, fresh process per clip.

`FLOOR` marks a crop the display floor inflated (`padded < 320`).

| clip | metric | ROI | padded | crop | subject | |
|---|---|---|---|---|---|---|
| Demo 1 | `verticalOscillation` / `verticalRatio` | 848×738 | 1357 | 1356.9 @ 1499,152 | 1125×1143 | |
| Demo 1 | `trunkLean` | 1055×591 | 1687 | 1687.4 @ 1541,0 | 1238×1135 | |
| Demo 1 | `overstriding` | 1403×607 | 2245 | 2160.0 @ 1015,0 | 1409×1138 | capped |
| Demo 1 | `kneeFlexion` | 1059×553 | 1694 | 1694.3 @ 2146,348 | 1059×1137 | |
| Demo 1 | `footStrikePattern` R / L | 140×258 / 57×268 | 413 / 429 | 412.6 / 429.2 | 324×960 / 487×1089 | |
| Demo 1 | `verticalOscillationCm` | 804×736 | 1286 | 1285.8 @ 1557,187 | 1036×1147 | |
| Demo 2 | `verticalOscillation` / `…Cm` | 180×450 | 720 | 719.9 @ 499,1555 | 283×768 | |
| Demo 2 | **`armSwingSymmetry` left** | 91×140 | **223** | **320.0 @ 797** | **278×623** | **FLOOR** |
| Demo 2 | **`armSwingSymmetry` right** | 53×157 | **250** | **320.0 @ 586** | **282×623** | **FLOOR** |
| Demo 2 | `stepWidth` | 85×325 | 521 | 520.6 @ 576,1808 | 222×610 | |
| multi | `verticalOscillation` / `verticalRatio` | 230×206 | 368 | 368.4 @ 220,501 | 302×288 | |
| multi | `trunkLean` | 458×138 | 733 | 732.6 @ 614,253 | 525×280 | |
| multi | **`kneeFlexion`** | 99×146 | **233** | **320.0 @ 0,620** | **116×290** | **FLOOR** |
| multi | **`footStrikePattern` R / L** | 21×75 / 14×79 | **120 / 126** | **320.0** | **135×289 / 119×287** | **FLOOR** |
| multi | **`verticalOscillationCm`** | 196×187 | **314** | **320.0 @ 672,521** | **247×290** | **FLOOR** |

Six crops are floor-inflated, across two clips. Two of them are the defect; the other four are the
shapes the previous attempt broke.

## D3. The rule, and why each half of it is load-bearing

Per axis A, with `side` the crop's side, `padded` the side the exemplar's own keypoints asked for, and
`extent` the subject box's extent:

```
padded <= extent[A] < side          (1)
extent[other] >= side               (2)
=> centre the crop on the subject along A
```

**(1) says the FLOOR, not the padding, is what made the crop wider than the subject here.** Below the
floor the crop would have been `padded`, which (1) says is no wider than the subject; at the floor it
is wider. That is the precise statement of "area the metric did not ask for". It is what keeps this
rule away from crops the padding sized — Demo 2's `verticalOscillation` crop is 720 px over a 283 px
runner, four times wider than the body and nowhere near the floor, and it must not be re-framed by
this rule. It also subsumes the frame cap without a special case: a capped crop has `side < padded`,
and no `extent` satisfies `padded <= extent < side` when `side < padded`.

**(2) says the crop is a BAND ACROSS one body** — a detail of a runner rather than a scene that
contains a whole one. When the crop is larger than the subject on both axes it already holds all of
them, and moving it only swaps one piece of background for another with nothing in hand to prefer
either.

(2) is not a theoretical safeguard. It is the clause that prevents both regressions the previous,
lost implementation of this ticket produced, and the numbers come from the table above:

- **multiperson `kneeFlexion`**: `padded` 233 ≤ `extent.y` 290 < 320 satisfies (1) vertically. Without
  (2) the crop rides **66 px up the body** — which is what promoted a walking bystander from a pair of
  legs at the top edge into the middle of the picture, at 130 px the most legible human in the image.
  `extent.x` 116 < 320 fails (2). Declined.
- **multiperson `footStrikePattern`**, both sides: `padded` 120/126 ≤ `extent.y` 289/287 < 320
  satisfies (1) vertically. Without (2) the left crop rides **104 px up the body**, which reframes a
  foot close-up as a whole-body shot with the sole clipped off. `extent.x` 135/119 < 320 fails (2).
  Declined.
- **multiperson `verticalOscillationCm`**: `extent` 247×290, both under 320. Fails (2) on both axes.
  Declined.
- **Demo 1 `verticalOscillationCm`** (the third regression — heads clipped at the top edge): not
  floor-inflated at all, `padded` 1286 ≈ `side` 1285.8, so (1) fails on both axes. Declined.

## D4. Centred, not flush — and what "subject extent" means when the feet are unobservable

`frameSubjectExtentBox` is a **lower bound** on the subject, not an outline. On MoveNet, the default
backend, `left_heel` / `right_heel` / `left_foot_index` / `right_foot_index` never resolve — they
arrive `'unrecoverable'` — so the box stops at the ankles and the runner's shoes hang below it.
`frameCropBox` already documents the same fact for the crop set. This is exactly the trap the previous
attempt fell into: it read the box as "where the body ends", understood the subject as head-to-ankle,
and landed a crop bottom 16.7 px below the ankle with the sole cut off.

Two decisions follow from treating it as a lower bound.

**The box says where the body certainly IS, never where it stops.** Both conditions in D3 use it that
way: (1) and (2) compare extents to decide whether the crop is a band across a body, and the answer is
robust to a shortened box in the safe direction — truncation makes `extent.y` smaller, which makes (2)
fail more often, which declines more often.

**Centring is the minimax placement under that uncertainty.** Centring leaves `(side − extent) / 2` of
margin at *both* ends of the axis, which is the largest margin obtainable at either end. The
alternative — sliding just far enough to contain the box — reserves nothing on the side it slid
toward, which is precisely where an unobserved foot would be. Under a lower-bound box, the placement
that reserves the most room everywhere is the right one.

**The residual, stated rather than hidden.** A *vertical* shift needs `extent.x >= side > extent.y`:
a subject wider than the crop and shorter than it. For an upright runner that does not happen, and no
exemplar on any of the three test clips reaches it — every qualifying axis measured was horizontal.
If it were reached, the missing feet would bias the vertical centre upward by half their length. The
guarantee that survives it is asserted rather than assumed (`can only move vertically on a subject
WIDER than the crop, and still holds the crop box`): the measured region stays in the picture.

## D5. Why the measured region cannot leave the picture

`cropBox` is built from a **subset** of the names `frameSubjectExtentBox` reads, so
`cropBox ⊆ subjectBox` by construction. On a qualifying axis `extent < side`, so the whole subject box
fits inside the crop — and therefore so does all of the measured region. The other axis does not move.

No clamp on the shift is needed for that guarantee and none is applied. A cap — for instance bounding
the shift by the floor's own surplus, `(side − padded) / 2` — was considered and rejected: on Demo 2 it
would move the left-arm crop only 48 px of the 94 it needs, leaving the crop still cutting 24 px off
the runner's left edge while keeping 66 px of background on his right, with the bystander's leg and
shoe still in the corner. It would trade picture quality for a property that already holds.

## D6. Frame clamp

The frame clamp repeats `computeCropRect`'s two positioning lines rather than calling it. Passing a
reconstructed square back through `computeCropRect` risks a one-ulp change in `side` — `side` is on the
`[evidence-coverage]` line and is compared by the harness — and a size change is precisely what this
rule must never make. Shift-not-shrink behaviour is preserved and pinned by a test that asserts the
result equals `computeCropRect`'s own output for the same centre.

## D7. Live result

Same harness, same three clips, after the change. Only the two Demo 2 arm crops move:

| metric | before | after | subject |
|---|---|---|---|
| `armSwingSymmetry` left | 320 @ x **797** | 320 @ x **703** | 278 px wide @ x 725 |
| `armSwingSymmetry` right | 320 @ x **586** | 320 @ x **701** | 282 px wide @ x 720 |

Every other extracted image on all three clips is **byte-identical** to the pre-change run — 8 of 8 on
Demo 1, 7 of 7 on multiperson, 3 of 5 on Demo 2 — which is the strongest available evidence that the
three known regression shapes do not occur: the exact images the previous attempt broke are the same
bytes.

Looked at, full resolution and at the real 144 CSS px inline size, on all three clips: the yellow-shirt
bystander is gone from the left-arm image, the runner is centred and his torso complete, and the
annotated arm sits in the right-hand third. The right-arm image improves for the same reason in the
opposite direction — it had spent 134 px of its width on empty park to the runner's left.

Metrics, confidences, `[evidence-coverage]` per-metric statuses and every `cropSidePx` are unchanged on
all three clips. Demo 1's anchor: `verticalOscillationCm` `4.421467928439415` cm,
`fit.frequencyHz × 60 = 91.2 == cadence.value 91.2`, `subjectAgreement` 52/53.

## D8. `strides-a8y` is a different mechanism and this rule declines to touch it

The same bystander sits at the right edge of Demo 2's `verticalOscillation` / `verticalOscillationCm`
(719.9 px, one image) and `stepWidth` (520.6 px) crops. Those crops are **not floor-bound**: their
padded sides are 720 and 521, so condition (1) fails on both axes and this rule cannot fire.

That is deliberate and it is also correct. Had (1) been dropped, `verticalOscillation` on that clip
would qualify (`extent.x` 283 < 719.9, `extent.y` 768 ≥ 719.9) and centring would move it **+20 px
toward the bystander** — the crop is currently placed slightly left of the runner's centre, and the
runner's centre is toward the yellow shirt. A rule that helped the small crop would make the large one
marginally worse.

Those crops are large because their keypoint sets legitimately span the body, and the bystander is
simply inside a correctly-sized crop of a real scene. No crop rule that keeps the measured region in
frame can exclude him. Recorded on the bead as working-as-intended.
