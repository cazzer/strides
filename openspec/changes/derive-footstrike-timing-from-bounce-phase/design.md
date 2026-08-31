# Design — derive footstrike timing from the fitted hip-bounce phase

## Context

`detect-footstrike-contact-onsets` (bead `strides-da8`) fixed footstrike COUNT and RHYTHM and
stopped, on purpose, at a phase residual it had proved unfixable on the signal it reads. This change
replaces the signal that decides *when*, keeps the signal that decides *which foot*, and keeps the
old detector as the fallback. Read D15 of that change's design first; this document does not repeat
its measurements, only its conclusions.

---

## D1. The proven negative — evidence of record, do not re-derive

`d_S = y_S − y_opposite` is maximal when the two ankles are furthest apart vertically. With side S
planted, S contributes a constant — a foot on the ground does not move — so the maximum is decided
entirely by the other ankle, and it lands at the **contralateral foot's swing apex**. A real gait
event; not touchdown; and not a fixed distance from touchdown.

Measured by sweeping the unit fixture's swing-apex phase and reading the emitted lag back out. The
two track one for one:

| fixture `apex` | contralateral apex after touchdown | emitted lag |
|---|---|---|
| 0.55 | 1.5 frames | **1** |
| 0.60 | 3.0 | **3** |
| 0.65 | 4.5 | **5** |
| 0.69 | 5.7 | **6** ← Demo 1's measured +0.24 s at 25 fps |
| 0.75 | 7.5 | **11** |

The range spans 0.04–0.44 s — **wider than a whole stance phase** (Demo 1's own stances are 0.36 s
and 0.44 s). A constant fitted to one runner is wrong for any runner who swings differently. This is
a reason there is no constant, not a reason to pick a better one.

Every constant-free alternative on the same signal marks a different wrong event, all enumerated and
rejected in da8 D15.2:

| selector on `d` | what it actually marks | verdict |
|---|---|---|
| `argmax d` (what ships today) | contralateral swing apex | late by 0.05–0.19 stride, runner-dependent |
| `argmax d'` | fastest inter-leg separation, mid-descent | early by the foot's deceleration time, also runner-dependent |
| zero crossing of `d` | the two ankles level, i.e. the legs crossing | midstance — further from touchdown than what ships |
| band walk-back from the peak | — | needs a band constant |
| foot speed → 0 (ZUPT) | touchdown, correctly | needs a speed threshold, and the plateau is only ~2.5× either side — the same factor-of-two shape `derive-area-floor-from-4k-measurement` already rejected |

**Do not attempt to rescue the ankle-difference signal for phase.** It is retained here, unmodified,
for the two jobs it is good at: naming the foot, and standing in when the hip fit is unusable.

---

## D2. The signal that can carry phase

Vertical acceleration of the body's centre of mass is **−g during flight** and **net upward during
stance**. The sign flips exactly at touchdown and again at toe-off, so the **inflection points of
the vertical trajectory are the contact events**. That is a statement about the physics of contact,
not about any particular runner's mechanics, which is why it carries no constant.

For a fitted sinusoid the inflections are the zero crossings of the oscillating component — a
quarter cycle either side of each extremum. `analyzeHipBounce` fits raw image-y, which grows
downward, so the fitted **maximum is the body's LOWEST point**, and:

```
touchdown_k = tLowest_k − T/4
toeOff_k    = tLowest_k + T/4          T = 1 / fit.frequencyHz
tLowest_k   = tMeanSeconds + (π/2 − φ)/ω + k·T        ω = 2π·fit.frequencyHz
```

The hip-mid y-trace bounces **once per step** (`cadence.ts`'s module doc establishes this; it is why
cadence reports `frequencyHz × 60` with no harmonic correction), so this emits **one touchdown per
step** — the correct rate, by construction rather than by selection.

`spectralFit` already reports `phaseRadians` and `tMeanSeconds`, and an existing requirement — *"The
spectral sinusoid fit exposes its phase and time origin"* — already governs deriving instants from
them, including the rule that a derived instant must be snapped to a real sampled frame and dropped
when none lies within tolerance. **No shared spectral primitive is modified by this change.**

### Sides still come from the ankles — but as one decision, not N

At a predicted touchdown the planted foot is the LOWER of the two in image-y. That is the same fact
da8 already relies on as an admissibility check — *"a foot cannot be planted while the other foot is
below it"*.

**Reading it per instant was tried first and measured failing** (D11.2 records the numbers). A
stride is two steps, one per foot, so consecutive touchdowns alternate; the instants are one step
apart by construction and each carries its bounce-cycle index, which keeps alternating across a
dropped instant. So the whole question is one bit — does an even cycle mean left — and it is decided
by summing the ankle difference over every instant, signed by cycle parity and **weighted by its
magnitude**, since two ankles at the same height carry no information about which is planted.

