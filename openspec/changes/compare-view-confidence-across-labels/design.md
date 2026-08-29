# Design — compare view confidence across labels

The number is worthless without the derivation, so the derivation is the artifact. Everything
below is anatomy first, then a check against footage — never a number chosen because a clip then
looked good. This repo has twice recorded and rejected "tune the constant until the clip passes"
(`derive-area-floor-from-4k-measurement` is the canonical case); the discipline that change used —
pre-registered criteria, adjudicated afterwards — is used here too, and D6 shows the result does
not hinge on the digit.

## D1 — What `confidence` is, and the one property it lacked

`computeCommittedConfidence` is `clamp01(((bsrMargin + serMargin) / 2) * sampleCoverage)`, where
each margin answers: *how far past the threshold my committed view required does this signal sit?*
Expressed as a fraction, a margin needs two endpoints — a zero point (the threshold) and a one
point. Before this change the one point was implicit and came in two flavours:

| view | signal | zero point | one point | reachable? |
|---|---|---|---|---|
| side | BSR | `sideViewMaxBilateralSpreadRatio` 0.30 | 0 | yes — exact projection limit |
| side | SER | `sideViewMinSagittalExcursionRatio` 0.80 | `2 x` = 1.60 | yes — measured 1.57–1.79 here |
| front | SER | `frontViewMaxSagittalExcursionRatio` 0.40 | 0 | yes — exact projection limit |
| front | BSR | `frontViewMinBilateralSpreadRatio` 0.55 | `2 x` = **1.10** | **no** |

Three of the four ramp toward something the signal can attain, so their margins span the full
`[0, 1]` and mean the same thing. The fourth ramps toward a value roughly twice the anatomical
maximum of its own signal, so its margin is compressed into the bottom fifth of the range and can
never be compared with the others. That, and only that, is the defect.

`2 * threshold` was never a derivation. It is an artifact of writing the away-from-zero direction
as `(value - threshold) / threshold`, and it happens to land on a defensible value for side SER
(D3) — which is exactly why it survived review.

## D2 — Anatomy of BSR

```
BSR = (shoulderSpread + hipSpread) / (2 * torsoLengthPx)
```

over pose-model keypoints. Two facts about those keypoints drive everything:

- the shoulder points sit near the acromion, so `shoulderSpread` at a dead-on front view is
  biacromial breadth — **0.33–0.41 m** for adults;
- the hip points sit at the hip **JOINT CENTRES**, not the greater trochanters and emphatically not
  external hip breadth, so `hipSpread` is bi-femoral-head separation — **0.16–0.22 m**. Reading
  this as hip *breadth* (~0.28–0.35 m) is the single easiest way to talk yourself back into a high
  threshold.

The denominator is twice the shoulder-mid-to-hip-mid torso length, **0.47–0.52 m**, and that figure
is not borrowed: this repo measures it directly through MediaPipe world landmarks —
`torsoMeters` **0.5041** on Demo 1 and **~0.47** on Demo 2.

A dead-on front view therefore produces:

```
narrow   (0.33 + 0.16) / (2 * 0.52) = 0.4712
central  (0.37 + 0.18) / (2 * 0.49) = 0.5612
broad    (0.41 + 0.22) / (2 * 0.47) = 0.6702
```

**BSR cannot exceed ~0.67 on a human.** The old saturation point of 1.10 is 1.6x the broadest
plausible reading and 2.0x the central one.

### The yaw model, and why it is not a fit

Let `phi` be the camera's yaw away from dead-on front (`phi = 0` front, `90` side). The
mediolateral body axis projects onto the image x-axis with `cos phi`, the anteroposterior axis with
`sin phi`, so

```
BSR(phi) = BSR_deadOnFront * cos phi
SER(phi) = SER_fullStride  * sin phi
```

This model is *derived* from projection, then **checked** against the three clips. It was not
fitted, and it has no free parameter that was chosen to make the check pass — `BSR_deadOnFront`
comes from the anthropometry above and `SER_fullStride` from D3.

