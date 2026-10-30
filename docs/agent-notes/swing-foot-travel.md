# Signed early-swing sideways foot travel — feasibility probe (NO-GO)

`strides-uz48`, probed 2026-10-29 at main `1a1bea41`. Nothing shipped: the probe module and its
console line were deleted, and `swingFootLateralExcursion` is unchanged (unsigned P80−P20 range,
25.4% on `park-approach.mp4`, 2 windows, confidence 0.27).

## What was probed

The approved design, as a standalone pure function over the presence-trimmed frames the metric
sees (logged from `useVideoAnalysis.ts` after `runClipAnalysisPipeline`, re-trimming
`robustFrames` with `trimToPresenceWindow`):

- per frame `d_S = outwardSign · (ankle_S.x − knee_S.x) / hipWidth`, `outwardSign =
  sign(sideHip.x − hipMid.x)` (stepWidth's rule), both hips resolved, the metric's existing
  hip-width floors, interpolated points excluded;
- `T = 1/rhythm.frequencyHz`; per detected strike `td`: stance baseline `[td, td+T/4]` (median),
  early swing `[td+T/2, td+5T/4]`; travel = signed P80/P20 (larger magnitude) of `d − baseline`;
- window usable iff rhythm trustworthy, `ankleMeasurable`, both windows inside the clip, ≥3 direct
  stance samples, ≥6 direct swing samples AND ≥70% direct swing coverage;
- noise floor = P80 of pooled |stance residual| over usable windows (null below 6 residuals);
- the same again against the hip midline (`ankle.x − hipMid.x`) and screen-signed (no flip).

Rule: GO only if (a) ≥1 usable window per side and a non-null floor; (b) reported |travel| ≤
floor (or ≤ 2× with keyframes showing no flick); (c) stance frames planted, estimated toe-off not
after visible mid-swing; (d) fresh-process trials identical; (e) no perspective signature.

## Result: fails (a) outright, and (b) as well once (a) is relaxed

`park-approach.mp4` uploaded alone, fresh Chromium, ANGLE Metal, sequential path, 99 frames,
`T = 0.3311 s` (R² 0.519). Two trials md5-identical (`4ad040ff…`); the front clip inside the
3-clip demo produced a byte-identical probe object. Strikes: `left@0.1001` (ankle NOT
measurable), `right@0.4338`, `left@0.7674`, `right@1.1011`, `left@1.4181`.

| k | side | td | stance direct | swing direct / frames | coverage | in clip | usable | knee travel | midline travel | screen-signed |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | left | 0.100 | 5 | 10/15 | 0.67 | yes | no (ankle, cov) | +0.303 | +0.125 | +0.303 |
| 1 | right | 0.434 | 5 | 7/15 | 0.47 | yes | no (cov) | +0.095 | +0.188 | −0.095 |
| 2 | left | 0.767 | 5 | 8/15 | 0.53 | yes | no (cov) | +0.131 | −0.204 | +0.131 |
| 3 | right | 1.101 | 5 | 10/15 | 0.67 | yes | no (cov) | +0.320 | +0.407 | −0.320 |
| 4 | left | 1.418 | 5 | 5/6 | 0.83 | **no** | no | — | — | — |

**(a) FAILS: zero usable windows, floor null, value null** for all three references. Every
complete window misses the 70% direct-swing-coverage gate: the swing ankle is interpolated through
much of the second half of each window (e.g. right, window 1: direct 0.601–0.684, interpolated
0.701–0.834 bar one frame). The keyframes show why: from about toe-off + 0.1 s the swing foot is
tucked behind its own thigh or crossing behind the stance foot, so the detector loses it exactly in
the phase the metric exists to read. The last strike's swing runs past the clip end
(1.832 > 1.668).

**Diagnostic only — the coverage gate dropped (windows 1–3), NOT a proposal:**

| reference | floor (15 pooled) | left (n) | right (n) | reported | ratio to floor |
|---|---|---|---|---|---|
| knee | 0.026 | +0.131 (1) | +0.208 (2: 0.095, 0.320) | right +0.208 | **7.97×** |
| hip midline | 0.053 | −0.204 (1) | +0.298 (2: 0.188, 0.407) | right +0.298 | **5.6×** |
| screen-signed | 0.026 | +0.131 | −0.208 | right −0.208 | 7.97× |

So **(b) also fails** on whip-free footage, for the knee reference AND the midline: the "travel"
is 6–8× the clip's stance jitter. The midline does not rescue it (do not switch references on
this evidence).

## Why the knee reference reads "outward" with no flick (keyframes)

Frame index N ↔ sampler time `(2002 + N·1001)/60000` on this clip (edit-list term, `evidence.md`);
`select='eq(n\,N)'` indexes it directly. Crops `600:1200:600:1650`, 40 px grid.