On Demo 1 the per-instant reading emitted `left, left, right, right`: two unambiguous instants at
351 px and 373 px of separation, and two nearly useless ones at 41 px (a frame inside a nine-frame
interpolation ramp) and 23 px. The resulting same-side pair one STEP apart was correctly rejected by
`strideLength`'s period gate and `verticalRatio` went to `null`. Weighted and summed, the same four
instants decide the parity 660 px against 660 px and come out `right, left, right, left`.

Zero total evidence — no instant resolved both ankles, or an exact tie — falls back rather than
picking a parity. No threshold anywhere.

### The frequency band is not the one `strides-9c9` is about

`strides-9c9` records that the shared 1.2–4.0 Hz grid floor excludes per-STRIDE signals below ~144
spm, and that widening the band was measured and rejected. This change reads the **per-STEP** hip
bounce, which is the signal the band was sized for: 1.2 Hz is 72 spm, below any running cadence.
Demo 1 fits at 1.52 Hz — mid-band, seven grid steps clear of the floor. Nothing here depends on
9c9 being fixed, and nothing here should be used to argue for widening the band.

---

## D3. The error budget, in closed form

Let `T` be the step period and `stance` the stance duration. Take the bounce's low point as
midstance (weakness 1 qualifies this; see D6). Then:

```
true touchdown  = midstance − stance/2
model touchdown = midstance − T/4
model lag       = stance/2 − T/4 = (stance − T/2) / 2
```

**The lag is half the amount by which stance exceeds half a step period.** Writing `s = stance/T`
(stance as a fraction of one step, i.e. twice the duty factor):

```
lag = (T/2) · (s − 1/2)
```

Checked against Demo 1's own measured stance durations, `T = 60/91.2 = 0.6579 s`:

| Demo 1 contact | stance | `s` | predicted lag | frames @ 25 fps |
|---|---|---|---|---|
| B | 0.36 s | 0.547 | 0.0155 s | **0.39** |
| C | 0.44 s | 0.669 | 0.0555 s | **1.39** |

which reproduces da8 D15.4's "0.4 and 1.4 frames late" exactly, from the formula rather than from a
table. Against the 4–6 frames the shipped detector is late by, this is a **4–15× reduction**, and it
contains no fitted quantity.

### The two residuals do not merely differ in size; they differ in what varies

| | shipped (ankle difference) | this change (bounce phase) |
|---|---|---|
| lag set by | swing-apex phase | duty factor |
| formula | `(apex − 0.5) · 2T` | `(s − 0.5) · T/2` |
| plausible input range | apex 0.55…0.75 | `s` 0.5…0.7 (duty 0.25–0.35) |
| resulting lag range | **0.10 T … 0.50 T** | **0 … 0.10 T** |
| at Demo 1's `T = 0.658 s` | 0.066 s … 0.329 s (1.6…8.2 frames) | 0 … 0.066 s (0…1.6 frames) |

**The new detector's worst case is the old detector's best case**, and the ranges touch at exactly
one point. Stretching the duty range to the whole of running (duty 0.20–0.40, `s` 0.4–0.8) widens
the new residual only to `−0.05 T … +0.15 T` — still inside the old one's band.

---

## D4. No new constant, and no shared primitive modified

- **The quarter period is geometry, not a coefficient.** It is the distance from a sinusoid's
  extremum to its inflection, which is `T/4` for every sinusoid. `selectBounceInstants` already uses
  `T/2` from the same identity.
- **The quality bar is `cadenceMinFitR2` (0.30), reused.** `detectFootstrikes` already reads exactly
  this key, at exactly this value, to decide whether the clip has a trustworthy rhythm for its
  spacing floor (`resolveStepFrequencyHz`). Adding a second, independently movable gate on the same
  fit would let the module disagree with itself about whether this clip has a measurable rhythm.
- **The snap tolerance is half the median frame interval**, the same derivation `bounceInstants.ts`
  states and for the same reason: beyond it, a continuous instant is closer to some other frame than
  to the one returned.
- `footstrikeMinProminenceRatio` (0.05), `footstrikeMinIntervalSeconds` (0.25) and
  `STRIDE_PERIOD_TOLERANCE` (0.15) are **unmoved**, and remain in force on the fallback path.
  `stridePeriod.ts` is not edited.
- `spectralFit.ts`, `hipBounce.ts` and `bounceInstants.ts` are **read only**. `cadence` and
  `verticalOscillation` are correct today and nothing they read changes.

---

## D5. The fallback, and what it buys

The ankle-difference detector — contact series, prominence scan, amplitude selection, rhythm-derived
spacing floor, the never-the-higher-foot check — is retained **verbatim** and runs when either:

1. the hip-bounce fit fails, or lands below `cadenceMinFitR2`; or
2. the phase path resolves **no** attributable instant (every predicted touchdown fell in a gap, or
   no frame near it could resolve both ankles).