| clip | phi implied by BSR | phi implied by SER | agreement |
|---|---|---|---|
| Demo 2 (front) | `acos(0.5507 / 0.5612)` = **11.0°** | `asin(0.3389 / 1.60)` = **12.2°** | 1.2° |
| Demo 1 (side) | `acos(0.1335 / 0.5612)` = **76.2°** | `asin(1.5744 / 1.60)` = **79.7°** | 3.5° |
| multiperson (side) | `acos(0.1482 / 0.5612)` = **74.7°** | `asin(1.7918 / 1.60)` → clamps at 90° | consistent |

Two independent signals, on two independent clips, agree on the camera angle to within a few
degrees using anatomical constants derived without reference to either. Demo 2 also inverts to
`BSR_deadOnFront = 0.5507 / cos(12.2°) = 0.5634`, within 0.4% of the central estimate 0.5612. Demo 1
cannot constrain that quantity — near `phi = 90°` a 3° error swings `1 / cos phi` enormously — which
is itself worth stating so nobody reads its 0.747 inversion as a contradiction.

## D3 — SER's full-stride value, and why the side direction does not move

`SER_fullStride` is the ankle's fore-aft range relative to its own hip, in torso lengths, at a
dead-on side view. An ankle sweeps roughly **0.8 m** fore-aft relative to the hip over a running
stride; over a **0.49 m** torso that is **1.63**. The shipped `2 * 0.80 = 1.60` sits inside a
percent or two of that, and this repo's own side-view footage brackets it:

| clip | measured SER | vs 1.60 |
|---|---|---|
| Demo 1 | 1.5744 – 1.5965 | just short — margin 0.968–0.996, not clamped |
| multiperson | 1.7337 – 1.7918 | past it — margin clamps at 1.0 |

So the side SER full-support point is **reachable on real footage, measured twice**, and the number
does not change. It moves from an implicit `2 x` to an explicit
`sideViewFullSagittalExcursionRatio: 1.6` purely so the next reader sees a derivation rather than a
coincidence. Both side-view margins are therefore bit-identical before and after, which is what
makes "the side controls do not move" a proof rather than an observation.

## D4 — Why the threshold had to move too (it is not optional)

Pre-registered before choosing any number:

- **P1** A margin's full-support point must be a value the signal takes at the ideal camera
  position for that view. No multiples of thresholds.
- **P2** A threshold must sit strictly below its own full-support point, with enough span that a
  dead-on view of a plausible build reads a real margin rather than clinging to zero — otherwise
  the defect is shrunk, not fixed.
- **P3** The threshold must be clearable by a dead-on front view of the narrowest plausible build,
  or that build is structurally unclassifiable.
- **P4** The threshold must stay strictly above `sideViewMaxBilateralSpreadRatio`, so an undecided
  band survives between the two labels.
- **P5** Among values satisfying P1–P4, prefer the largest, so the classification change is as
  small as possible.

P1 fixes the front BSR full-support point at the **central dead-on value, 0.56**. Taking the broad
bound 0.67 instead would mean a typical runner filmed perfectly can never saturate — the same
defect, smaller; taking the narrow bound 0.4712 would have half of all builds clamping at 1 well
off dead-on.

P2 then **forces the threshold to move**, and this is the step worth being explicit about, because
"just fix the saturation point" is the obvious minimal change and it does not work:

> With the full-support point at 0.56 and the threshold left at 0.55, the ramp is **0.01 wide**.
> Demo 2's BSR of 0.5507 reads a margin of 0.0058 and its confidence stays 0.079 — unchanged. Any
> full-support point above 0.55 that a human can reach leaves a ramp under 0.12 wide, and the
> threshold sits at the very bottom of it. **A threshold at 0.55 is not merely mispaired with a bad
> saturation point; it is itself past the signal's central value.** For a central build it means
> "within 11° of dead-on", and for a narrow build it means "never".

That is the same conclusion `strides-2iw` reaches from the classification side and declines to
decide. The measurement decides it.

### Choosing 0.45

P3 bounds it: `b < 0.4712`. Within that, the forced construction is **make the two front
thresholds encode the same geometric claim**, since the whole point of the two-vote rule is that
two signals independently test one proposition:

```
front SER bar 0.40, with SER_fullStride 1.60   ->  sin phi <= 0.25  ->  phi <= 14.48°
BSR of the NARROWEST build at that yaw          ->  0.4712 * cos(14.48°) = 0.4562
```