- **Stance baseline (N=66, t 1.134, right):** foot visibly planted. Shank visibly tilted: ankle
  ~30 px image-right (medial) of its knee, hip width ~118 px → baseline −0.25. (c) holds here.
- **Estimated toe-off (N=74, t 1.268):** foot still on/near the ground; heel visibly up by N=76.
  Toe-off estimate is ~2 frames EARLY, not late — (c) holds.
- **Swing extreme (N=83, t 1.418, logged +0.32):** the right lower leg is tucked behind the thigh
  and the foot is not visible; the logged ankle (815, 2283) sits ON THE THIGH, above the knee
  (829, 2400). There is no visible sideways flick.

The +0.32 is therefore (i) the stance shank's medial tilt (foot landing under the body) vanishing
once the shank points backwards and foreshortens, so "minus the stance baseline" turns ordinary
narrow-base stance geometry into outward travel; plus (ii) a guessed position for an occluded
ankle. Both are structural to a front-view knee-relative signal, not noise, and would read
"outward" on any narrow-base runner. Left window 2's extreme sits at its first sample (N=54),
where the left foot overlaps the right foot in the image (blurred, crossing).

(e) is inconclusive rather than failing: screen-signed travel is opposite in sign for the two feet
(both outward in body terms), and the runner sits left of image centre, so it is not a
"both feet toward image centre" signature; the right foot grows 0.095 → 0.320 as the runner
approaches, but n = 2.

The 3-clip demo: both side clips log no usable window (coverage 0–47%, T for side-portrait
2.564 s clip time because its ~7× slow-mo is baked in) — they would stay unsuitable regardless.

## What a next attempt needs (not designed here)

- Footage where the swing foot stays visible: a rear view (the foot comes out from behind the
  thigh toward the camera rather than away), or a longer front clip so more than 4 complete windows
  exist. The bead already lists both as follow-ups.