Rule 2 is stated as "any instant at all" rather than as a count threshold so that it introduces no
number. Its effect is the load-bearing property of this whole change:

> **A clip that reports footstrike-derived metrics today cannot stop reporting them because of this
> change.** The worst case is *no improvement*, never a new failure.

That is the answer to weakness 3 and most of weakness 4, and it is why the coupling this change
introduces is additive rather than substitutive.

---

## D6. The four known weaknesses da8 named

### W1 — the bounce minimum is not exactly midstance. **Remains, and it is the DOMINANT term on real footage.**

In running the CoM low point falls *after* the geometric midstance, because the stance leg keeps
compressing past the vertical-shank instant. Predicted here as a small late bias; **measured on
Demo 1 it is the largest term in the residual.** The closed form in D3 predicts 0.4–1.4 frames from
that clip's stance durations; the measured lag against keyframe-confirmed onsets is a systematic
**+0.11 s ≈ 2.75 frames** (D11.2), and the fitted low points verifiably land on the raw hip trace's
own local maxima, so the gap is the runner's hip signal and not the estimator.

This is a real downgrade against what D3 promised, and it is stated rather than absorbed. Two things
keep it from being fatal: it does **not** vary with swing mechanics — which is precisely what made
the shipped detector's error unbounded — and it is *systematic within a clip*, so it survives as a
bias every instant shares rather than as scatter. The measured within-clip spread is 0.02 s against
the ankle path's 0.34 s (D11.2), which is the property the consuming metrics actually depend on.

**Not corrected by a constant**, for the same reason the ankle path's error was not: the right value
is a function of the runner's own duty factor and of how far their hip low point trails their
midstance, and this pipeline measures neither. A follow-up should measure the duty factor, not fit
an offset.

### W2 — a single sinusoid forces stance = flight. **Quantified, and now executable.**

This is not a separate worry; it *is* `(stance − T/2)/2`, the whole of D3's budget. A pure sinusoid
has its inflections a quarter period from its extremum, which is the same as asserting stance = half
a step. Real running has stance longer than that, so the model is systematically **late**, by half
the excess.

It is pinned in the unit suite by a **stance sweep**: varying the fixture's stance fraction moves the
emitted lag along the closed form, while varying the swing apex does not move it at all. That is the
exact inverse of the shipped detector's signature, and it is the acceptance evidence (D10).

### W3 — timing becomes a pure function of the hip fit, thinnest on the front-approach clip. **Mitigated by the fallback, and the exposure is smaller than it looks.**

Below `cadenceMinFitR2` the fallback runs and the clip gets today's numbers (D5). Above it, cadence
itself is willing to publish a number off the same fit, so the bar is not a new judgement call.

The exposure is also narrower than "Demo 2 is thin" suggests: `overstriding`, `footStrikePattern`
and `verticalRatio` are hard-gated to side view and are already tier-3 excluded on Demo 2, so on the
clip where the hip fit is weakest, three of the six affected metrics are not on screen. The two that
*are* Demo 2's own metrics — `stepWidth` and `stepWidthCm` — are the ones the live round must watch.

### W4 — it inverts the architecture. **Accepted, enumerated, and not without precedent.**

`overstriding` and `footStrikePattern` do now read geometry at hip-derived instants. Three things
bound it:

- **The dependency is enumerated, not implicit** — D7 lists every consumer and what each does when
  the fit is poor or absent.
- **The fallback makes it additive** (D5): no metric acquires a new way to fail.
- **A footstrike-consuming metric already reads the hip fit.** `strideLength` takes `stepFrequencyHz`
  and gates every candidate pair on `2/f`; `verticalRatio` supplies it from the same
  `analyzeHipBounce` call. `detectFootstrikes` itself already calls `analyzeHipBounce` for its
  spacing floor. This change deepens an existing coupling; it does not create one.

The honest cost: a clip with a *mediocre-but-passing* fit (R² just over 0.30) now gets
mediocre-but-passing **timing** as well as a mediocre spacing floor, where before it got timing that
was independent of the fit — independently derived, and independently scattered across a third of a
second. That is the trade, stated plainly.

**Verified, not assumed:** across three clips and both arms, no metric went from a value to `null`,
and no metric changed tier (D11.3).

### W5 — a fifth weakness, found while building, in the SIDE assignment. **Fixed, and the fix is in D2.**

Not one of da8's four. The obvious way to name the striking foot at a phase-derived instant is to
read which ankle is lower there — and on side-view footage, where the two ankles cross and occlude
every step and the detector sometimes swaps their labels outright, that is one coin flip on the
noisiest quantity in the clip. It emitted two consecutive same-side instants one STEP apart on
Demo 1 and took `verticalRatio` to `null`. The alternation-plus-weighted-vote rule in D2 is the fix;
`verticalRatio` returns at **twice** its previous confidence.