Evaluating at the narrowest build rather than the central one is what P3 requires — at the central
build the same construction returns 0.543, which is the status quo and reproduces the bug. Rounding
**down** to two decimals keeps the rounding in the admitting direction: **`b = 0.45`**. P5 is
satisfied because 0.45 is the largest two-decimal value under 0.4562.

Sanity: the narrowest build filmed square-on then reads a BSR margin of
`(0.4712 - 0.45) / (0.56 - 0.45) = 0.19` — small, honestly so (their bilateral signal genuinely is
weaker), but non-zero and paired with a near-1 SER margin. A central build saturates. A broad build
clamps.

## D5 — What moving the threshold does to gating

The threshold is read in three places: the front vote, `computeViewPlausibility`'s BSR ramp (whose
endpoints are the two views' thresholds), and now the front BSR margin.

**The front label's angular envelope barely widens, because SER binds first.** A front label needs
BOTH signals. SER `<= 0.40` already restricts to `phi <= 14.48°` for a running subject, regardless
of BSR:

| build | old front envelope (BSR 0.55 binding) | new (SER 0.40 binding) |
|---|---|---|
| narrow | **never** — bar unreachable | `phi <= 14.5°` |
| central | `phi <= 11.2°` | `phi <= 14.5°` |
| broad | `phi <= 14.5°` (SER already bound) | `phi <= 14.5°` unchanged |

So the front label becomes **SER-governed and build-independent** instead of build-dependent, and
the widest any build gains is 3.3°. The narrow-build row is the fix.

**The exception, stated rather than glossed:** for a subject with little fore-aft excursion —
walking, standing, a very short clip — SER is small at every yaw and BSR is the only guard. There
the front envelope does widen, from `phi <= 11.2°` to `phi <= 36.6°` for a central build. Accepted:
the metrics that ride on a front label (`armSwingSymmetry`, `stepWidth`, `stepWidthCm`) are all
frontal-plane measurements that degrade smoothly with `cos phi` rather than becoming nonsense, the
plausibility ramp keeps the discount continuous across the band rather than cliff-edged, and the
alternative is to keep excluding an entire body type outright.

**On this repo's three clips the gating change is nil, provably.** `signalSupport(BSR, 0.30, bar)`
saturates at 1 for any BSR `<= 0.30` and at 0 for any BSR `>= bar`. Demo 1 reads 0.1335 and
multiperson 0.1482 (both `<= 0.30`, support 1 either side of the change); Demo 2 reads 0.5507
(`>=` both the old 0.55 and the new 0.45, support 0 either side). All three stay one-hot, so
`resolveViewFitTable` returns the caller's table by reference exactly as before and every metric is
computed against the identical view and config object. Verified live — see D7.

## D6 — Sensitivity: the result does not hinge on the digit

The `derive-area-floor-from-4k-measurement` failure mode was a candidate whose behaviour collapsed
at half and double the chosen value. This one has a plateau. Holding the full-support point at 0.56
and sweeping the threshold, against Demo 2's measured signals:

| threshold | BSR margin | `confidence` | narrow build's dead-on BSR margin |
|---|---|---|---|
| 0.35 | 0.9558 | 0.554 | 0.58 |
| 0.40 | 0.9421 | 0.547 | 0.44 |
| **0.45** | **0.9158** | **0.534** | **0.19** |
| 0.50 | 0.8449 | 0.499 | fails P3 margin — 0.05 |
| 0.55 (old) | 0.0058 | 0.079 | fails P3 — unreachable |

`confidence` is flat within 4% across 0.35–0.45, and the side clips are untouched at every rung.
The cliff is entirely at the old value. So the fix rests on the *existence* of a reachable
saturation point, not on the second decimal of the threshold — which is the opposite of the area
floor's situation, and the reason this one is shippable where that one was not.

## D7 — Live measurement