- A baseline that is not stance: stance shank tilt is not the swing shank's neutral. Any reference
  has to be neutral in early swing itself (e.g. the knee's own line projected with the thigh), and
  that needs a visible ankle in early swing first.
- Do not loosen the coverage gate to get a number: the frames it drops are the occluded ones, and
  the diagnostic above shows what they produce.

Artifacts (scratchpad of the probing session, not in the repo): probe JSON per trial, the
relaxed-gate diagnostic, keyframes `kf-n{46,54,60,66,74,83}.png` and contact sheet
`sheet-64-90.png` (frames 64–90, every 2nd, 7×2).

---

# Follow-up spike: does the swing foot leave the leg's outline? (segmentation mask) — qualified GO

`strides-uz48.1`, 2026-10-29 at main `ad5ebb9e`. Spike only: the temporary `[outline-probe]`
console line in `useVideoAnalysis.ts` and its `outlineProtrusion.experimental.ts` were reverted and
deleted. Nothing ships.

**Question.** The joint-position probe above failed because, seen from the front, a foot with no
whip is hidden behind the thigh. So ask the reverse question with the person mask. In each early
swing, does anything below the swing knee stick out OUTWARD past the outer edge of that leg's
thigh, and by how much as a fraction of hip width? A foot with no whip should read "stayed inside
the outline".

## Method

- **Pose inputs (live):** `park-approach.mp4` uploaded alone, a fresh Chromium process for each
  trial, ANGLE Metal, sequential path, 99 frames, frame index i = coded picture N. A dev-only line
  logged the MoveNet hips and knees per frame, plus `analyzeHipBounce` and `detectFootstrikes` on the
  presence-trimmed frames. They match the probe above: T = 0.3311 s, strikes L 0.100, R 0.434,
  L 0.767, R 1.101, L 1.418.
- **Masks (offline):** ffmpeg extracted all 99 frames at full 2160×3840. A scratch page ran
  `@mediapipe/tasks-vision` 1.0.1 `PoseLandmarker`, using the repo's self-hosted
  `pose_landmarker_full.task` with `outputSegmentationMasks: true`, GPU delegate and real-GPU
  Chromium. The confidence mask is thresholded at > 0.5. This is the scale pass's own model, but the
  scale pass does not request masks today (see "Production" below). Pose-input fidelity was not
  touched: the masks are a separate offline pass.
- **Signal per frame and swing side S:** take the outward sign s = sign(hip_S.x − hipMid.x) and
  L = knee.y − hip_S.y.
  - *Thigh edge:* in rows [knee − 0.40L, knee − 0.10L], start from the hip→knee line, take the
    mask run there (or the nearest run within 0.3 HW) and walk outward until it ends. The edge is
    the median over the usable rows, and at least half the rows must be usable.
  - *Lower band:* rows from knee + 0.3L down to the lowest row of the mask component that contains
    the thigh-band runs (8-connected, rows below the band top only). Take the outermost component
    pixel on the swing side of the hip midline.
  - *Residual* = s·(outermost − thighEdge)/HW, and *protrusion* = max(0, residual). No pixel on the
    swing side counts as protrusion 0: the lower leg is hidden behind the thigh.
- **Windows** are the probe's: early swing [td+T/2, td+5T/4] and stance [td, td+T/4]. A window is
  usable when it lies inside the clip and has at least 6 good frames covering at least 70% of it.
  The reported value is P80 of protrusion. The floor is the same measure over stance frames from
  both legs.
- **Mask-trust gate:** a frame is dropped when MediaPipe's own hips or knees sit more than 0.5 HW
  from MoveNet's. The mask comes from MediaPipe's pose ROI, so a mis-tracked pose means a mask of
  unknown provenance.

**Three choices were made AFTER seeing this clip's data. With n = 1 clip, treat them as
hypotheses, not validated parameters:**

1. **The lower band starts at knee + 0.3L, not at the knee.** With the band starting at the knee,
   the only positive readings (+0.012 at n37, +0.023 to +0.045 at n74–77) were the knee's own
   lateral contour, which bulges past the narrower thigh-band edge (keyframe `ov-n076-right.png` of
   the first pass). That variant reports k3 right P80 = 0.018 > floor 0, though still below the
   stance jitter (0.029).
2. **The connected-component restriction.** Full-frame masks bled onto a bystander through the
   torso (n7, n16, n22).
3. **The masks are run on a MoveNet-guided crop.** See the next section.

## Mask source matters: the full frame fails on the early (far) frames, a MoveNet-guided crop fixes it

The first pass ran PoseLandmarker in VIDEO mode on full frames, which is how the scale pass runs
it. 94 of 99 frames returned a mask. On frames 0–24, though, MediaPipe's hips and knees sat
0.84–4.3 HW from MoveNet's; from frame 25 on they sit within ≤ 0.32 HW, a bimodal split. On those
early frames the mask misses the planted shoe (n7), punches holes in the torso, and bleeds onto the
yellow-shirt bystander. The trust gate then drops 11 of 15 frames of window k0, which leaves the
LEFT side with only 1 usable window. On this mask source the spike would fail "≥ 2 per side".

The second pass ran IMAGE mode on a 7·HW × 12·HW crop centred on MoveNet's hip-mid. The crop is at
native pixels, not rescaled. MediaPipe then agrees with MoveNet to ≤ 0.44 HW on every frame but n4
(0.82, gated). Every frame returns a mask, with no bystander bleed. **All numbers below use the crop
masks.**

## Result (crop masks)

| k | side | early-swing window (s) | good / frames | usable | protrusion P80 | max | closest approach (residual max) | residual P80 |
|---|---|---|---|---|---|---|---|---|
| 0 | left | 0.266–0.514 | 15/15 | yes | **0.000** | 0.000 | −0.138 | −0.262 |
| 1 | right | 0.599–0.848 | 15/15 | yes | **0.000** | 0.000 | −0.094 | −0.205 |
| 2 | left | 0.933–1.181 | 15/15 | yes | **0.000** | 0.000 | −0.246 | −0.455 |
| 3 | right | 1.267–1.515 | 15/15 | yes | **0.000** | 0.000 | −0.038 | −0.060 |
| 4 | left | 1.584–1.832 | 6/6 | no (runs past clip end 1.668) | 0.000 | 0.000 | −0.222 | −0.245 |

Stance, 24 frames pooled from both legs (n4 gated):

- clamped protrusion P80 = **0.000**, with every stance residual ≤ −0.031;
- signed residual P80 = −0.104;
- P80 |residual| (the brief's literal floor) = 0.197;
- jitter P80 |residual − own-window median| = 0.042.

The swing reading of 0.000 lies within every one of these floors. In 9 frames no swing-side pixel
existed below knee + 0.3L (k2 n57–59, k3 n81–86, k4 n96–98), because the lower leg was hidden
behind the thigh.

**Positive control.** A synthetic flicked lower leg was injected into every real swing mask: a
12 px shank strip hanging from the knee keypoint, plus a foot bar from it reaching w past the
measured thigh edge at knee + [0.45L, 0.60L]. It is connected to the leg the way a real foot is.

| injected w (HW) | window P80 per window (k0–k4) |
|---|---|
| 0.05 | 0.054, 0.050, 0.052, 0.053, 0.051 |
| 0.10 | 0.107, 0.102, 0.104, 0.103, 0.102 |
| 0.20 | 0.203, 0.203, 0.203, 0.203, 0.202 |
| 0.30 | 0.306, 0.304, 0.304, 0.302, 0.301 |

Every window reads within +0.007 of the injected size, which is pixel rounding. This checks the
geometry: component, sign, side and band. It does NOT show that MediaPipe would segment a real,
motion-blurred flicked foot.

**Determinism.** Both live trials are md5-identical (`867ddb76…`). Two fresh crop-segmentation
processes produced identical mask sets (combined md5 `f0a6e45e…`) and identical landmarks
(`ce062ae1…`). The analysis output is identical too (`1fd02d18…`).

**Keyframes** (scratchpad `uz48-outline/kf/`, crop masks). Each shows the cyan mask outline, the
yellow thigh band and its edge line, the lower-band component tinted green, the outermost pixel in
red, the knee in magenta, MoveNet's ankle in green and the hip midline in white.

- Early swing, left: n16, n22, n56, n62. The left lower leg is tucked behind its thigh and not
  visible, so the outermost swing-side pixel is the STANCE foot that crossed the midline,
  0.18–0.48 HW inside the edge.
- Early swing, right: n37, n44, n76, n83. The right shank and shoe are partly visible behind or
  medial to the knee at n37 and n76; n83 has no lower pixel at all.
- Stance: n7, n46 (left) and n26, n66 (right).
- Injected: `*-inj0.2.png`.

The mask follows the visible leg, including the motion-blurred shoes (n37 right, n76 left, n83
left), and does not bleed into the ground shadow. The hands stay above the thigh band in every
frame reviewed. Contact sheets: `sheet-c1-{swing-left,swing-right,stance,inject0.2}.png`. The
first-pass full-frame sheets are `sheet-{swing-left,swing-right,stance}.png`, which show the
bystander bleed and the shoe missing at n7.

## Verdict: qualified GO for the question asked, on one clip

The criteria are met with the crop masks:

- 2 usable windows per side;
- protrusion 0.000 in every window, within the stance floor;
- keyframes confirm the mask;
- the positive control passes;
- the trials are identical.

The qualifiers matter more than the pass:

- **This answers "did anything stick out past the outline", not "how far did the foot travel".**
  For most of early swing the foot is hidden behind the thigh, and a hidden foot reads 0 by
  construction. The closest any lower-band pixel came to the edge was −0.038 HW (k3); window
  residual P80 ran −0.06 to −0.46 HW. So a whip moves the needle only once the foot clears the
  outer thigh edge. A mild whip that stays behind the thigh reads 0, the same as no whip. That is a
  detection threshold set by thigh width, not a resolution of 0.04.
- **It has never seen a whip.** Only the injected control reads positive. Whether the mask keeps
  a blurred, flicked foot attached to the shank is untested and needs footage with a whip.
- **The three post-hoc choices** (lower-band start, component restriction, crop ROI) were fitted to
  this clip.
- **The full-frame VIDEO mask, which is what the scale pass would produce, fails** "≥ 2 per side".

## What a production version would need

- **Masks are not available in production today.** No code requests `outputSegmentationMasks`.
  The scale pass is the only MediaPipe pass: VIDEO mode on full frames, and on this clip that mode
  gives untrustworthy masks for the first 25 frames. A production version needs:
  - a MoveNet-guided crop for the MediaPipe call (the crop here: hip-mid centred, 7×12 HW, native
    pixels);
  - the MP-vs-MoveNet agreement gate.
- **Cost (measured on the crop path, IMAGE mode, M4 Pro, median of 99 frames):**
  - `detect` takes 94.9 ms with masks and 94.7 ms without, so the mask adds nothing measurable to
    inference;
  - reading the crop-sized float mask (`getAsFloat32Array`) adds 1.4 ms.

  So masks are nearly free if a MediaPipe pass already runs. The real costs are the crop and the
  IMAGE-mode detector (or a VIDEO tracker re-seeded per crop), and keeping memory bounded: a
  full-frame 4K float mask is 33 MB, so reduce it in the loop to per-row runs of the lower body
  and never store it.
- **Before any metric:** footage with a real whip (rear or front), to check that a flicked shoe
  stays in the mask and connected. Also more than this one 1.65 s clip. Copy that says "no foot
  protruded past the leg's outline" rather than "no sideways travel".

Artifacts (scratchpad `uz48-outline/`, not in the repo):

- `drive-live.mjs` (live pose dump);
- `segment.mjs` (mask pass: full-frame VIDEO or `crops.json` IMAGE mode, with timing);
- `analyze.py` (`--lower-start`, `--inject`, `--overlays`);
- the `live-t*.json`, `masks-{v1,c1,c2}/` and `res-*.json` outputs, plus the keyframes and sheets
  above.

The extracted frames were deleted. Re-extract them with
`ffmpeg -i park-approach.mp4 -start_number 0 frames/n%03d.png` before regenerating overlays.
