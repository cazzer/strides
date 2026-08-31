# Frame the head, and floor a pair's separation in sampled frames

## Why

Two defects in **which evidence image a reader ends up looking at**. They are separate mechanisms
that produce the same class of harm — an image that contradicts the caption beside it — and both
were confirmed live on all three test clips before anything changed.

### `strides-ql0` — the bounce crop cuts the head off the base instant

`BOUNCE_CONTEXT_KEYPOINTS` was shoulders and knees. `computeEvidenceCropRect` unions both instants'
boxes over that band and pads, so the crown of the head sits above the padded top edge.

The cruelty is in *which* instant loses it. `buildBounceCycleExemplar` pins the BASE to the highest
point of the bounce, so the base is the body nearest the top edge and the base is what gets clipped,
while the lower ghost keeps its whole head. Measured on Demo 2 before this change: the base's
nose/ear line cleared the crop's top edge by **35.5 px** against the ghost's **87.5 px**, on a 720 px
crop — and the visible scalp above that line was cut on the base alone. The composite therefore held
exactly one complete, legible face **and it belonged to the ghost**. A reader anchors on that face as
"the runner", and the solid skeleton — correctly drawn on the base's body above it — reads as
mis-registered. This was a contributing factor to the "wrong body is ghosted" report whose other half
`strides-c37` fixed.

### `strides-r41` — a two-frame pair survives the near-identical guard and ghosts into one pose

On `e2e/fixtures/multiperson-track.mp4`, `kneeFlexion` pairs t=3.516667 with t=3.55 — **33 ms, two
sampled frames**. The caption promises "peak knee flexion, ghosted against the same leg near full
extension"; the image shows one bent leg and a smeared foot. Re-measured after `strides-cjl` changed
footstrike timing: **the pair is still exactly there.**

`EVIDENCE_NEAR_IDENTICAL_IOU = 0.98` does not catch it, and — the finding that decides this change's
shape — **no threshold on IoU can**, because IoU orders these cases backwards.

## What changes

- **The bounce family's context set gains `nose`, `left_ear` and `right_ear`**, so both instants of a
  bounce pair keep their heads. This enlarges the crop, which was measured rather than assumed: it
  moves `evidencePairCropGrowth` *toward* 1 on 7 of 8 bounce pairs, the largest reading falling
  1.197 → 1.104 against the 2.5 threshold.
- **A new near-identical test on ELAPSED TIME**, `isTooCloseInTimePair`, expressed in the module's own
  unit: a pair fewer than `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS = 3` sampled frame intervals apart
  is one instant. It joins the existing box-IoU test rather than replacing it — the two catch
  different failures.
- **`EVIDENCE_NEAR_IDENTICAL_IOU` stays at 0.98**, and the measurement showing why it cannot be moved
  is recorded on the constant.
- **`kneeFlexionPeak` becomes demotable** (`SINGLE_INSTANT_KINDS`), because its reported value is a
  peak angle read off ONE frame — like a footstrike, unlike a cycle or a range whose number *is* the
  difference between two instants. Without this the new guard would delete the metric's evidence
  instead of replacing a bad ghost with an honest still, which inverts the guard's whole purpose.

## The evidence that chose an elapsed-time floor over the IoU threshold

The bead asks explicitly whether an elapsed-time floor is right here, given that CLAUDE.md records
absolute separation and elapsed time both ordering the FAR-APART cases backwards. Measured live,
real GPU, every surviving ghosted pair on all three clips, against the one known-broken pair:

| measure | broken pair | tightest GOOD pair | separates? |
|---|---|---|---|
| box IoU | 0.2476 | 0.8330 (demo2 bounce) | **no — backwards** |
| median joint travel, output px | 7.10 | 5.19 (demo2 bounce) | **no — backwards** |
| joint travel ÷ box diagonal | 0.128 | 0.054 (demo2 bounce) | **no — backwards** |
| **elapsed, in sampled intervals** | **2** | **8** (demo1 `verticalOscillationCm`) | **yes, 4×** |

The broken pair MOVES MORE than a good one on every display-space measure, because what moved is one
jittered ankle rather than a body. Lowering the IoU threshold far enough to reject it (≤0.2476) would
reject three good images first. Only elapsed time orders them correctly, and in sampled intervals the
gap is empty on both sides — nothing measured sits at 3, 4, 5, 6 or 7.

**This does not contradict the far-apart guard's rejection of elapsed time**, because the two ends ask
different questions. At the far end the question is whether two bodies can share one legible crop —
spatial, and a stationary subject 1.667 s apart ghosts perfectly. At the near end the question is
whether the two instants are the two distinct gait phases the label names — and a pair two sampled
frames apart is not, at any human cadence. That is a claim about the signal, whose unit is time.

## Impact

- Specs: `results-view` — the crop-derivation requirement and the near-identical demotion behaviour.
- Code: `src/heuristics/bounceInstants.ts`, `src/results/evidenceFrames.ts`, and their tests.
- **Coverage is unchanged on all three clips**: Demo 1 8 images / 7 sections, Demo 2 5 / 4,
  multiperson 8 / 7 — before and after. Exactly one pair changed verdict (multiperson `kneeFlexion`,
  now a demoted single); every other pair kept its ghost, and every non-bounce crop rect is
  byte-identical.
- Regression anchor holds: Demo 1 `verticalOscillationCm` = 4.421467928439415,
  `fit.frequencyHz × 60 == cadence.value == 91.2`.