Headless Chromium, `--headless=new --enable-gpu --ignore-gpu-blocklist`, renderer asserted
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)` — never SwiftShader. 3 trials per clip per arm,
`[analysis-diagnostics]` matched exclusively on its own prefix. Body-scale coverage 1 on every run.

| clip | label | BSR | SER | `confidence` before | after |
|---|---|---|---|---|---|
| Demo 1 (side) | side | 0.1335–0.1343 | 1.5744–1.5965 | 0.7615 [0.7615..0.7739] | **0.7615 [0.7615..0.7739]** |
| Demo 2 (front) | front | 0.5507 (all trials) | 0.3389 | 0.0771 [0.07710..0.07711] | **0.5343 [0.53432..0.53432]** |
| multiperson (side) | side | 0.1482–0.1721 | 1.7337–1.7918 | 0.7531 [0.7132..0.7531] | 0.7531 [0.7132..0.7531] |

Side is identical to every digit reported. Front rises 6.9x, to the same order as the side clips.
On Demo 1 and Demo 2 every metric's `value`, `confidence` and `viewFit` is bit-identical across all
three trials on both arms.

**Multiperson needs one extra step to read honestly, and it is not a change in behaviour.** That
clip is not run-to-run deterministic (a property this repo already documents), and it lands in
exactly TWO sampling modes, distinguishable by BSR: 0.172078 and 0.148155. A naive trial-set
comparison shows differences purely because the baseline drew mode A once and the post-fix run drew
it once out of seven. Grouping the trials by mode instead — 7 further post-fix trials were run to
populate both — every metric is identical WITHIN each mode, and so is `view.confidence`:

| mode | trials before / after | `view.confidence` before | after | every metric identical |
|---|---|---|---|---|
| BSR 0.172078 | 1 / 1 | 0.713203373084129 | 0.713203373084129 | yes |
| BSR 0.148155 | 2 / 6 | 0.7530746155181296 | 0.7530746155181296 | yes |

### Regression anchor

Demo 1, 2 trials post-fix, read off `[analysis-diagnostics:scale-pass]`:

```
verticalOscillationCm  4.421467928439415 cm      (anchor: 4.421467928439415)
fit.frequencyHz        1.52  ->  x60 = 91.2      == cadence.value 91.2, both passes
fit.sinusoidR2         0.42451916621964814
torsoMeters            0.504143645953322
subjectAgreement       agreed, 52 / 53
```

Every digit matches the recorded anchor.

## D8 — Residual, deliberately not fixed here

The front SER margin ramps `0.40 -> 0` over `phi <= 14.5°`, while the side SER margin ramps
`0.80 -> 1.60` over `phi >= 30°` — a 14.5° span against a 60° one. Both endpoints are reachable, so
both margins are now *scaled* correctly, but the front label's confidence decays about 4x faster
per degree of yaw than the side label's. Demo 2 shows it: at ~11–12° off dead-on its BSR margin is
0.92 and its SER margin 0.15, and the SER term is what holds `confidence` to 0.53.

This is defensible as it stands — the front label's admissible envelope genuinely IS tighter in yaw
(D5), so a front clip 12° off is closer to its own boundary than a side clip 12° off is to its —
and both labels now reach 1 at their ideal, which is the property `strides-2iw` asks for. Widening
it would mean raising `frontViewMaxSagittalExcursionRatio`, which really would widen the front
label's angular envelope, on a signal this change has no measurement mandate to move. Filed as a
follow-up rather than folded in.

## D9 — Blast radius of `confidence` itself

Established by grep over `src/` before touching anything, on the commit that carries
`propagate-view-confidence-to-metric-gating` (`a2a0143`): `view.confidence` is read in exactly two
places.

- `src/results/fuseHeuristics.ts:65` — `pickBestWithIndex(results.map((r) => r.view))` chooses which
  clip's `ViewDetectionResult` becomes a multi-clip session's reported view. This is the one live
  behaviour, and repairing it is an acceptance criterion of `strides-2iw`.
- `src/results/analysisDiagnostics.ts:151` — carried verbatim onto the dev-only console line.

Nothing else. In particular metric confidence, `metricTier`, `HIGH_CONFIDENCE_THRESHOLD`,
`MetricsPanel`'s "High confidence" label and evidence planning all read METRIC confidence, which
since `a2a0143` derives from `view.plausibility` and never from this scalar. The fused `view` object
is not read by any consumer downstream of fusion. So a change to `confidence` cannot move a card or
an evidence exemplar except through the plausibility ramp, which D5 shows is a no-op on all three
clips and D7 confirms live.
