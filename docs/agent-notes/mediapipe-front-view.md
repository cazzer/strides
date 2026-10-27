# MediaPipe front-view ankles and the stepWidth gap

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## MediaPipe's front-view ankle error — ROOT CAUSE, two stacked defects (2026-08-31, `strides-boc`)

Diagnosis of the SER gap above. Four parallel investigators plus one confirming experiment; fresh
Chromium per trial, real GPU, cold page load, identity-verified server.

**The cause is TWO separable defects that MULTIPLY**, not one:

| defect | factor | where |
|---|---|---|
| **raw detection failure at clip-open** | ~1.97× | MediaPipe's own detections |
| **interpolation amplification** | ~2.45× | `interpolate.ts` + `viewDetection.ts` |
| combined | **~4.8×** | the observed gap |

Verified end-to-end, MediaPipe forced primary on Demo 2, both arms detecting 87/99 so they differ
only in what happens to the 12 they miss:

| arm | SER |
|---|---|
| default (`maxGapSeconds: 0.5`) | **1.59113** |
| `{"robustness":{"maxGapSeconds":0.05}}` | **0.650297** |

**Defect 1 — the model guesses and reports confidence.** At clip-open the subject is most distant:
hand-measured torso **150 px** at t=0, growing **4×** across the clip, so after the landmarker's
square resize the torso is **~7–8 px** and the shoe **~2 px**. MediaPipe misses 10 of 12 consecutive
frames (t = 0.033–0.267 s) where MoveNet misses none and reads normally throughout. The detections it
does return collapse **both ankles onto nearly one point**, ~307–327 px from the hip against a
150–195 px torso — precisely the "'best guess' and default pose … predicting average point location"
degradation MediaPipe's own model card describes. Also in frame there: heavy foot motion blur, white
shoes on light-grey gravel, and **a second person's shoes at the runner's hip height**.
Nothing catches it — those frames carry `visibility` **0.41–0.87**, clear of the 0.3 gate. That is
not bad luck: `visibility` is a Google-acknowledged, still-open bug
(`google-ai-edge/mediapipe#5197`, maintainer: *"this is a bug in our pose detection model"*), high
even for out-of-frame joints (0.92 measured at `y = 1.009`). **The repo's only validity gate is a
signal its vendor has labelled defective.**

**Defect 2 — interpolation turns 4 bad frames into 14, and the load-bearing bug is in SHARED code.**
The 10-frame gap is 0.33 s, inside `maxGapSeconds: 0.5`, and **both flanking anchors are bad**, so
every filled frame lands in the extreme zone. **13 of 87 frames (14.9%), all t < 0.45 s, carry more
than 100% of the raw inflation** — dropping them takes the range 163.0 px → **70.8 px, below
MoveNet's own 77.1 px**. `computeSagittalRange`'s p95−p5 trims only ~4 values at n=87; its docstring
claims robustness to "a single wildly-off ankle sample", true for one and false for fourteen.
✅ **Fixed since `strides-kxn`:** `computeSagittalRange` now EXCLUDES every sample whose ankle or
own hip was interpolated (`viewDetection.ts:113`) and reports the discarded share per side as
`sagittalExcursionInterpolatedFraction`. (This paragraph used to say `viewDetection.ts` was the only
consumer that received `resolvePoint`'s `.interpolated` flag and discarded it; that is no longer
true.)