---

## D7. A fifth weakness, found while building: the shared fixture's bounce phase is inverted

`generateSyntheticGait` builds

```
hipMidY   = HIP_BASE_Y + (A/2)·sin(2π·2f·t)         // image-y, downward positive
ankleY(L) = groundY − (LIFT·(1 − sin(2π·f·t)))/2    // contact defined as the maximum
```

Contact is at `sin(2πft) = 1`, i.e. `2πft = π/2`, where `sin(4πft) = sin(π) = 0` and falling — so at
the fixture's own touchdown the hip is at its baseline and **rising**, its LOWEST point sits a
quarter-step **before** contact, and its HIGHEST point a quarter-step **after**. Measured on the
standard 170 spm / 30 fps fixture: fitted low points at 0.0926 / 0.4447 / 0.7969 s against left
contacts at 0.1667 / 0.8667 s and right contacts at 0.5196 s — the low point leads contact by
0.074 s, 0.21 of the 0.352 s step.

The body is at its apex at touchdown and at its floor mid-flight. That is not a runner.

**No metric could observe this before.** `verticalOscillation` reads amplitude, `cadence` reads
frequency, `trunkLean`/`viewDetection` read geometry that a uniform y-shift leaves alone, and the
footstrike consumers read the ankles only. This change is the first thing in the repo to read the
two signals' *relative* phase, and it fails loudly on a fixture that gets it backwards — which is
the fixture doing its job.

**Corrected by a half-period shift** of the hip/shoulder/head bounce term. A phase shift changes no
amplitude, no frequency, and therefore none of the hand-computed expectations built on them. After
the shift the fixture's low point sits 0.29 of a step after contact — a stance of 0.58 step, i.e. a
**duty factor of 0.29**, squarely inside the running range — and D3's formula predicts a residual of
`(0.204 − 0.176)/2 = 0.014 s`, 0.42 frames at 30 fps.

The `footstrikes.test.ts`-local `buildGait` fixture is *not* affected: it pins the planted foot to
the ground and places the body's low point at `STANCE_END/2`, which is midstance by construction. It
was already phase-correct, and it is the instrument the acceptance sweep uses. Having two
independently-built fixtures with **different duty factors** (0.35 and 0.29) that both land on the
closed form is worth more than one that lands on it exactly.

---

## D8. Blast radius — every consumer of `detectFootstrikes`

Found by search (`grep -rn detectFootstrikes src/`), not assumed. Five direct consumers, one
transitive:

| consumer | what it reads at a strike | when the hip fit is poor or absent |
|---|---|---|
| `overstriding.ts` | `ankle.x − hipMid.x`, median over strikes | falls back → **today's instants, today's value** |
| `footStrikePattern.ts` | `ankle.x − knee.x`, median over strikes | falls back → today's instants, today's class |
| `stepWidth.ts` | signed lateral offset from the hip midline, per strike | falls back → today's value |
| `stepWidthCm.ts` | the same offset, scaled by measured px/m | falls back → today's value |
| `strideLength.ts` | same-side consecutive interval + hip-x displacement, gated on `2/f` | falls back for the instants; its period gate **already** degrades to no gate when `stepFrequencyHz` is absent, unchanged |
| `verticalRatio.ts` (transitive) | `strideLength`'s output as its denominator | inherits `strideLength`'s behaviour exactly |

`cadence` does **not** consume footstrikes — it abandoned that path precisely because of the defect
da8 was fixing — so cadence is untouched here, and it is the cross-check that the fit this change
reads is the fit cadence publishes.

None of the six needs an API change: `FootstrikeCandidate` keeps its shape, and each consumer reads
geometry at `candidate.frameIndex`. Only *which* frame that is moves.

---

## D9. Predictions, registered before measuring

1. **Synthetic, the acceptance evidence.** Across the same swing-apex sweep that moves the shipped
   detector's lag from 1 to 11 frames, the new detector's lag is **constant**. Across a *stance*
   sweep it moves along `(stance − T/2)/2` and the shipped detector's does not.
2. **`generateSyntheticGait`, after the phase correction.** Emitted instants land within one sampled
   frame of the fixture's own contact definition (predicted residual 0.42 frames at 30 fps).
3. **Demo 1 instants** land within 1–2 sampled frames of the measured onsets (app
   3.98 / 4.68 / 5.24 / 5.92 s), against 4–6 frames today.
4. **Instant count rises on Demo 1**, from 4 toward one per step across the analysed span, because
   the phase path emits per bounce cycle rather than selecting a subset by amplitude.
5. **da8's falsifiable prediction, tested.** *"If instants really sit 0.16–0.24 s into stance at the
   clip's ~3.7 torso-lengths/second, a phase-correct `overstriding` on Demo 1 should read of order
   0.5–0.9 HIGHER than the current 0.172. If the phase is fixed and the value does not move that
   far, one of the premises is wrong — most likely that the ankle keypoint is stationary through
   stance."* Registered by da8 D15.3; adjudicated in D11.
