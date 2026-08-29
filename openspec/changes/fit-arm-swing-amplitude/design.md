# Design — fit the arm-swing amplitude

All live numbers below were measured in headless Chromium on real GPU
(`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, never SwiftShader), **a fresh Chromium
PROCESS per trial** (`strides-9wp`: reusing one process shifts Demo 2's sampling from trial 2 onward
and moves this metric's own exemplar), 3 trials per clip, on Demo 1, Demo 2 and
`e2e/fixtures/multiperson-track.mp4`. Every value reported here was **bit-identical across all three
trials on all three clips**, before and after, so there is no spread column to report.

## D1 — The defect is real, and the bead's own timestamps are not

The bead (`strides-gzl`) reported Demo 2 exemplar pairs at `1.468133 / 1.368033` (0.100 s) and
`0.617283 / 0.433767` (0.184 s). Under a clean fresh-process regime those timestamps do not
reproduce: the measured pairs are `0.984317 / 0.483817` (**0.5005 s**) and `0.834167 / 1.15115`
(**0.3170 s**), with the left exemplar at a 320 px crop. The bead's figures carry the
one-process-many-trials contamination `strides-9wp` documents, which is why its left pair reads
0.100 s where a clean run reads 0.5005 s.

**The hypothesis survives that correction, and does not depend on those two numbers.** The evidence
is the whole extremum set, not the pair that happened to win selection:

```
Demo 2, cadence 181.2 spm -> stride rate 1.51 Hz -> arm-swing half-cycle 0.331 s
frames 99, torso 232.7 px, prominence floor 0.03 x 232.7 = 6.98 px

left   fit 1.48 Hz  R2 0.778  p2p 72.80 px  2.40 cycles  secondPeak 0.13
       9 half-swings   dt  [0.200 0.234 0.500 0.184 0.050 0.150 0.100 0.100 0.067]
                       amp [ 54.9  72.4  42.8 109.8  11.5  35.1  63.1  35.1  13.5]
right  fit 1.52 Hz  R2 0.497  p2p 44.16 px  2.49 cycles  secondPeak 0.31
       9 half-swings   dt  [0.117 0.133 0.150 0.184 0.167 0.050 0.317 0.167 0.334]
                       amp [ 49.9   7.9  19.7  25.8  65.7   9.5  23.4  16.3 159.7]
```

A 1.62 s window at 1.48 Hz holds ~4.8 half-swings. The scan confirmed **9**. Six of the left arm's
nine span under two-thirds of a half-cycle; the shortest is three frames at 11.5 px, barely over the
6.98 px floor. The largest, 109.8 px, exceeds the fitted 72.80 px peak-to-peak by 51% — a single
"half-swing" larger than the whole swing. **Confirmed: the extremum detection is latching onto
sub-cycle wiggles.**

Both sides independently fit within one grid step of `cadence / 2` (1.48 and 1.52 against 1.51),
which is the cross-check that the *rhythm* is unambiguously there and it is the *scan* that cannot
see it.

## D2 — What the bounce path does differently, and whether that is the fix

`verticalOscillation` used the identical estimator on the identical shape of signal and retired it
in #28 for the identical reasons. Its replacement is `fitSpectralSinusoid` plus
`selectBounceInstants` for the exemplar, and the two properties that matter here are exactly the two
this metric lacked:

1. **The amplitude is a rhythm, not a count.** A least-squares sinusoid over the samples that exist
   cannot be fragmented by a wiggle; a threshold scan can be, and has no way to tell a wiggle from a
   swing once the wiggle clears the threshold.
2. **The exemplar comes from the fitted phase**, so the pair is half a period apart by construction
   rather than by luck.

Yes, that difference is the fix, and it needs no change to either shared primitive — both are used
as-is, read-only. `bounceInstants.ts`'s `maximumIs` parameter is what makes it reusable here without
modification: this metric fits `wrist.y − shoulder.y` in image-y, so it passes `'lowest'`, the same
answer `hipBounce`-backed `verticalOscillation` passes and the opposite of
`verticalOscillationCm`'s.

## D3 — Frequency band: measured, and deliberately NOT changed

One arm swing spans one STRIDE, so its frequency is half the step rate — while
`spectralFitMinFrequencyHz`/`Max` (1.2–4.0 Hz) were sized for the per-step bounce. The obvious move
is a halved "stride band" (0.6–2.0 Hz). It was implemented behind a probe and measured on all three
clips against the shared band:

| clip / side | shared band 1.2–4.0 | halved band 0.6–2.0 |
|---|---|---|
| Demo 2 left | 1.48 Hz, p2p 72.80, R² 0.778, 2ndPeak **0.13** | 1.48 Hz, p2p 72.80, R² 0.778, 2ndPeak **0.25** |
| Demo 2 right | 1.52 Hz, p2p 44.16, R² 0.497, 2ndPeak **0.31** | 1.53 Hz, p2p 44.01, R² 0.497, 2ndPeak **0.69** |
| Demo 1 left | 1.70 Hz, R² 0.385, 3.54 cycles | **0.60 Hz** (grid floor), 1.25 cycles, 2ndPeak 0.73 |
| multiperson right | 2.80 Hz, R² 0.324, 4.76 cycles | **0.60 Hz** (grid floor), 1.02 cycles |

**Rejected.** On Demo 2 — the only clip where this metric is `primary`, and therefore the only clip
whose reading a user ever sees — the two bands agree to within one grid step and 0.3% of amplitude,
while the halved band's `secondPeakRatio` is strictly worse on both arms. On both side-view clips
the halved band lands on its own grid FLOOR at barely one observed cycle, which is a grid-edge
artifact rather than a rhythm, and a worse failure than not finding the rhythm because it looks like
an answer. Changing the band would also have widened blast radius into the config plane cadence and
vertical oscillation share, for no measured gain.

**The residual limitation this leaves, recorded rather than fixed:** a runner below roughly 144 spm
has their true arm-swing frequency below the band floor entirely. Demo 1 (cadence 91.2 spm, so an
expected 0.76 Hz arm swing) is exactly that case, and its fits land at 1.70/1.54 Hz with R² 0.385 /
0.383 — the machinery downstream is what protects the reader there (a wrong-rhythm fit scores a low
R², and a one-sided wrong rhythm is caught outright by D4), not the band. Filed as a follow-up.

## D4 — The cross-side rhythm check, and why a per-side gate cannot replace it

`multiperson-track.mp4` is the proof:

```
left   fit 1.48 Hz  R2 0.676   <- the stride rhythm (cadence 174 spm -> 1.45 Hz)
right  fit 2.80 Hz  R2 0.324   <- the STEP rhythm   (174 spm        -> 2.90 Hz)
published before this change:  0.349 at confidence 0.082
```

Both sides cleared any per-side R² gate this metric could plausibly carry (raising it to reject 0.324
would also reject Demo 2's right arm at 0.497 — the clip that must keep working). The ratio between
them was a comparison of an arm-swing amplitude against a step-bounce amplitude. Only comparing the
two fits **to each other** sees it, and the physical premise is unimpeachable: both arms are attached
to one body.

Bound: `|f_l − f_r| / min(f_l, f_r) > 0.25` rejects. Measured margins — Demo 2 **0.027**, Demo 1
**0.104**, multiperson **0.892**. It is sized to be far wider than a healthy clip's disagreement and
far narrower than a step-versus-stride confusion, which is a factor of two by construction, so the
plateau either side of it is wide.

**Rejection, not a confidence discount.** A ratio between two different oscillations is not a
low-confidence symmetry measurement; it is not a symmetry measurement. This does not create a new
false-negative path for a genuinely one-armed runner: an arm that truly does not swing produces a
trace with no rhythm in it, which fails `degenerate-signal` or the R² gate first and already reports
`null`.

## D5 — The near/far confound, and what confidence now says about it

The bead flags that Demo 2's weaker-looking arm (right) is measured at `t = 0.43–0.62`, when the
runner is furthest from the camera. The measurement bears the concern out, and quantifies it:

```
left  R2 0.778     right R2 0.497     difference 0.281
```

Both arms genuinely swing — both fit the stride rhythm, one grid step apart, and the rhythm check
passes comfortably at 0.027. So **the asymmetry is not an artifact of the detection in the way the
bead's worst case feared**: it is not one side measured from wiggle. But the fitted ratio (0.607)
and the retired extrema-median ratio (0.546) disagree by 11% *on the same frames*, and the arm
carrying the smaller number is also the arm carrying the worse fit. That is precisely a case where
part of the difference may be measurement.

The verdict recorded here is **"real, and partly overstated"** — and the honest way to publish it is
not to adjudicate the split (nothing in the footage can) but to stop presenting it as certain:

- Every confidence input becomes a WORSE-SIDE reading. `frameCoverage` already was;
  `interpolatedFraction` was POOLED across both arms, which is the averaging the acceptance
  criterion objects to, and now takes the max; `sampleSize` becomes the smaller side's observed
  cycle count; and a new `fitQuality` factor ramps the weaker arm's R² from the gate (0.30) to
  saturation (0.80), the same ramp `verticalOscillation` uses.
- A caveat fires when the two arms' R² differ by more than 0.2 — Demo 2's 0.281 clears it — saying
  in the card's own words that one arm was tracked noticeably better than the other and part of the
  difference may be measurement rather than form.

Net on Demo 2: **confidence 0.980 -> 0.385**, moving the card from `normal`/"High confidence" to
`caveated`/"Low confidence". That is the intended correction, not a side effect.

**Explicitly not done:** `EVIDENCE_CROP_MIN_SIDE_PX` (320) was not touched — the crop-floor half of
this confound is `strides-e9b`'s, and `src/results/evidenceFrames.ts` was not opened.

## D6 — Body scale dropped

`estimateBodyScale`'s `torsoLengthPx` had exactly one consumer in this module: sizing the
prominence threshold. The reported value divided each side by it and then took a ratio that cancelled
it again. With the threshold gone the dependency is dead — and it was never merely decorative, since
a clip with no resolvable shoulders/hips returned `null` on a quantity that is scale-free by
construction. Same conclusion, same reasoning, as `verticalOscillationCm` reached when its own
extrema estimator went.

## D7 — Sample floor converted, not re-chosen

`MIN_ARM_SWING_SAMPLE_SIZE = 4` counted half-swings. The fit's natural unit is whole cycles, and
4 half-swings is 2 cycles, so `MIN_ARM_SWING_CYCLES = 2` carries the identical real demand across.
Deliberately NOT set to `verticalOscillationMinCycles`'s 3: that counts BOUNCE cycles at one per
step, twice this metric's rate for the same footage, so copying the number would have silently
doubled the bar as a side effect of an estimator swap. Demo 2 observes 2.40 cycles and therefore
sits at a full sample factor either way.

## D8 — Test strategy: a fixture that reproduces the mechanism

Uniform white jitter does NOT reproduce the failure, and the change is better for having checked:
at ±6 px on a 40 px swing the prominence scan still returns exactly 13 half-swings at a median
0.333 s spacing — the true half-cycle. The real traces are not sinusoid-plus-white-noise.

What does reproduce it is a **step-rate harmonic**, which these traces demonstrably carry (the
shoulder itself rises and falls once per step and does not cancel cleanly out of a
wrist-relative-to-shoulder trace): multiperson's right arm fits the step rate outright, and Demo 2's
right arm reports `secondPeakRatio` 0.31. At `harmonicRatio` 0.4 with ±4 px jitter, the scan's
pairs come out `[0.200 0.267 0.433 0.233 0.433 …]` against a true 0.333 s half-cycle — **every
single one off by 20% or more**, alternately early and late, while the fit recovers 39.71 px against
a true 40 px and the fitted exemplar pair lands within one frame interval of the half-cycle.

The regression test asserts that mechanism against the still-exported `findLocalExtrema`, so it pins
the cause rather than today's numbers.

## Live before/after

| | Demo 2 (front, PRIMARY) | Demo 1 (side, unsuitable) | multiperson (side, unsuitable) |
|---|---|---|---|
| value before | 0.5464 | 0.8208 | 0.3490 |
| value after | **0.6066** | 0.9052 | **null** |
| confidence before | **0.9798** | 0.0678 | 0.0824 |
| confidence after | **0.3846** | 0.0105 | 0 |
| tier before / after | `normal` -> **`caveated`** | `excluded` -> `excluded` | `excluded` -> `excluded` |
| exemplar dt, left | 0.5005 s -> **0.35035 s** | — (tier-3, no evidence) | — |
| exemplar dt, right | 0.3170 s -> **0.33367 s** | — | — |
| half-cycle expectation | 0.331 s (cadence 181.2 spm) | — | — |

Demo 2's exemplar pairs after the change span **106%** and **101%** of the cadence-derived
half-cycle; against each side's OWN fitted period (0.338 s and 0.329 s) they are within 0.013 s and
0.005 s, both under the clip's 0.0167 s frame interval — the snap tolerance, so this is exact.

Evidence coverage on Demo 2 is otherwise unchanged: still 2 images, one per side, `quality` 1.0,
`cropSidePx` 320, `demotedFromPair` false.

Regression anchor, all three trials: Demo 1 `verticalOscillationCm` `4.421467928439415`,
`fit.frequencyHz × 60` = 91.2 = `cadence.value` 91.2, `subjectAgreement` 52/53; Demo 2
`10.486597716761532`.
