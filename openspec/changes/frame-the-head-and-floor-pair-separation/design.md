# Design

Everything below was measured in headless Chromium on real GPU
(`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, never SwiftShader), fresh Chromium process per
clip, against a dev server whose identity was verified by nonce
(`assertServesThisCheckout`, port 5325 derived for this checkout). Every image was pulled out of the
DOM with `canvas.toDataURL('image/png')` and looked at, at full resolution and at the 142 CSS px the
card actually renders.

## The instrument

A temporary `[pair-geometry]` probe (`pairGeometryProbe.experimental.ts` plus one dev-only log line
in `useSessionEvidence.ts`'s `emitCoverage`, both added, measured and **reverted**) dumped, for every
ghosted pair that survived the plan guards: elapsed time, box IoU, `cropGrowth`, crop side, per-joint
displacement in native / output / CSS pixels, and the head keypoints' clearance against the crop's
top edge. It read the geometry off the PLAN — `base.keypoints`, `ghost.keypoints`, `crop` — which is
exactly the data the guards themselves see, so nothing is re-derived by a different route.

Coverage was read from `[evidence-coverage]`, taking the LAST line after the stream went quiet for
8 s with the scale pass seen, never the first — the MediaPipe graft triggers a correct re-extraction
and a second line.

## D1 — `strides-ql0`: which instant loses its head, and why that is the whole defect

`BOUNCE_CONTEXT_KEYPOINTS` was shoulders + knees. The union of both instants' boxes tops out at the
higher instant's shoulders, and `computeCropRect` leaves 30% of the box's long dimension as margin at
each end — not enough for a head.

Head-keypoint clearance against the crop's top edge, before (negative = inside the crop, so the number
is the margin in native px):

| clip | metric | crop side | base head margin | ghost head margin |
|---|---|---|---|---|
| demo1 | `verticalOscillation` | 1357 | 174.0 | 237.1 |
| demo1 | `verticalOscillationCm` | 1286 | 139.7 | 186.8 |
| demo2 | `verticalOscillation` | 720 | **35.5** | 87.5 |
| demo2 | `verticalOscillationCm` | 720 | **35.5** | 87.5 |
| multiperson | `verticalOscillation` | 368 | **51.2** | 73.5 |
| multiperson | `verticalOscillationCm` | 320 | **29.4** | 43.0 |

**The base is tighter than the ghost on every pair, on every clip.** That is not a coincidence, it is
the mechanism: `buildBounceCycleExemplar` pins the base to the highest point of the bounce, so the
base is always the instant nearest the top edge. The nose/ear *keypoints* stay inside — but the crown
of the head sits well above them, so on Demo 2's 35.5 px margin the visible scalp is cut on the base
and kept on the ghost. Confirmed by looking: the pre-change Demo 2 image is cropped through the
runner's cap.

### The measured cost of the fix

Adding `nose`/`left_ear`/`right_ear` enlarges both per-instant boxes and their union. The growth
ratio is `demand(union) / max(demand(base), demand(ghost))`, and a head adds very nearly the same
number of pixels to the union's long side and to each solo box's long side — so a ratio greater
than 1 falls when both terms gain the same addend.

| clip | metric | growth before | growth after | Δ | crop side | base head margin |
|---|---|---|---|---|---|---|
| demo1 | `verticalOscillation` | 1.1974 | **1.0358** | −0.1617 | 1357 → 1398 | 174.0 → 262.1 |
| demo1 | `verticalRatio` | 1.1974 | **1.0358** | −0.1617 | 1357 → 1398 | 174.0 → 262.1 |
| demo1 | `verticalOscillationCm` | 1.1347 | **1.0330** | −0.1017 | 1286 → 1394 | 139.7 → 261.4 |
| demo2 | `verticalOscillation` | 1.0044 | **1.0036** | −0.0008 | 720 → 879 | 35.5 → 164.8 |
| demo2 | `verticalOscillationCm` | 1.0044 | **1.0036** | −0.0008 | 720 → 879 | 35.5 → 164.8 |
| multiperson | `verticalOscillation` | 1.1512 | **1.1041** | −0.0470 | 368 → 377 | 51.2 → 70.7 |
| multiperson | `verticalRatio` | 1.1512 | **1.1041** | −0.0470 | 368 → 377 | 51.2 → 70.7 |
| multiperson | `verticalOscillationCm` | 1.0000 | **1.0649** | +0.0649 | 320 → 359 | 29.4 → 67.3 |

**Seven of eight moved toward 1; the largest reading on any bounce pair is 1.104 against a threshold
of 2.5.** The one that rose did so from exactly 1.0000, where both solo crops sat on the
`EVIDENCE_CROP_MIN_SIDE_PX` floor and the floor cancelled — once the boxes clear the floor the ratio
starts carrying real information again, which is the guard working, not degrading. No bounce pair
comes within a factor of two of the threshold, and `EVIDENCE_MAX_PAIR_CROP_GROWTH` was not touched.

**Every non-bounce pair is byte-identical** — `kneeFlexion` 1.9154, `overstriding` 2.4277 / 2.1752,
`trunkLean` 1.8660 / 2.2895, `armSwingSymmetry` 1.0000, `stepWidth` 1.1981, and every crop side
unchanged. The context set reaches only the three metrics that call `buildBounceCycleExemplar`.

The subject does get smaller: Demo 2's crop grows 720 → 879 native px, so the runner presents at 82%
of its previous size. That is the trade the bead named, and the image remains clearly legible at
142 CSS px.

### A visible side effect worth naming

`instantPlan` builds its `keypoints` from `exemplar.cropKeypoints`, so the annotation layer now draws
the nose and both ears on bounce exemplars — an ear-nose triangle and two neck anchors, in the same
cyan detected-joint layer as everything else. This is the runner's own detected geometry, which the
annotation requirement asks for, and on a metric about vertical position it is useful: the head is
now visibly marked at two heights. It is nonetheless a change to what is drawn, arrived at through a
data change rather than a draw-layer one, and `drawEvidenceAnnotations.ts` / `evidenceAnnotations.ts`
were not edited.

## D2 — `strides-r41`: the 33 ms pair is still there, and IoU cannot reach it

Re-measured after `strides-cjl`: `kneeFlexion` on `e2e/fixtures/multiperson-track.mp4` pairs
**t = 3.516667 with t = 3.55**, a 33 ms / two-sampled-frame gap, `cropGrowth` 1.000, crop side 320.
Unchanged from the bead's note. Looked at: the hip and knee marks of the two instants sit on top of
each other and only the foot smears; the "near full extension" the caption promises is not in the
picture.

### Every surviving ghosted pair, all three clips

| clip | metric | elapsed | intervals | IoU | growth | joint travel (CSS px, median / max) |
|---|---|---|---|---|---|---|
| **multiperson** | **`kneeFlexion`** | **0.0333** | **2** | **0.2476** | 1.000 | **7.10 / 39.65** |
| demo2 | `verticalOscillation` | 0.1668 | 10 | 0.8330 | 1.004 | 5.19 / 8.44 |
| demo2 | `verticalOscillationCm` | 0.1668 | 10 | 0.8330 | 1.004 | 5.19 / 8.44 |
| multiperson | `verticalOscillation` | 0.1667 | 10 | 0.0000 | 1.151 | 57.44 / 80.01 |
| multiperson | `verticalOscillationCm` | 0.1667 | 10 | 0.0000 | 1.000 | 69.68 / 86.60 |
| multiperson | `verticalRatio` | 0.1667 | 10 | 0.0000 | 1.151 | 57.44 / 80.01 |
| demo2 | `stepWidth` | 0.3170 | 19 | 0.2984 | 1.198 | 17.48 / 64.65 |
| demo1 | `verticalOscillationCm` | 0.3200 | 8 | 0.0000 | 1.135 | 63.83 / 65.81 |
| demo2 | `armSwingSymmetry` | 0.3337 | 20 | 0.3656 | 1.000 | 15.76 / 23.68 |
| demo2 | `armSwingSymmetry` | 0.3503 | 21 | 0.0000 | 1.000 | 24.57 / 40.83 |
| multiperson | `overstriding` | 0.3500 | 21 | 0.0000 | 2.175 | 64.72 / 92.25 |
| demo1 | `verticalOscillation` | 0.3600 | 9 | 0.0000 | 1.197 | 66.90 / 75.89 |
| demo1 | `verticalRatio` | 0.3600 | 9 | 0.0000 | 1.197 | 66.90 / 75.89 |
| demo1 | `kneeFlexion` | 0.4000 | 10 | 0.0000 | 1.915 | 58.66 / 92.98 |
| multiperson | `trunkLean` | 0.4667 | 28 | 0.0000 | 2.289 | 80.80 / 84.35 |
| demo1 | `trunkLean` | 0.4800 | 12 | 0.0000 | 1.866 | 67.77 / 75.72 |
| demo1 | `overstriding` | 0.6400 | 16 | 0.0000 | 2.428 | 69.54 / 74.13 |

### Why every display-space measure fails

- **IoU**: broken 0.2476, good up to 0.8330. To catch the broken pair you need a threshold ≤ 0.2476,
  which first rejects Demo 2's bounce (0.8330), its `armSwingSymmetry` (0.3656) and its `stepWidth`
  (0.2984). **Backwards, by a wide margin.** The reason is structural: a bounding box is blind to
  motion inside itself. A leg swinging through its own hull changes the pose completely while barely
  moving the box; a small distant limb box changes shape a lot between adjacent frames while showing
  one pose. `EVIDENCE_NEAR_IDENTICAL_IOU` was therefore **left at 0.98**.
- **Joint travel, in output pixels**: broken 7.10 CSS px median, Demo 2's perfectly legible bounce
  **5.19**. Backwards.
- **Joint travel ÷ box diagonal** (the dimensionless form, matching the far-apart guard's own
  language): broken 0.128, Demo 2's bounce 0.054. Backwards.

The broken pair moves MORE than a good one on every spatial measure because what moved is one
jittered ankle (`max` 39.65 CSS px against a `median` of 7.10 — the signature of one joint, not a
body) rather than a runner changing phase.

### Elapsed time, in sampled intervals

Broken pair **2 intervals**; tightest good pair **8** (`demo1 verticalOscillationCm`). Nothing
measured sits at 3, 4, 5, 6 or 7 — the gap is empty on both sides, a 4× window.

`EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS = 3`, derived rather than picked:

- **It must exceed 2**, the measured defect.
- **It must not reach 8**, the tightest measured legitimate pair.
- **The physical bound sets it.** The tightest pair any metric here can honestly emit is half a
  bounce cycle at `spectralFitMaxFrequencyHz` (4.0 Hz) = 0.125 s; every other paired kind — a knee
  peak-to-extension, an arm-swing half cycle, a stride pair — is half a STRIDE, twice that again. At
  a sampled rate `r`, 0.125 s is `0.125 × r` intervals, which is **≥ 3 whenever `r ≥ 24`**. Sampling
  defaults to every decoded frame (`targetSamplesPerSecond: null`) and no consumer capture rate is
  below 24 fps, so on any clip this pipeline can meaningfully fit, half a bounce is at least three
  intervals.

Realised margins: the floor is 0.12 s on Demo 1 (25 fps) and 0.05 s on both 60 fps clips, against
tightest real pairs of 0.32 s, 0.167 s and 0.167 s — **2.7×, 3.3× and 3.3× clear**, with the broken
pair 1.5× below it.

**Honest limit**, recorded rather than smoothed over: at exactly 24–25 fps the floor (0.120–0.125 s)
meets the 0.125 s physical bound with almost no margin, so a 240 spm cadence filmed at 25 fps is the
one case where this could reject a real bounce pair. That clip is already unfittable for an unrelated
reason — 6.25 samples per cycle is barely above Nyquist — so the pair would fail its own metric's
quality gate first.

### Why in intervals rather than seconds

A sampled interval is this module's own time resolution, and `snapToSampledFrame` already declares
anything within half of one to be the same frame. It also scales the right way: a sparsely sampled
clip genuinely cannot resolve gait phase as finely as a dense one, so the floor should widen with the
interval. `toleranceSeconds` is half the median interval and is already threaded into
`planExemplarFrames`, so twice it is the interval and no new plumbing was needed.

### Why this does not contradict the far-apart guard

`EVIDENCE_MAX_PAIR_CROP_GROWTH` rejects elapsed time explicitly, and that rejection stands. The two
ends ask different questions. **Far end**: can two bodies share one legible crop? Spatial — a
stationary subject 1.667 s apart ghosts perfectly, a sprinter 0.3 s apart does not. **Near end**: are
these two instants the two distinct gait phases the label names? A property of the signal, measured
in time. The measurements above are the evidence that the answer genuinely differs by end: the
spatial measures order the near cases backwards, exactly as time orders the far cases backwards.

## D3 — why `kneeFlexionPeak` had to become demotable

`SINGLE_INSTANT_KINDS` held only `footStrike` and `stepWidthStrike`, on the stated grounds that a
peak "needs its adjacent trough to be legible". `kneeFlexion` emits exactly one candidate
(`candidates.slice(0, 1)`) and attaches no `alternates`, so with the new guard firing the metric's
evidence would have been **deleted** rather than demoted — turning a rule whose purpose is to replace
a misleading ghost with an honest still into one that removes the picture. Coverage would have gone
8/7 → 7/6 on multiperson.

The move is principled, not a coverage patch. The discriminator is where the reported number lives:

| kind | reported value | one frame shows |
|---|---|---|
| `footStrike`, `stepWidthStrike`, **`kneeFlexionPeak`** | a quantity at ONE instant | the whole measurement, with its own annotation geometry |
| `bounceCycle`, `armSwingCycle`, `stridePair` | an amplitude / length BETWEEN two instants | no part of the number |
| `trunkLeanRange`, `overstrideRange` | a RANGE across instants | no part of the number |

`kneeFlexion.value` is a peak angle read off one frame, and the annotation draws that frame's own
arc — so the demoted still shows exactly what the card reports. "Needs its trough to be legible"
conflates a helpful comparison with a necessary one. Verified by looking: the demoted image is a
clean, sharp single frame of the bent leg with the knee arc clearly readable, and the smeared
double-foot is gone.

The caption is the one that already ships for a demoted pair: *"Peak knee flexion (left leg), ghosted
against the same leg near full extension. Shown as one frame: the paired instant was too similar to
tell apart. 3.52 s into the clip."* The label's promise is stated and then corrected in the same
breath, which is the existing pattern for `stepWidthStrike`; `evidenceCaptions.ts` was not touched.

A far-apart pair is still **dropped** for every kind including this one — that asymmetry is unchanged
and is asserted.

## D4 — guard ordering

The time test joins `pairCollapsed`, so it is evaluated before `isTooFarApartPair`. A pair that is
both fewer than three intervals apart AND far apart in space is a tracking jump rather than real
travel, and "these are the same moment" is the more accurate description of it, so collapsing first
is right. The practical effect is that such a pair now demotes for a demotable kind instead of being
dropped — an honest still in place of nothing.

## D5 — test fixtures had to move, and that is a real finding

`evidenceFrames.test.ts` drove pairs on a 0.1 s grid with `toleranceSeconds` 0.05, placing them
**one sampled interval apart** — precisely what the new rule forbids. Fourteen tests failed, all for
that reason. Each pair fixture's TIMESTAMPS were widened (0.1 → 0.4) while every POSITION was left
untouched, so all the crop, IoU and growth arithmetic the assertions depend on is unchanged.

`crossingFrames` needed more than a timestamp shift, because its sample count and its spatial
separation are the same knob: 200 px per sample made "one sample apart" the drawable case, which the
new floor collapses. It is now 80 px per sample over 7 frames, so four samples apart reads growth 2.1
and is drawn, five reads exactly 2.5 and is rejected at the inclusive boundary, six reads 2.9 — the
same three-way structure the fallback tests need, relocated above the near floor.

The `isTooCloseInTimePair` boundary is deliberately **not** asserted at exactly three intervals:
`3 × (2 × 0.05)` is `0.30000000000000004` in binary floating point, so an exact tie lands wherever
the representation error puts it. Both neighbours are pinned instead.

## Verification

- `npx tsc -b` clean, `npx eslint src/` clean, `npx vitest run` **1350 passed, 0 failed**.
- Coverage, fresh-process regime, before and after: Demo 1 **8 images / 7 sections**, Demo 2
  **5 / 4**, multiperson **8 / 7** — identical, and the DOM canvas count matches the coverage line on
  every clip.
- Exactly one pair changed verdict across all three clips: multiperson `kneeFlexion`, now
  `demotedFromPair: true` with `pairedTimestamp: null`. Every other pair kept its ghost.
- Regression anchor: Demo 1 `verticalOscillationCm` = `4.421467928439415`,
  `fit.frequencyHz × 60` = 91.2 = `cadence.value`.

### A note on the coverage baseline

The task brief quoted multiperson at 7 images / 6 sections. Measured on this checkout at `c79d307`
**before any change**, it is **8 / 7** — the extra section is `verticalRatio`, which plans a
`bounceCycle` alongside `verticalOscillation` on that clip. Both the before and after readings here
are 8 / 7, taken by the same instrument in the same regime, so the comparison is internally
consistent; the discrepancy is with the quoted figure, not between the two sides of this change.