**SER is normalized by a LOCAL torso since `strides-cge`** (2026-10-02, change
`normalize-sagittal-excursion-by-local-torso`). Each detected sample is rescaled by
`clipTorso / localTorso`, where `localTorso` is the median over ±0.5 s
(`LOCAL_TORSO_HALF_WINDOW_SECONDS`, `estimateLocalTorsoLengths` in `bodyScale.ts`); BSR and every
other consumer keep the clip-wide torso. Motivation: a runner approaching a handheld camera grows
several-fold on screen, the p95−p5 range is set by the near-field frames, and the mid-clip torso
inflated SER past the 0.40 front bar. Measured before → after (`83cccf7`, `--trials 2`, fresh
process, zero spread): side-landscape SER 1.78749 → 1.78798, side-portrait 1.70594 → 1.69972,
front-approach **0.334267 → 0.293851** (view `front` both, confidence 0.541 → 0.592), multiperson
1.76229 → 1.76076 — on the PRIMARY pass no view and no metric field moved on any public clip
(the scale pass did move: front-approach's grafted `stepWidthCm` confidence 0.448 → 0.358, excluded
both ways). Private front-approach
fixture IMG_9116 **0.593543 → 0.261516, `ambiguous` → `front`**; IMG_9114 0.601 → 0.422 and IMG_9115
0.678 → 0.471 move most of the way but stay `ambiguous` — and their plausibility still shifts
toward front (0.50 → 0.94, 0.31 → 0.82), so gating moves on clips whose label does not:
`stepWidth` excluded → normal on both, `armSwingAmplitude` excluded → caveated on IMG_9114. (IMG_9115
is a rear view; the spec's `'front'` means front-or-back, so that is in scope.) ⚠️ The background MediaPipe scale pass on
front-approach moves the other way, **0.6759 → 0.7212** (`ambiguous` both), most likely because
MediaPipe's clip-opening ankle outliers sit where the runner is smallest and the rescale amplifies
them. Full table: that change's `design.md` "Measurement".

**Ground truth, measured by hand from keyframes** (grid overlay, ~13 frames): per-ankle excursion
**0.16–0.20 torso**, every offset medial; **0.20–0.35** all-in. **MoveNet's 0.3284 is in band;
MediaPipe's 1.5911 is physically impossible** — it demands ~477 px of ankle-to-hip travel against a
~290 px shoulder span. Camera confirmed square within ~4–5°, handheld but nearly static.

**Four hypotheses REFUTED — do not re-derive:**
- **Out-of-frame extrapolation.** Zero normalized coords outside [0,1] across all 87 detected frames.
  The feet never leave frame either — **630 px of clear ground** below the shoe at the largest frame.
  The mechanism is real upstream (MediaPipe emits unbounded normalized coords, never clamps) but is
  **not active here**, so an adapter bounds check is a **no-op on this clip**.
- **Left/right swap.** The two backends genuinely disagree on which leg is screen-left (84/87 vs
  0/96), but SER is per-label against *that label's own hip*, so a consistent relabel cancels exactly.
- **Swing-leg occlusion.** The swing foot IS hidden on ~8 of 11 stride frames — but those frames
  (t ≈ 1.00–1.67 s) read normally (−22 to −126 px). The outliers are at t < 0.45 s. Right mechanism,
  wrong part of the clip.
- **Denominator difference.** `torsoLengthPx` ratio mp/mn = 1.058–1.075× on both clips.

**Demo 1 is genuinely clean, not masked** — 619.1 px vs 627.5 px, 1.3% apart.

⚠️ **Fixing the interpolation alone is NECESSARY BUT NOT SUFFICIENT.** At SER 0.650 MediaPipe casts
**no SER vote at all** (front needs ≤ 0.4, side ≥ 0.8), so the label stays `ambiguous` — by
abstention instead of by conflict — and `stepWidthCm` stays tier-3 excluded. Any remedy meant to make
that metric render must address the raw detection error too.

⚠️ **The 1.79× `stepWidth` gap is still NOT explained.** SER is an outlier-amplifying p95−p5 range;
`stepWidth` is an outlier-suppressing median at footstrikes, and cross-backend **median** ankle
distance is only **~20 px** — so the clip-opening outliers should not move a median. `strides-wac`
must not ship until that is understood. Filed as `strides-87x`, which now also blocks `strides-wac`.

Full tables, per-hypothesis verdicts and the retraction:
`openspec/changes/archive/2026-08-31-diagnose-mediapipe-front-view-ankles/design.md`.

### The 1.79× `stepWidth` gap — EXPLAINED, and the puzzle was the premise (2026-08-31, `strides-87x`)

`strides-boc` left this open, noting a median ought to shrug off a concentrated outlier cluster. It
does not, **because n = 5**.

One probe inside `computeStepWidth`, both passes in one run (primary line first, scale pass second),
Demo 2, cold page load, real GPU:

| | primary (MoveNet) | scale pass (MediaPipe) |
|---|---|---|
| `value` | **0.225311** | **0.404238** |
| `hipWidthPx` | 91.383 | 88.463 → **ratio 0.968** |
| candidates / usable | 5 / 5 | 5 / 5 |
| `interpolatedFraction` | 0.000 | **0.000** |

**The two passes sample DIFFERENT INSTANTS — a different set, not an offset.** The scale pass misses
the primary's first strike (t = 0.10010) entirely and gains one the primary never sees
(t = **1.66833, the clip's final sampled frame**); the four in between sit 0.010–0.020 s apart. Since
`strides-cjl`, `detectFootstrikes` derives touchdown from the fitted hip-bounce phase, so two passes
fitting different curves get different instants by construction — and they do differ, 3.02 Hz
(primary cadence 181.2 spm) vs 3.12 Hz (scale pass), ~0.17 of a cycle accumulated over 1.67 s.

**Both of the scale pass's outliers sit on contaminated frames**: t = 0.41708 (+0.84934) at the edge
of the clip-opening window above, and t = 1.66833 (+1.38051) on the final frame, with no following
frame to confirm it.

⚠️ **A median over five is not outlier-robust, and that is the whole answer.** At n = 5 the median IS
the third-largest value, so two high outliers promote the third-smallest into the middle slot:

```
scale pass ratios sorted: [-0.00793, 0.16306, 0.40424, 0.84934, 1.38051]
median of all five               = 0.40424   <- the reported value
median of the three non-outliers = 0.16306      ratio 2.48x
```

Strip the two and the same data reads **below** the primary's 0.22531 rather than 1.79× above it.
**This is not a MediaPipe problem** — the primary also has `usableStrikeCount` 5 here and reports
confidence **1.0**, so a MoveNet-only run is one bad strike from the same failure with nothing
flagging it. Filed as `strides-h6r` (small-n median) and `strides-aah` (boundary strikes).

**REFUTED: the denominator.** `hipWidthPx` ratio 0.968 — the scale pass's is 3% *smaller*, which
moves `stepWidth` 3% *up*, not 79%. And `interpolatedFraction` is 0.000 on both sides, so unlike the
SER defect **interpolation is not involved in this gap at all**. The two defects are separate.

⚠️ **JUDGEMENT FOR `strides-wac`: `stepWidthCm` on Demo 2 is NOT trustworthy.** `strides-fn4`'s
caution was right but its reason was wrong — it withheld the fix because "MediaPipe's ankles are
bad", and the ankles are mostly fine (cross-backend median ankle distance ~20 px). The real problem
is **which instants get sampled, and how few of them there are**. `strides-wac` must not simply
inherit the primary's view and render 4.53 cm; it is now blocked on `strides-h6r` as well.

Full tables: `openspec/changes/archive/2026-08-31-explain-the-step-width-pass-gap/design.md`.

⚠️ **`armSwingSymmetry` IS GONE FROM THE APP** (`strides-zhv`, 2026-09-05) — withdrawn on the
user's decision ("it is never accurate"): it resolved on exactly one clip of three, caveated, off a
`sampleSize` of 2. **`MetricId` is twelve, and every `armSwingSymmetry` row, column and reading
below is RETIRED FOOTAGE — a record of what was measured, never a target to re-measure or a
regression to check against.** The measurements are left exactly as taken rather than retrofitted,
because they were honestly measured; but nothing in the app emits that metric now, and a harness
looking for its rows will find none. What SURVIVES is the shared `src/heuristics/armSwing.ts` — the
per-side spectral fit, the scale stabilization, the gate constants and the `armSwingCycle` exemplar
builder — all of it still exercised by **`armSwingAmplitude`**, which keeps its own two per-side
images. So read `armSwingSymmetry` below as *the shared arm-swing machinery, seen through a
withdrawn consumer*: statements about the FIT, the crop or the exemplar instants generally still
hold and are now `armSwingAmplitude`'s; statements about the min/max RATIO, its `'percent'` unit or
its card do not. Its coverage rows in the two tables below (`excluded | ✅ 2 | excluded`) are
`armSwingAmplitude`'s today, at the same instants. Beads `strides-9c9` and `strides-56e` were
re-pointed to `armSwingAmplitude`, not closed.

⚠️ **Arm-swing SIZE and search band changed again on 2026-10-27 (`strides-eiil`)** — searched at
cadence/2, reported as per-stride travel, side view reads the near arm. See "Arm swing at stride
rate, per-stride travel, near arm side-on" at the end of this file; amplitudes below are fundamental
p2p over the old 1.2–4 Hz band.

**2. `armSwingSymmetry` is fitted, not scanned** (`strides-gzl`, `2ed7f0b`, archived
`2026-08-29-fit-arm-swing-amplitude`). The prominence-threshold extremum scan was latching onto
sub-cycle wiggles — 9 half-swings per side on Demo 2 across a window holding ~4.8, with spacings
down to 0.050 s against a 0.331 s half-cycle. Replaced by the shared spectral sinusoid fit +
`selectBounceInstants`, so an exemplar pair spans a half-cycle **by construction**, plus a
cross-side frequency-agreement check and a caveat naming a fit disparity. The 54.9% asymmetry was
REAL but overstated: both arms fit the stride rhythm within one grid step, but the weaker-looking
right arm fits at R² 0.497 against the left's 0.778. **Demo 2 moved 0.5464 → 0.6066 and its
confidence 0.980 → 0.385 — normal tier to caveated.** Re-measured on `c79d307`: value
`0.606563233508127`, confidence `0.38457189580244544`, exemplar pairs spanning 0.35035 s (left) and
0.33367 s (right). Anywhere this file shows `armSwingSymmetry` at high confidence on Demo 2, that
number is pre-`2ed7f0b`.

**3. Footstrikes are timed from the fitted hip-bounce phase** (`strides-cjl`, `478d271`/`7564e9d`/
`1b6720c`, archived `2026-08-31-derive-footstrike-timing-from-bounce-phase`). Touchdown = the
fitted hip-bounce low point minus `T/4`; the ankle-difference detector is retained VERBATIM as the
fallback when the hip fit is poor. This moves every consumer of `detectFootstrikes` —
`overstriding`, `footStrikePattern`, `stepWidth`, `stepWidthCm` and transitively `verticalRatio` —
on every clip. Demo 1, before → after: `overstriding` 0.29735 @ 1.000 → **0.325743 @ 0.875**,
`footStrikePattern` −0.0251745 @ 1.000 → **+0.00108462 @ 0.875** (midfoot both ways),
`verticalRatio` 0.0353716 @ 0.2397 → **0.0310419 @ 0.4795**. All three reproduce exactly on
`c79d307`. `cadence` does not consume this detector and did not move. A **+0.11 s systematic**
residual remains, shipped uncorrected on principle — fitting an offset is the thing this change
exists to stop — and is filed as `strides-24s`.

⚠️ **`strides-24s` is now CLOSED on its own criterion (spike, all three correction strategies
measured and rejected), and its successor `strides-pr1` shipped FALLBACK, not a fix** (2026-09-01,
`resolve-the-overstriding-sampling-instant`). A fourth strategy — re-sample `overstriding`'s own
signal at its interior forward-reach extremum within a bounded backward window, rather than
correcting the detected instant's timing — was built, measured, and its accuracy/direction/
stability gates all PASSED convincingly (one eligible Demo 1 strike's extremum landed on the EXACT
same frame an independently-derived ground truth anchored to). It was not shipped anyway: a
pre-registered materiality gate failed — across a three-clip probed corpus (Demo 1, Demo 2,
multiperson, primary pass + background scale pass) the search could resolve an interior extremum on
only **9 of 26 (34.6%)** otherwise-usable strikes, because `estimateTravelDirection` returns `0` on
Demo 2's primary pass and the background scale pass's own hip-bounce fit falls below
`cadenceMinFitR2` on both Demo 2 and multiperson (Demo 2's scale pass resolves a direction, `−1` —
it is the period rule that disables it) — both preconditions the search structurally requires, and
both absent on a majority of this corpus. What shipped instead: `overstriding.caveat` is now
unconditionally non-null on any non-null-value result (mirrors `footStrikePattern`'s
`PROXY_CAVEAT` pattern), disclosing the sampling-instant lag — naming its LOWER-BOUND direction
only where travel direction is known; a direction-agnostic wording ships for the
unknown-direction branch, where raw `dx` gives the bias no derivable sign — quoting no magnitude
in either wording. **No
computed value moved anywhere** — verified via a before/after `scripts/ab-person-selection.mjs`
A/B, bit-identical on every clip including every `evidence.*` field (the driver's own comparison
table excludes `caveat`, so this diff being empty is the correct confirmation that nothing else
changed, not evidence the caveat failed to land — that was checked separately, by unit test). Full
gate table and measurement:
`openspec/changes/resolve-the-overstriding-sampling-instant/design.md` (not yet archived as of
this writing — pending review).

⚠️ **Demo 1's footstrike ground truth was itself wrong, and the corrected set is the one to use**
(addendum 2026-08-31, `strides-dly`). `strides-da8` recorded the contact onsets as ffmpeg
`3.90 / 4.60 / 5.16 / 5.84` (app `3.98 / 4.68 / 5.24 / 5.92`) and both its own design and
`strides-cjl`'s acceptance criterion were stated against them. Keyframes pulled from the source at
0.04 s intervals with a grid overlay, judged on shoe-versus-shadow, put them **1.5 to 4 frames
later**:

| contact | `strides-da8` (ffmpeg) | keyframe-confirmed (ffmpeg) | error |
|---|---|---|---|
| 1 (left) | 3.90 | **4.00** | 2.5 frames early |
| 2 (left) | 4.60 | **4.66** | 1.5 frames early |
| 3 (right) | 5.16 | **5.32** | 4 frames early |
| 4 (right) | 5.84 | **5.98** | 3.5 frames early |

**Corrected app-domain onsets: `4.08 / 4.74 / 5.40 / 6.06`** (ffmpeg + this clip's own 0.08 s
edit-list shift, unchanged). The original set is spaced 0.70 / 0.56 / 0.68 s; the corrected set is a
uniform **0.66 s**, agreeing with the clip's own fitted step period of 0.658 s to 0.3% — that
regularity is itself the evidence. Independently corroborated by the app's own `ankle.x` going
stationary (325 px/s against the hip's 1617 px/s) from app ≈ 4.84. The old numbers are NOT rewritten
where they were honestly recorded; `2026-08-29-detect-footstrike-contact-onsets/design.md` carries a
correction note beside them, and the full derivation is that change's own
`design.md` **D11.1**.


## Arm swing at stride rate, per-stride travel, near arm side-on (2026-10-27, `strides-eiil.1`–`.3`)

Change `measure-arm-swing-travel-at-stride-rate` (openspec, not yet archived). RCA on
`strides-eiil`: the user reported `armSwingAmplitude` reads lowballed. **Vertical-only is NOT the
cause** (front clip's horizontal fit 0.089/0.094 T is smaller than its vertical one). Three
measurement defects were, each fixed in its own commit:

1. **`.1` search band** — the per-side fit searched the shared hip-bounce band (1.2–4 Hz, the STEP
   band). Now `[0.8, 1.2] × strideHz`, step `0.02 × strideHz`, `strideHz = analyzeHipBounce` freq / 2
   gated on `cadenceMinFitR2` (sub-floor pass included, so retimed clips get a clip-time anchor). No
   anchor → null ("No steady running rhythm…"), no fallback. This is NOT the rejected fixed 0.6–2.0 Hz
   "halved band" (that pinned side clips to its 0.60 floor; an anchored band cannot offer 0.6 Hz).
2. **`.2` value** — published size was the fitted fundamental's p2p. Now per-stride travel: joint
   trend removed (`fitTrendAtFrequency`), 3-point median, median over complete `1/f*` windows of
   max−min. Gate unchanged (fundamental R²). Known bias: the median reads a sampled sinusoid up to
   `1 − cos(2πf/fs)` low (4.9% at 20 samples/cycle); jitter biases a range up.
3. **`.3` side view** — near arm = strictly more directly-detected frames (`resolved − interpolated`),
   scale-stabilized by per-frame torso length (shoulder span collapses side-on), gated/scored alone,
   tie → both-arms. `viewFit.side = tolerated ×0.6` (was unsuitable ×0.1). Front/ambiguous unchanged
   rules (both arms, shoulder-span proxy).

**Live record** — real GPU (ANGLE Metal), fresh process, `--trials 1 --evidence --scale-pass`, each
checkout on its own derived port (base = a detached worktree of main `10b3f54c`; B/C/D = this
branch's phase commits `26639f05` / `d33b285a` / `c6211650`). Primary pass only:

| clip (view) | base `10b3f54c` | after `.1` | after `.2` | after `.3` (final) |
|---|---|---|---|---|
| front-approach (front) | **0.23355** @ 0.4127 primary | 0.23326 @ 0.4126 | **0.33101** @ 0.4126 | 0.33101 @ 0.4126 primary |
| side-landscape (side) | null, unsuitable | null | null | **0.51251** @ 0.4605 tolerated |
| side-portrait (side, ~7× slow-mo) | null, unsuitable | null | null | **0.42595** @ 0.1424 tolerated, n=1 |
| multiperson (side) | null, unsuitable | null | null | **0.54641** @ 0.3671 tolerated |
| fused 3-clip demo | 0.234 (front) | — | — | **51.3%, Medium**, "Clip 1 of 3 · Side view" (side-landscape) |

Final caveats: front — side-fit disparity (L R² .776 / R .512); side-landscape and multiperson —
near-arm-only + "wasn't perfectly steady"; side-portrait — near-arm-only + "Only 1 complete
arm-swing cycle(s)" + steady. (The primary `[analysis-diagnostics]` line carries no arm caveat; the
final ones come from a temporary probe, reverted.)

**Gate: every non-arm field bit-identical** at every phase vs base, on all four clips (canonicalised,
`elapsedMs` and every `armSwingAmplitude` key dropped; md5 + `rtk proxy diff`):
side-landscape `c2e2aeef…`, side-portrait `5ecc4299…`, front-approach `0259053b…`, multiperson
`46b16c55…` (413/399/381/414 fields). No aggregate evidence-coverage field moved. Cadence =
120 × strideHz where it reports (181.2 = 120 × 1.51; 174 = 120 × 1.45 on side-landscape and
multiperson); side-portrait cadence is withheld (sub-floor) while its arm anchor is 0.39/2 = 0.195 Hz.

**Per-side probe on the final code** (fit Hz / R² / cycles / fundamental T / travel T / travel÷fund):

| clip | arm (proxy) | detected | fit | R² | cyc | fund | travel | ratio |
|---|---|---|---|---|---|---|---|---|
| front-approach | L (shoulder) | 95/98 | 1.510 | .776 | 2.44 | .307 | .379 | 1.23 |
| front-approach | R (shoulder) | 98/99 | 1.510 | .512 | 2.47 | .159 | .283 | 1.78 |
| side-landscape | **L near** (torso) | 97/103 | 1.363 | .707 | 2.32 | .399 | **.513** | 1.28 |
| side-landscape | R far (torso) | 83/101 | 1.595 | .148 | 2.66 | .104 | .274 | 2.64 |
| side-portrait | **R near** (torso) | 270/280 | **0.156** | .459 | 1.52 | .256 | **.426** | 1.67 |
| side-portrait | L far (torso) | 230/272 | 0.183 | .210 | 1.74 | .127 | .373 | 2.92 |
| multiperson | **L near** (torso) | 86/100 | 1.508 | .652 | 2.49 | .445 | **.546** | 1.23 |
| multiperson | R far (torso) | 69/103 | 1.537 | .217 | 2.61 | .086 | .183 | 2.14 |

On side-landscape the shoulder-span proxy would have read the near arm at 0.705 T (fund .529) —
the inflation the torso proxy exists to stop.

**Keyframes** (ffmpeg crops, 1:1 px): side-landscape runner faces LEFT → camera sees the left side →
near = left ✓; near wrist ~40 px below the shoulder at 1.85 s vs ~115 px at 2.15 s on a ~190 px
torso (≈0.4 T between two non-extreme instants), consistent with 0.51. side-portrait runner faces
RIGHT → near = right (watch arm) ✓; at the exemplar's instants the near wrist sits ~75 px below the
shoulder (2.667 s, back) and ~45 px (5.867 s, forward) on a ~100 px torso → **≈0.30 T visible
vertical travel against 0.426 reported**. The swing is real and visible, R² .459 is not marginal,
but treat side-portrait's number as soft: its fit sits ON the band floor (0.156 = 0.8 × 0.195 —
with ~1.5 cycles in a 9.8 s window the frequency resolution, ~0.1 Hz, is wider than the whole band,
so the edge is not a rhythm claim), and with one complete window the travel is a single max−min
with no cross-window median, so per-frame tracking excursions land in it undiluted. Its confidence
(0.142) already says so.

**Open, not fixed here:** side-landscape's near-arm exemplar is planned by the metric but the
evidence planner returns `no-evidence: undrawable` (pair 2.583 → 2.950 s; cause NOT verified —
the pair-crop growth gate is the suspect, since the runner travels across the frame between the two
instants, and `EVIDENCE_MAX_PAIR_CROP_GROWTH` is a do-not-raise), so the demo's winning arm card
has no picture. Presentation (`strides-eiil.4`) next.