6. **`overstriding`'s and `footStrikePattern`'s Demo 1 spread collapses** from 73% / 78%, if and only
   if the dispersion really was the phase residual (da8 D15.3). Under the fresh-process regime the
   comparison is between-invocation reproducibility, not a within-invocation range — see the
   determinism note in CLAUDE.md.
7. **Cadence and the vertical-oscillation family do not move at all.** They read the same fit but
   only its frequency and amplitude, neither of which this change touches. Regression anchor: Demo 1
   `verticalOscillationCm` = `4.421467928439415`, `fit.frequencyHz × 60` = 91.2 = `cadence.value`.
8. **Demo 2's `stepWidth` / `stepWidthCm` are the risk.** Either the fit clears 0.30 and they move,
   or it does not and they are bit-identical. Both outcomes are informative; a *third* outcome —
   they stop reporting — would falsify D5 and is the stop-and-report condition.

### How they came out

| # | prediction | outcome |
|---|---|---|
| 1 | lag constant across the apex sweep, tracking `(stance − T/2)/2` across the stance sweep | **HELD.** Apex spread 10 frames → **0**; stance sweep within one frame of the formula, monotone (D10). |
| 2 | within one frame on the corrected `generateSyntheticGait` | **HELD.** ≤0.8 of a frame on every instant. |
| 3 | Demo 1 instants within 1–2 frames of the recorded onsets | **NOT AS STATED.** 4–5.5 frames against those onsets — but the onsets themselves are 1.5–4 frames early (D11.1). Against keyframe-corrected onsets: **2.5–3 frames**, systematic. |
| 4 | instant count rises on Demo 1 | **DID NOT.** 4 → 4. The analysed span holds ~3.4 steps, and the old path's amplitude selection was already emitting one per step on this clip. |
| 5 | `overstriding` on Demo 1 rises by 0.5–0.9 | **FALSIFIED.** +0.158. Adjudicated in D12.1. |
| 6 | dispersion collapses | **HELD.** 73.0% → 1.15% (D11.4). |
| 7 | cadence and the VO family do not move | **HELD**, bit-identical, anchor exact (D11.5). |
| 8 | Demo 2 `stepWidth` moves or is identical, never null | **MOVED**, 0.1406 → 0.2253 at confidence 1.000. The stop-and-report outcome did not occur on any clip. |

---

## D10. Synthetic acceptance evidence — the same sweep, both paths

`footstrikes.test.ts`, both detectors run on identical fixtures. The fallback is reachable directly
(`detectFootstrikesBetweenAnkles`) precisely so this comparison can exist: on a clip with a fittable
bounce the phase path always wins, so the old path is otherwise unreachable from the fixtures that
matter.

### The swing-apex sweep — the headline

Five clips identical except for the phase at which the swinging foot reaches its apex. Lag is in
sampled frames behind the fixture's own true touchdown (25 fps, 30 frames per stride):

| fixture `apex` | ankle-difference lag | hip-phase lag |
|---|---|---|
| 0.55 | **1** | 1, 1, 2, 2 |
| 0.60 | **3** | 1, 1, 2, 2 |
| 0.65 | **5** | 1, 1, 2, 2 |
| 0.69 | **6** | 1, 1, 2, 2 |
| 0.75 | **11** | 1, 1, 2, 2 |
| **spread across the sweep** | **10 frames** | **0 frames** |

The ankle path's lag is one value per clip, repeated on every stride, tracking the apex one for one.
The hip path's is byte-identical on all five. The 1→2 drift *within* each row is the frequency grid
(1.66 Hz fitted against the fixture's true 1.6667 Hz step rate, accumulating ~0.4 frames over four
strides) plus integer frame snapping; it is present in every row equally and is not a function of
the apex.

### The stance sweep — the new path's own residual, and it follows the formula

Five clips identical except for stance duration. Predicted from D3's closed form alone, with a step
being half a stride: `lag = ((stanceEnd − 0.25) / 2) × 30` frames.

| `stanceEnd` (stride fraction) | duty factor | predicted lag | measured hip-phase lag | measured ankle lag |
|---|---|---|---|---|
| 0.25 | 0.25 | **0.00** | 0, 0, 0 | 0/1 |
| 0.28 | 0.28 | **0.45** | 0, 0, 0, 1 | 0/1 |
| 0.30 | 0.30 | **0.75** | 1, 1, 1, 1 | 0/1 |
| 0.32 | 0.32 | **1.05** | 1, 1, 1, 1 | 0/1 |
| 0.35 | 0.35 | **1.50** | 1, 1, 2, 2 | 0/1 |

