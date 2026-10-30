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
