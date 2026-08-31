# Design — root cause of MediaPipe's front-view ankle error

Method: four investigators on distinct hypotheses (per-frame data, keyframe ground truth, code-path
audit, upstream library contract), then one confirming experiment run by the orchestrator. All
measurements fresh Chromium process per trial, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev
server identity-verified, cold page load confirmed.

## D1. Root cause: TWO stacked defects that multiply

They are separable, and each was measured independently.

| defect | factor | where |
|---|---|---|
| **D1a — raw detection failure at clip-open** | ~1.97x | MediaPipe's own detections |
| **D1b — interpolation amplification** | ~2.45x | `interpolate.ts` + `viewDetection.ts` |
| combined | **~4.8x** | the observed SER gap |

Verified end to end by an experiment the diagnosis predicted before running it — MediaPipe forced as
primary on Demo 2, one arm with the interpolation gap budget cut so the gap goes unrecoverable
instead of being filled:

| arm | `view.diagnostics.sagittalExcursionRatio` |
|---|---|
| default (`maxGapSeconds: 0.5`) | **1.59113** |
| `{"robustness":{"maxGapSeconds":0.05}}` | **0.650297** |

0.650297 reproduces the independently-computed raw per-frame value (0.651) to three decimals, and
1.59113 reproduces the production figure exactly. Both arms detect 87/99 frames, so the arms differ
only in what happens to the 12 they miss.

### D1a — the model emits a "best guess" it cannot support, and says it is confident

At clip-open the subject is at their most distant: hand-measured torso **150 px** at t=0, growing
**4x** across the clip. After the landmarker's square resize to ~192-256 px input that torso is
**~7-8 px** and the shoe **~2 px**. MediaPipe fails 10 of 12 consecutive frames there
(t = 0.033-0.267 s) — a window where MoveNet misses nothing and reads normal values throughout,
which is what establishes that no real excursion is occurring.

The few detections it does return in that window are wrong in a specific way: **both ankles collapse
onto nearly the same point**, ~307-327 px from the hip against a 150-195 px torso. MediaPipe's own
model card describes exactly this degradation — undeterminable points get a "'best guess' and default
pose", degrading by "predicting average point location".

Also in frame at t=0, and consistent with the confusion: heavy motion blur on the feet, white
trainers against light-grey gravel in flat overcast light, and **a second person's white shoes at the
runner's own hip height** ~70 px away, at the moment he is smallest.