Every emitted instant is within one frame of its own prediction, the median is monotone in stance,
and the ankle path is *blind* to the sweep — its median lag does not move at all, because its error
is set by the swing apex, which this sweep holds fixed. **Each path's residual is a function of a
different thing, and only one of those things is bounded.**

### Swing-shape invariance

Three fixtures differing only in swing-hang length and toe-off lift — the three that make the
ankle-difference signal hard — produce byte-identical hip-phase instants and non-identical ankle
instants. The new timing reads nothing about the swinging foot.

### `generateSyntheticGait` after the phase correction

Left contacts at frames 5.0 / 26.2 / 47.4 / 68.5 / 89.7 / 110.9 (170 spm, 30 fps); emitted
5 / 27 / 48 / 69 / 90 / 111 — every one **within 0.8 of a frame**, against D9's prediction of 0.42.
Eleven instants over 4 s at 2.83 steps/s: one per step. Prediction 2 **holds**.

---

## D11. Live measurement

Headless Chromium, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`, never SwiftShader),
`scripts/ab-person-selection.mjs`, dev server started and identity-verified by the run. Both arms
are the same tree with `src/heuristics/footstrikes.ts` swapped, so the comparison is the detector
and nothing else.

### D11.1 Demo 1's ground truth is itself wrong, and had to be re-measured

**This is the finding that reframes everything below, so it comes first.** `strides-da8` recorded
Demo 1's contact onsets as ffmpeg `3.90 / 4.60 / 5.16 / 5.84` (app `3.98 / 4.68 / 5.24 / 5.92`), and
bead `strides-cjl`'s acceptance criterion is stated against those numbers. Re-measured this session
by pulling keyframes from the source clip at 0.04 s intervals with a 50 px grid overlay
(`ffmpeg -ss … -frames:v 1 -vf crop,drawgrid`) and looking at shoe-versus-shadow directly:

| contact | da8 (ffmpeg) | keyframe-confirmed (ffmpeg) | error |
|---|---|---|---|
| 1 (left) | 3.90 | **4.00** | 2.5 frames early |
| 2 (left) | 4.60 | **4.66** (airborne at 4.64, down at 4.68) | 1.5 frames early |
| 3 (right) | 5.16 | **5.32** (airborne at 5.24, near-touch 5.32, flat 5.36) | 4 frames early |
| 4 (right) | 5.84 | **5.98** | 3.5 frames early |

da8's onsets are spaced 0.70 / 0.56 / 0.68 s; the corrected ones are spaced a uniform **0.66 s**,
which agrees with the clip's own fitted step period of 0.658 s to 0.3%. That regularity is itself
evidence the corrected set is right and the original was not. A second, independent check agrees:
the app's own `ankle.x` goes stationary (325 px/s against the hip's 1617 px/s) from app ≈ 4.84, i.e.
a touchdown at app ≈ 4.74–4.80, not 4.68.

**Corrected app-domain onsets: `4.08 / 4.74 / 5.40 / 6.06`** (ffmpeg + 0.08, the clip's own edit-list
shift, unchanged from da8's conversion).

### D11.2 Phase, measured on one run, both detectors, against the corrected onsets

Probe: one temporary `[footstrike-probe]` console line in `runClipAnalysisPipeline.ts` dumping the
emitted instants, the fit, and the raw hip/ankle series. Added, measured, reverted.

| | instants (app s) | lags vs corrected onsets | **spread** | mean |
|---|---|---|---|---|
| ankle difference | R 3.92, L 4.92, R 5.48, L 6.08 | −0.16, +0.18, +0.08, +0.02 | **0.340 s** | +0.030 |
| **hip-bounce phase** | R 4.20, L 4.84, R 5.52, L 6.16 | **+0.12, +0.10, +0.12, +0.10** | **0.020 s** | +0.110 |

**The scatter falls 17×, and what is left is a systematic per-clip offset.** That is the whole
character of the change: a bias every instant shares is a property of the runner's own duty factor
and reads consistently; a per-instant scatter is not a bias at all and is what the dispersion in
D11.4 was made of.

The fitted phase is faithful, not merely plausible: the fitted low points (4.361 / 5.019 / 5.677 s)
land on real local maxima of this run's raw hip-y trace (4.36 / 5.00 / 5.64–5.72), so the +0.11 s is
a property of the runner's hip signal, not of the estimator.

**The +0.11 s is NOT corrected.** It is larger than D3's closed form predicts from Demo 1's stance
durations, which means W1 — the bounce low point trailing midstance — is materially larger on real
footage than on the fixtures. Fitting it away would be exactly the mistake the ankle path's phase
error was a proof against: the right value is a function of the runner's duty factor and of how far
their hip's low point trails their own midstance, and this pipeline measures neither.

### D11.3 Metric values, fresh process, 3 trials, all three clips

Every field except `elapsedMs` was identical across all three trials on both arms, on all three
clips — the fresh-process regime, as CLAUDE.md's rewritten determinism note describes. Only fields
that moved are listed; everything omitted is **bit-identical**, including `cadence` (91.2 / 181.2 /
174), `verticalOscillation`, `verticalOscillationCm`, `trunkLean`, `kneeFlexion`,
`armSwingSymmetry`, every `personSelection` field and every `view` field.

| clip | metric | before | after | tier |
|---|---|---|---|---|
| demo1 | `overstriding` | 0.29735 @ 1.000 | **0.325743 @ 0.875** | shown, both |
| demo1 | `footStrikePattern` | −0.0251745 @ 1.000 | **0.00108462 @ 0.875** | shown, both |
| demo1 | `verticalRatio` | 0.0353716 @ 0.239737 | **0.0310419 @ 0.479473** | shown, both |
| demo1 | `stepWidth` | −1.27967 @ 0.100 | 4.25696 @ 0.0875 | tier 3 (side view), not shown |
| demo2 | `stepWidth` | 0.140625 @ **1.000** | **0.225311 @ 1.000** | shown, both |
| demo2 | `overstriding` | 0.0241441 @ 0.05 | −0.0305607 @ 0.05 | tier 3 (front view), not shown |
| demo2 | `footStrikePattern` | −0.0652233 @ 0.05 | −0.01797 @ 0.05 | tier 3, not shown |
| multiperson | `overstriding` | 0.211673 @ 1.000 | **0.499656 @ 0.800** | shown, both |
| multiperson | `footStrikePattern` | −0.218509 @ 1.000 | **0.111699 @ 0.800** | shown, both |
| multiperson | `verticalRatio` | 0.0333904 @ 0.0195662 | 0.0348052 @ 0.0195662 | tier 3, not shown |
| multiperson | `stepWidth` | −2.12114 @ 0.100 | −4.25475 @ 0.080 | tier 3, not shown |

No metric changed tier on any clip. No metric went from a value to `null` anywhere.

**The confidence drops from 1.000 are honest, not a regression.** They are the interpolation
penalty: the phase path places instants where the rhythm says a foot landed, and on Demo 1 one of
the four falls inside a nine-frame interpolation ramp (0.875 = 1 − 0.5 × ¼ exactly, at
`interpolationConfidencePenalty` 0.5). The old path chose instants by amplitude, which
preferentially selected well-tracked frames and then reported **1.000 while its dispersion was 73%**
— which is the specific mismatch da8 flagged.

`verticalRatio`'s confidence **doubles** on Demo 1 (0.2397 → 0.4795) because `strideLength` now gets
two period-consistent pairs instead of one: same-side instants are one stride apart by
construction, and `periodRejectedPairCount` goes 1 → 0.

`footStrikePattern`'s Demo 1 value moving from −0.025 to +0.001 is the predicted direction — a
late-stance instant puts the ankle behind the knee, biasing toward "forefoot", and both readings sit
inside the ±0.05 midfoot band so the reported class does not change.

### D11.4 The dispersion, measured in the regime where it exists

`overstriding`'s and `footStrikePattern`'s 73% / 78% Demo 1 spread was recorded under a **reused**
Chromium process, which CLAUDE.md now identifies as a cold/warm split. Re-measured in that same
regime, `--reuse-browser`, 5 trials, both arms:

| field | before | after |
|---|---|---|
| `overstriding` | 0.171844 **[0.171844 .. 0.29735]** — **73.0%** of median | 0.329494 **[0.325743 .. 0.329494]** — **1.15%** |
| `footStrikePattern` | −0.116611 [−0.116611 .. −0.0251745] — absolute spread **0.0914** | 0.00788 [0.00108 .. 0.00788] — absolute spread **0.0068** |
| `verticalRatio` | 0.0353937 [0.0353716 .. 0.0353937] @ conf 0.2423 | 0.0311135 [0.0310419 .. 0.0311135] @ conf **0.4847** |
| `stepWidth` | −0.395639 [−1.27967 .. −0.395639] — **223%** | 5.05266 [4.25696 .. 5.05266] — **15.7%** |

**`overstriding`'s spread collapses 63×; `footStrikePattern`'s absolute spread 13×.** Acceptance
criterion 2 is met.

The cold/warm split itself is *untouched* — `personSelection.detectedSamplesIn` still reads
`65 [65..66]`, `segmentCount` still `3 [3..4]`, `kneeFlexion` still `116.924 [116.924..120.69]`,
identically on both arms. So the change does not remove the harness artifact; it removes these two
metrics' **amplification** of it. One flipped detection used to move `overstriding` by 73% because a
different sampled set moved the swing-apex argmax to a different stride phase. Timed from the
rhythm, the same flipped detection moves it by 1%.

### D11.5 Regression anchor

Read off the `[analysis-diagnostics:scale-pass]` line — **not** the harness report, which captures
only the primary pass and where a MoveNet-primary run has `verticalOscillationCm: null` by design.
On the shipped tree:

```
verticalOscillationCm  4.421467928439415        (CLAUDE.md: 4.421467928439415)
fit.frequencyHz        1.52  → ×60 = 91.2
cadence.value          91.2                     (exact match, the cross-check the anchor tests)
fit.sinusoidR2         0.42451916621964814      (CLAUDE.md: 0.42451916621964814)
fit.sampleCount        57                       (CLAUDE.md: 57)
subjectAgreement       agreed, 52/53            (CLAUDE.md: 52/53)
```

Every digit unchanged. The anchor reads the same fit this change reads, and the fit is untouched.

The same line confirms the confidence arithmetic in D11.3 rather than leaving it inferred:
`overstriding` reports `interpolatedFraction: 0.25` with `sampleSize: 4`, and
`1 − 0.5 × 0.25 = 0.875` is exactly the confidence shown. `verticalRatio` reports `sampleSize: 2`
where it had 1, with the caveat *"Only 2 stride pair(s) detected (recommend at least 3)"*.

---

## D12. Adjudication and decision

### D12.1 The registered falsifiable prediction — **FALSIFIED**, and da8 named the right suspect

> *"If instants really sit 0.16–0.24 s into stance at the clip's ~3.7 torso-lengths/second, a
> phase-correct `overstriding` on Demo 1 should read of order 0.5–0.9 HIGHER than the current 0.172.
> If the phase is fixed and the value does not move that far, one of the premises is wrong — most
> likely that the ankle keypoint is stationary through stance."* — da8 D15.3

Measured, in the same (warm) regime the 0.172 baseline came from: **0.172 → 0.329, i.e. +0.158**,
against a predicted +0.5 to +0.9. **Falsified by a factor of 3 to 6.**

Two premises are wrong, and the larger one is not the one da8 guessed:

1. **"Instants sit 0.16–0.24 s into stance" — wrong, and it was an artifact of the ground truth.**
   Against the keyframe-corrected onsets (D11.1) the old instants' mean lag is **+0.03 s**, not
   +0.20 s; they *scattered* about the truth rather than sitting uniformly late. Correcting the
   phase was therefore never a uniform earlier shift — per instant it was +0.28, −0.08, +0.04,
   +0.08 s — so there was no 0.20 s of stance travel to recover. The whole prediction was computed
   against onsets that read 1.5–4 frames early.
2. **"The ankle keypoint is stationary through stance" — also wrong, and measurably so.** During the
   left foot's stance the app's own `ankle.x` advances at **325 px/s** while the hip advances at
   **1617 px/s** (torso 418 px), so the ankle carries ~20% of the body's speed rather than 0. The
   closing rate of `ankle.x − hipMid.x` is ~3.1 torso/s, not 3.7 — a 20% overestimate on top of the
   6× error from premise 1.

Both directions are worth having on record. The check was worth running precisely because it failed:
a prediction that had merely been *asserted* would have left Demo 1's stated onsets uncorrected.

### D12.2 Acceptance criteria, one by one

| bead `strides-cjl` criterion | verdict |
|---|---|
| instants within 1–2 sampled frames of the measured onsets `3.98/4.68/5.24/5.92`, versus 4–6 today | **NOT MET as stated, and the stated onsets are wrong.** Against those numbers: 4–5.5 frames. Against the keyframe-corrected onsets: **2.5–3 frames**, versus the old path's −4 to +4.5. |
| `overstriding`/`footStrikePattern` run-to-run spread collapses from 73%/78% | **MET.** 73.0% → 1.15%; absolute 0.0914 → 0.0068. |
| no fitted constant introduced | **MET.** `T/4` is a sinusoid's extremum-to-inflection distance; the gate is `cadenceMinFitR2`, already read by this module; the side vote has no threshold. Nothing existing was moved. |
| verified live on all three clips | **MET.** |

### D12.3 What this trades

**Gained:** a residual that is one per-clip number instead of one per instant (0.02 s of scatter
against 0.34 s), same-side instants one stride apart by construction rather than by a gate,
`verticalRatio` at twice its confidence on Demo 1, and a 63× collapse in the dispersion that
`overstriding` publishes at high confidence.

**Paid:** footstrike timing is now a function of the hip fit, bounded by the fallback so that no
clip can lose a metric it has today (D5, verified: nothing went to `null` on any clip); a **+0.11 s
systematic lag on Demo 1** that is left uncorrected on principle; and confidence dropping from a
falsely-perfect 1.000 to 0.875/0.800 where instants land on interpolated frames.

**Decision: ship.** The phase error is not eliminated — it is converted from an unbounded,
runner-dependent scatter into a bounded systematic offset, which is the only form of it that a later
change can measure and correct. The remaining offset needs a per-runner duty factor this pipeline
does not measure; a follow-up should measure that rather than fit a constant.
