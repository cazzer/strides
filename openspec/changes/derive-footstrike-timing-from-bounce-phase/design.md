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

### Sides still come from the ankles

At a predicted touchdown the planted foot is the LOWER of the two in image-y. That is the same fact
da8 already relies on as an admissibility check — *"a foot cannot be planted while the other foot is
below it"* — read here as the side selector instead of as a filter. It has no tolerance parameter.
An instant whose frame cannot resolve both ankles is dropped rather than guessed.

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

### W1 — the bounce minimum is not exactly midstance. **Remains, unmitigated, bounded.**

In running the CoM low point falls slightly *after* the geometric midstance, because the stance leg
keeps compressing past the vertical-shank instant. The effect is a small **late** bias, in the same
direction as W2's, and it is folded into the measured residual rather than modelled. It is bounded
by a fraction of stance and — the property that matters — it does **not** vary with swing mechanics,
which is precisely what made the shipped detector's error unbounded.

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
was independent of the fit — independently derived, and independently wrong by 4–6 frames. That is
the trade, stated plainly.

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

---

## D10. Synthetic acceptance evidence

*(filled in after implementation)*

## D11. Live measurement

*(filled in after implementation)*

## D12. Decision

*(filled in after implementation)*