**Nothing catches it.** Those outlier frames carry `visibility` **0.41-0.87**, comfortably clear of
the repo's sole gate (`minKeypointConfidence: 0.3`). That is not bad luck: `visibility` is a
Google-acknowledged, still-open bug (`google-ai-edge/mediapipe#5197`, maintainer: *"this is a bug in
our pose detection model. We need to fix this."*), and it stays high for marginally-out-of-frame and
occluded joints — measured at 0.92 for a landmark at `y = 1.009`. The repo uses a signal its vendor
has labelled defective as its only validity gate.

### D1b — interpolation turns 4 bad frames into 14, defeating the percentile trim

`interpolateChannel` (`interpolate.ts`) linearly fills any gap up to `maxGapSeconds: 0.5`. The
10-frame gap at clip-open is 0.33 s, comfortably inside budget, and **both flanking anchors are the
bad detections above** — so every interpolated frame lands in the same extreme zone. The outlier
population grows from ~4 raw frames (4.6%) to ~14 (16%).

`computeSagittalRange` reduces by `percentile(.., 0.95) - percentile(.., 0.05)`. At n = 87 that trims
roughly the top 4 values. The docstring claims robustness to "a single wildly-off ankle sample" —
true for one, false for fourteen. **13 of 87 frames (14.9%), all at t < 0.45 s, carry more than 100%
of the raw inflation**: dropping them takes the range from 163.0 px to 70.8 px, *below* MoveNet's own
77.1 px.

**The load-bearing code defect is backend-agnostic.** `resolvePoint` returns
`{x, y, interpolated}`; `computeSagittalRange` reads `.x` and discards `.interpolated`.
`stepWidth.ts:99` honours the identical flag. **`viewDetection.ts` is the only consumer in the repo
that receives the robustness layer's own trust signal and throws it away** — and view detection gates
every other metric. This is shared code, not MediaPipe's adapter; it does not bite MoveNet on these
clips only because MoveNet has no gaps to fill.

## D2. Ground truth, established independently of both models

Hand-measured from keyframes with a grid overlay, ~13 frames sampled across the clip:

- **Per-ankle horizontal excursion: 0.16-0.20 torso lengths**, every measurement medial — the
  narrow-track front-view signature. All-in estimate including a ~4-5 degree off-axis path and
  normalisation effects: **0.20-0.35**.
- **MoveNet's 0.3284 sits in that band. MediaPipe's 1.5911 is physically impossible** — it demands
  ~477 px of ankle-to-hip travel, wider than the runner's entire shoulder span (~290 px).
- Camera is handheld but nearly static (~60 px pan, ~75 px tilt over 1.65 s, no roll) and square to
  the subject within ~4-5 degrees. CLAUDE.md's "dead-on front approach" is confirmed.

## D3. Three hypotheses REFUTED — recorded so they are not re-derived

- **Out-of-frame extrapolation — refuted on this clip.** Zero normalized coordinates outside [0,1]
  across all 87 detected frames (ankles, heels, foot-indices). The feet never leave frame either: at
  the largest frame the lowest shoe sits **630 px (16% of frame height)** above the bottom edge.
  The mechanism is real upstream — MediaPipe emits unbounded normalized coordinates and does not
  clamp — but it is **not what is happening here**, so a bounds check at the adapter would be a
  **no-op on this clip**.
- **Left/right swap — refuted, with a mechanism.** MediaPipe and MoveNet genuinely disagree about
  which physical leg is screen-left (84/87 vs 0/96 crossover), a real convention difference worth
  knowing. But SER is computed per leg-label against *that same label's own hip*, so a globally
  consistent relabel cancels exactly. A strict pairwise swap test found no intra-series swap events.
- **Swing-leg occlusion — refuted as the driver.** The swing foot IS occluded behind the body on
  ~8 of 11 sampled stride frames, and that looked like a strong candidate. But the confirmed-occluded
  frames (t ≈ 1.00-1.67 s) all read unremarkable, MoveNet-like values (-22 to -126 px). The outliers
  are somewhere else entirely: t < 0.45 s. Right mechanism, wrong part of the clip.
- **Denominator difference — refuted.** `torsoLengthPx` ratio mp/mn = **1.058-1.075x** on both clips.

## D4. RETRACTION: this repo recorded an unsound inference as fact

CLAUDE.md and `2026-08-31-diagnose-scale-pass-view-divergence/design.md` both assert: *"BSR and SER
share a denominator, so the entire 4.8x is in SER's numerator."* **The premise is true and the
conclusion does not follow.** BSR agreeing pins the *ratio* `N_bsr / T`, not `T`. Algebraically
`(N_ser,mp / N_ser,mn) = 4.61 x (N_bsr,mp / N_bsr,mn)` — the ankle-range ratio is 4.8x only if the two
backends' shoulder/hip spreads also agree, which nobody had measured.

It survives measurement (`torsoLengthPx` really does agree within 7.5%), so the conclusion stands —
but it stood on luck, and the same reasoning would have concealed a hip-side or torso-side error.
Corrected in CLAUDE.md rather than left as a load-bearing non sequitur.

Two related over-claims corrected with it: the `stepWidth` figure cited as "corroboration from
another direction" is the *same* quantity (`ankle.x - hipMid.x`) with a different denominator, so it
is not independent evidence; and `COMMON_KEYPOINT_NAMES` is **19** and includes heel/foot_index since
`72b0564` (#44), not the 15 CLAUDE.md still records.

## D5. Remediation sketch — NOT a decision

**Fixing D1b alone is necessary but NOT sufficient**, and this is the sharpest constraint on any
remedy. At SER 0.650 MediaPipe casts *no* SER vote at all (front needs <= 0.4, side needs >= 0.8), so
the label stays `ambiguous` — by abstention rather than by conflict — and `stepWidthCm` stays
tier-3 excluded. Any remedy aiming to make `stepWidthCm` render must also address D1a.

| # | option | fixes | cost / risk |
|---|---|---|---|
| **1** | **Honour `interpolated` in view detection**, as `stepWidth.ts` already does | D1b (2.45x) | Small, backend-agnostic, has in-repo precedent. **But it edits SHARED code and changes MoveNet's view path too** — needs an A/B on all three clips. Does not restore the front label alone. |
| 2 | Ticket's (b): raise the visibility gate for MediaPipe | nothing | **Not viable on the measured distribution.** Outliers score 0.41-0.87; separating them needs a bar above 0.87, which rejects most good keypoints. Same shape as the 4K area-floor finding — no separating threshold exists. |
| 3 | H4's suggestion: reject out-of-[0,1] landmarks at the adapter | nothing here | **No-op on this clip** (zero out-of-range coords). Cheap insurance against a real upstream behaviour, but not this bug. |
| 4 | Make SER robust to a minority of bad frames (e.g. trim wider than p5/p95, or require a minimum detected-frame fraction *for SER specifically*) | D1b, and part of D1a | Medium. Note SER's own sample count is **never reported**, and its coverage gate is checked against a different, more permissive frame population. |
| 5 | Ticket's (c): stop trusting MediaPipe's lower body except for scale | the symptom | **Self-defeating for the stated goal** — SER is *defined* on ankles, so MediaPipe could never commit to a view, and `stepWidthCm` is itself ankle-derived. Removes the metric it was meant to rescue. |

**Recommendation: option 1, then re-measure before deciding anything further.** It is the one
genuine code defect found (a trust signal computed and then discarded), it has in-repo precedent, and
it is the largest single multiplier. It should be scoped and A/B'd on its own, because it touches
shared code and its blast radius reaches MoveNet.

## D6. Open question that bears directly on `strides-wac`

`strides-fn4` withheld `strides-wac` on the grounds that `stepWidthCm`'s VALUE is untrustworthy
because MediaPipe's ankles are bad. That worry is now **more nuanced, not simply confirmed**:

- SER is a p95-p5 **range** (outlier-amplifying); `stepWidth` is a **median at footstrikes**
  (outlier-suppressing). A 4.8x inflated range does not imply a wrong median.
- Cross-backend **median** ankle-to-ankle distance is only **~20 px**. MediaPipe's ankles appear
  mostly fine; the damage is concentrated in ~15% of frames at clip-open.
- Yet the two passes' `stepWidth` still differ 1.79x (0.2253 vs 0.4042), which the clip-opening
  outliers do **not** obviously explain, since a median should shrug them off.

**So the 1.79x `stepWidth` gap is NOT yet explained by this diagnosis.** It may come from the
different denominator (`hipWidthPx`), from the two passes detecting footstrikes at different
instants, or from a further defect. `strides-wac` should not ship until it is.
