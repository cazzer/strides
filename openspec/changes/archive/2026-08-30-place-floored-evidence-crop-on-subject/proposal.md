# Place a floored evidence crop on the subject

## Why

`EVIDENCE_CROP_MIN_SIDE_PX` (320) is a floor on **pixels**. Its own doc comment says so: it was
"chosen against the VIEWER rather than a detector", so a thumbnail is not upscaled to mush. It is not
a framing decision, and it knows nothing about what is standing beside the runner.

`computeCropRect` centres every crop on the box it was given. On a three-keypoint limb box that box
is small — `armSwingSymmetry`'s left-arm box on `park-approach.mp4` measures 91 × 140 px, padding to
223 — so the floor enlarges the crop by 97 px and, because the centre never moves, spends half of that
enlargement on whichever side of the arm has no runner in it. On that clip the side in question holds
a man in a yellow shirt. He lands inside the crop, at similar scale, and the ghosted composite makes
him read as a second body in an image whose caption is about one runner. Reproduced on every trial
(`strides-e9b`, GitHub #71 item 2).

Measured, before this change, on the fresh-process regime the harness now defaults to:

| clip | metric | ROI box | padded | crop | subject extent |
|---|---|---|---|---|---|
| Demo 2 | `armSwingSymmetry` left | 91 × 140 | 223 | **320** @ x 797 | 278 × 623 @ x 725 |
| Demo 2 | `armSwingSymmetry` right | 53 × 157 | 250 | **320** @ x 586 | 282 × 623 @ x 720 |

The runner is 278 px wide inside a 320 px crop and the crop is placed 72 px to the right of him: it
cuts 24 px off his left edge and reaches 114 px past his right, which is where the bystander is. The
crop is *wider than the runner* and still does not contain him.

## What changes

- A floor-inflated crop is placed on the **subject** along an axis where the floor — not the padding —
  is what made it wider than the subject, provided the subject is larger than the crop on the other
  axis. `subjectCentredCropRect` in `src/results/evidenceFrames.ts`.
- The subject's extent comes from the frame's own complete keypoint set (`frameSubjectExtentBox`,
  every name in `COMMON_KEYPOINT_NAMES` that resolves), unioned across the frames the crop is drawn
  through. This is data already in hand at the planning site — no new data path, no second detection
  pass.
- `evidenceCropPaddedSide` is split out of `evidenceCropSideDemand`, so "the side the metric asked
  for" has one definition rather than two.
- `results-view`'s crop-derivation requirement gains the placement rule and one scenario.

**`EVIDENCE_CROP_MIN_SIDE_PX` is unchanged at 320**, and moving it was ruled out up front — it came
from display reasoning, and re-deriving it against one clip's bystander would be tuning a constant to
a scene. `EVIDENCE_CROP_PADDING_MULTIPLIER` (1.6), `EVIDENCE_MAX_PAIR_CROP_GROWTH` (2.5),
`EVIDENCE_NEAR_IDENTICAL_IOU` (0.98), `MIN_EXEMPLAR_QUALITY` (0.5), `EVIDENCE_GHOST_BLEND_ALPHA`
(0.35), `EVIDENCE_GHOST_MARK_OPACITY` (0.5) and the 3-MAD outlier bound are all untouched. No new
tunable constant is introduced at all: both conditions are read off the geometry and the padding
multiplier that already exist.

**Only `x` and `y` move; `side` never does.** That is what keeps this change invisible to
`evidenceCropSideDemand`, `evidencePairCropGrowth`, `isTooFarApartPair` and the `[evidence-coverage]`
line's `cropSidePx` — and it is what keeps it consistent with "A ghosted pair is judged on the crop it
demands, not the crop the frame can supply", whose own text pins the drawn crop as padded, squared and
frame-clamped.

## Impact

- `src/results/evidenceFrames.ts` — `frameSubjectExtentBox`, `subjectCentredCropRect`,
  `evidenceCropPaddedSide`; `computeEvidenceCropRect` places its result through the new rule.
- `src/results/evidenceFrames.test.ts` — 18 new cases, including the two regression shapes this rule
  must decline to fire on and the MoveNet-versus-MediaPipe foot-keypoint difference.
- `openspec/specs/results-view/spec.md` — via this change's delta.

Measured live (headless Chromium, `ANGLE Metal Renderer: Apple M4 Pro`, fresh process per clip, all
three test clips): **every extracted image on Demo 1 and on `multiperson-track.mp4` is byte-identical
to the pre-change run**, as are three of Demo 2's five. The two Demo 2 arm-swing images are the only
pixels that move anywhere. Every metric value, every confidence, `[evidence-coverage]` per-metric
status and every `cropSidePx` are unchanged on all three clips; Demo 1's `verticalOscillationCm`
anchor still reads `4.421467928439415` cm with `fit.frequencyHz × 60 = 91.2 == cadence 91.2`.

Out of scope: `strides-a8y`, the same bystander at the edge of Demo 2's three **larger** crops
(`verticalOscillation`/`verticalOscillationCm` at 719.9 px and `stepWidth` at 520.6 px). Those crops
are sized by the padding, not the floor, so this rule deliberately declines to fire on them — see
`design.md`.
