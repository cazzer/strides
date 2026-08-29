# Design — detect footstrike contact onsets

## Context

`detectFootstrikes` is the shared basis for `overstriding`, `footStrikePattern`, `stepWidth`,
`stepWidthCm` and (via `estimateStrideLength`) `verticalRatio`. `cadence` abandoned it and says why
in its own module doc. This change fixes the signal it detects on, not any of its consumers.

---

## D1. The measured defect on Demo 1 (evidence of record — do not re-measure)

Demo 1 is the Pexels side-view track clip: 3840×2160, 25 fps, static camera, subject crossing the
frame laterally. Ground contact was read frame by frame off the source, identified as the frame
where the shoe meets its own shadow.

**Ground-truth contact onsets:**

| contact | ffmpeg `t` (s) | app `t` (s) |
|---|---|---|
| A | 3.90 | 3.98 |
| B | 4.60 | 4.68 |
| C | 5.16 | 5.24 |
| D | 5.84 | 5.92 |

App time is `ffmpeg + 0.08` — this clip's documented edit-list offset (CLAUDE.md's evidence-seek
section). Step intervals are 0.70 / 0.56 / 0.68 s (mean 0.647 → 92.8 spm); same-foot strides are
A→C = 1.26 s and B→D = 1.24 s. Three independent corroborations of that rhythm: the app's own
`cadence` reads 91.2 spm off a completely separate spectral fit, the frame count gives 92.7 spm, and
the fitted bounce frequency is 1.52 Hz.

**What the detector emitted**, app `4.00 / 5.04 / 5.60` → ffmpeg `3.92 / 4.96 / 5.52`:

| ffmpeg `t` | what is happening on that frame |
|---|---|
| 3.92 | contact **A**'s onset — a real footstrike |
| 4.96 | contact **B**'s **toe-off** |
| 5.52 | **late stance inside contact C** |

All three carried the same `side` label, yet B and C are different contacts and therefore opposite
feet. Two of three are not contacts, and the 4.60 onset was missed entirely.

**Why a median does not absorb it.** The contamination is directional. `overstriding` measures
`ankle.x − hipMid.x` signed by travel direction; at toe-off and late stance the ankle is *behind*
the hip, so a contaminated instant contributes a strongly negative ratio and pulls the median toward
"not overstriding". `footStrikePattern` measures `ankle.x − knee.x`; at late stance the ankle is
behind the knee, which classifies as **forefoot** — and both Demo 1 and the multiperson clip report
"Forefoot strike (proxy)" today. The recorded Demo 1 `overstriding` distribution is n = 7, median
0.2266, **MAD 0.2403** — a spread as large as the median itself, the shape of a bimodal mixture.

---

## D2. Root cause: the signal, not the scan

The scan (`findLocalExtrema`) is fine. The **series** it is given is the problem.

A single ankle's screen y is a sum of two terms:

```
y_ankle(t) = (whole-body vertical motion)  +  (this leg's own configuration)
```

The first term is shared by every keypoint — it is the ~1.5 Hz bounce `verticalOscillation` and
`cadence` measure, plus any vertical camera motion. For a footstrike detector it is pure
contamination, and it is **not small**: on Demo 1 the bounce is 16.3% of torso length against a
`footstrikeMinProminenceRatio` of 0.05, so the body's own oscillation clears the prominence gate
more than three times over. It produces both observed failures.

**Failure 1 — a maximum where no foot landed.** A leg trailing through early swing is carried
downward by the body's descent into the other foot's stance faster than it is lifting, so its screen
y turns over and back. That is a prominence-confirmed maximum with the foot in the air, and it lands
*during the other foot's stance* because that is when the body is lowest. Named already in
`cadence.ts` ("spurious prominence-confirmed ankle-y extrema (not real ground-contact events)") and
in `strideLength.ts`'s "halving bias" section.

**Failure 2 — a real contact at the wrong instant.** A planted foot does not move. Its screen y is
a flat plateau across stance, so nothing in the series orders touchdown against toe-off, and the
argmax lands wherever ties and noise put it — in practice at the plateau's end, because the scan's
pivot advances on `>=`. This is directly reproduced in the unit suite: on a fixture with a flat
stance plateau the raw series' second-stride maximum lands at frame **39** for a touchdown at frame
**30** — nine frames, 0.36 s, which is very nearly the 0.36 s measured on Demo 1's contacts B and C.

---

## D3. The fix: detect between the two ankles

```
d_S(t) = y_ankle_S(t) − y_ankle_opposite(t)
```

with image-y increasing downward, so `d_S` reads "how far below the other foot this foot currently
is". Maxima of `d_S` are the candidates.

**Why the contamination cancels.** Both feet belong to the same body and are seen by the same
camera, so the whole-body term is identical in both and subtracts out exactly. No filter, no
frequency assumption, no tuning: it is an identity, not an estimate.

**Why the maximum lands on the contact onset.** Differentiate:

```
d_S' = y_S' − y_opposite'
```

- *Approaching touchdown*: this foot is descending fast (`y_S' ≫ 0`) while the other foot is at or
  near its swing apex, where its own vertical velocity passes through zero — the classic
  heel-up-behind pose at initial contact. So `d_S' > 0`.
- *The instant this foot lands*: `y_S'` drops to ~0, because a planted foot does not move, while the
  other foot has begun descending toward its own contact half a stride later, so
  `y_opposite' > 0`. So `d_S' < 0`.

The sign flips **at touchdown**, and `d_S` keeps falling for the rest of stance because the
contralateral foot keeps descending. The toe-off and late-stance instants that the flat absolute
plateau could not order are therefore strictly *below* the onset on this signal, rather than tied
with it. That is what converts failure 2 from "undecidable" to "decided correctly".

The same sign argument disposes of failure 1: while this leg trails and the other is planted, `d_S`
is near its **minimum** (this foot high, the other on the ground) — the opposite extremum from the
one the detector reads.

**Two structural consequences.** `d_left ≡ −d_right`, so the two sides' candidate sets are exact
complements: each side's maxima are the other's minima, and two opposite-side candidates can no
longer be emitted at the same instant off a shared common-mode bump, which raw ankle-y permitted
(and which is how Demo 1's three instants all came to carry one `side` label). And the differenced
signal has roughly twice a single ankle's swing excursion against about √2 times its noise, so the
unchanged prominence gate now sits on a better-conditioned signal — a √2 improvement in
signal-to-noise, not a recalibration.

---

## D4. The one admissibility check, and why it needs no constant

A maximum of `d_S` is rejected when `d_S < 0`: **a foot cannot be planted while the other foot is
below it.** Running has no double-support phase, so at a genuine strike the contralateral foot is
airborne and the margin is most of a swing excursion — on the unit fixture, `d` at a true contact is
+43 px against a ±55 px swing excursion, so the check sits nowhere near a real decision boundary.
It rejects the physically impossible, not the marginal.

It is skipped on the fallback series (below), where the compared value is a screen coordinate and
its sign means nothing.

**This is not a threshold.** There is no number to pick: zero is where "this foot is lower" becomes
"the other foot is lower", and that boundary is fixed by the geometry, not by any clip.

---

## D5. No new constant, and no existing threshold moved

**No constant was introduced by this change.** `footstrikeMinProminenceRatio` (0.05) and
`footstrikeMinIntervalSeconds` (0.25) are read exactly as before, and `STRIDE_PERIOD_TOLERANCE`
(introduced by `gate-stride-pairs-on-fitted-period`) is untouched. There is consequently no error
budget to derive and no insensitivity sweep to run: the change has no free parameter in it. That is
deliberate, and it is the strongest available answer to this repo's two recorded cases of a fix that
only landed by moving a number (the 4K area floor, `derive-area-floor-from-4k-measurement`; and the
tracking-crop revival).

The one thing that *could* have been read as a retune — the prominence gate now applying to a
signal with roughly twice the excursion — is a strict improvement in conditioning rather than a
loosening: the gate's job is to reject jitter, jitter grows as √2 while signal grows as 2, so fewer
noise wiggles clear it relative to real ones than before.

---

## D6. The residual, measured and bounded

The estimator is not exact, and the residual is worth stating precisely rather than hiding.

The contralateral foot reaches its swing apex slightly **after** this foot touches down — its
vertical velocity is not exactly zero at the instant of contact — so `d_S`'s maximum lags touchdown
by that phase offset. Measured on the unit fixture at 25 fps with a 1.2 s stride:

| fixture shape | raw ankle-y series | differenced series |
|---|---|---|
| flat stance plateau, body bouncing | **+9 frames** (0.36 s) | **+1 frame** (0.04 s) |
| mid-swing hang, body bouncing | +5 frames, **plus 3 airborne maxima** | **+1 frame**, no airborne maxima |
| no bounce, no hang (clean) | +5 frames | **+2 frames** (0.08 s) |

The residual is **bounded by the contralateral swing-apex phase offset** — roughly 0.05 of a stride,
about 1.5 frames at Demo 1's 25 fps — and does not grow with clip length, stance duration, or
plateau flatness. That is the qualitative difference from the defect it replaces: the plateau error
is unbounded in the sense that it scales with stance duration (nine frames here, nine frames on Demo
1), whereas this one is fixed by gait phase.

It is also **common to both feet**, so it cancels out of every *interval* measured between two
strikes — which is exactly what `estimateStrideLength` and its period gate consume.

---

## D7. Alternatives considered and rejected

**Subtract the hip instead of the other ankle** (`y_ankle − y_hipMid`). Removes the same common-mode
term, and on a physically faithful fixture its maximum lands *exactly* on touchdown — better than
D6's residual. Rejected on two grounds. First, the discriminant is much weaker: the hip's bounce
excursion is ~16% of torso where the contralateral ankle's swing excursion is ~50%, so the peak is
about 1.6× less sharp and correspondingly more noise-sensitive. Second, it is measurably **not** a
no-op on the existing `syntheticGait` fixture — that fixture builds ankle-y with no body bounce in
it at all while its hip does bounce, so subtracting the hip injects a 2×-stride-frequency component
into a 1×-stride-frequency signal and shifts every detected instant by 27° of stride phase. Measured
on that fixture: the resulting `overstriding` median moves 0.5126 → 0.4673, which breaks that
metric's `toBeCloseTo(80/150, 1)` assertion. Fixing it would mean editing either a shared fixture or
a test file another change owns.

**A contact-onset walk-back** — keep detecting on raw ankle-y, then walk the reported instant back to
the start of the near-maximal plateau. Rejected: on a smooth (non-plateaued) peak there is no
plateau to walk back through, and any band-based walk-back moves the instant a long way. Measured on
the `syntheticGait` fixture, a band of `footstrikeMinProminenceRatio × torso` walks back 45° of
stride phase, which would break every hand-computed footstrike expectation in the suite. It also
fixes only failure 2, leaving failure 1 untouched.

**A zero-velocity (ZUPT) contact detector** — a planted foot is stationary in image space for a
static camera, regardless of camera angle, which is the textbook gait-analysis contact detector.
Rejected here because it needs a speed threshold in torso-lengths per second, and the margin between
early-stance ankle motion (heel-off, ~0.6 torso/s) plus keypoint jitter and swing speed (~4 torso/s)
is only about 2.5× either side of any threshold one could pick — a factor-of-two plateau, which is
exactly the shape this repo has already rejected once, in `derive-area-floor-from-4k-measurement`.
It would also have required a new constant.

**Rejecting maxima by alternation or by interval** — e.g. "a same-side strike cannot follow another
within one step". Rejected as a re-run of the argument `strideLength.ts` already settled: a rule
stated against the candidate set itself is blind when most of the set is wrong, and on Demo 1 most
of it was.

---

## D8. Blast radius, and the one test-fixture idiom that had to change

Measured on every existing fixture before implementing: the differenced signal is **bit-identical**
to the raw one on the `syntheticGait` generator (13 candidates, identical timestamps and sides,
identical `overstriding` median 0.5126) and on `buildStrikeFrames` in both its single-foot and
`alternateFeet` forms. That is not luck: in both fixtures the two feet are exact antiphase mirrors,
so the difference peaks precisely where the individual ankle peaks.

Two test files used the same idiom — "hold the opposite ankle at a constant y so it contributes no
extrema, isolating one side". Under a relative signal a *constant* opposite ankle is not neutral: it
makes that side's series a mirror of the moving side's, and it yields a full set of mirrored
candidates. The idiom is now expressed as an **unresolvable** opposite ankle, which is what actually
means "there is no other leg here" and which routes that side through the documented fallback. This
touched `footstrikes.test.ts` (this change's own) and the `buildHandFrames` helper in
`strideLength.test.ts` (one keypoint removed and a comment; no assertion or expected value changed).

Downstream metric **values** will move on all three clips, on purpose: `overstriding`,
`footStrikePattern`, `stepWidth`, `stepWidthCm` and `verticalRatio` all read a geometry or an
interval at these instants. `cadence` does not consume this detector and must not move.

---

## D9. What this predicts on Demo 1

Stated before live verification, so it can be checked rather than rationalised.

1. **Emitted instants.** Left at ≈ ffmpeg 3.90 and 5.16, right at ≈ 4.60 and 5.84, each late by the
   D6 residual (one to two sampled frames, ~0.04–0.08 s). In app time: ≈ 4.02 / 4.72 / 5.28 / 5.96
   against a ground truth of 3.98 / 4.68 / 5.24 / 5.92. The `side` labels alternate, which the
   current three-instants-one-label output cannot do.
2. **`overstriding` dispersion.** Every surviving instant is now a touchdown, where the ankle is
   ahead of the hip, so the negative toe-off/late-stance population that made the distribution
   bimodal is gone. MAD should fall substantially relative to the median (from 0.2403 against a
   median of 0.2266), and the median itself should rise toward a genuine touchdown reach.
3. **`verticalRatio` should return.** `strides-dy8` currently nulls it on Demo 1 because no same-side
   pair survives the period gate — the detector never produced two consecutive same-foot instants one
   stride apart. With correct onsets, the left pair spans 5.16 − 3.90 = **1.26 s** and the right pair
   1.24 s, against an expected `2 / 1.52 Hz` = **1.316 s**: ratios 0.957 and 0.942, comfortably
   inside `STRIDE_PERIOD_TOLERANCE`'s `[0.870, 1.150]` band. The residual cancels out of the
   interval, since it applies equally to both endpoints. The denominator roughly doubles, so the
   ~6.8% the metric wrongly reported before dy8 should land near **3–3.5%**.
4. **`cadence` must not move.** 91.2 spm, and the `fit.frequencyHz × 60 == cadence.value` identity
   intact.

If (3) does not happen, the most likely reason is that only one of the four onsets falls inside the
person-selection window, leaving no same-side pair at all — which would be a coverage outcome, not
evidence against the mechanism. It should be reported as such rather than argued around.

---

## D10. Live verification round 1 — two predictions falsified, and what they showed

Measured by the coordinator, real GPU, 3 trials, full six-change stack, with a temporary
`[footstrike-probe]` in `detectFootstrikes` (since reverted). Recorded here in full because two of
the four pre-registered predictions in D9 were **wrong**, and the way they were wrong is the
evidence that produced D11.

| prediction | outcome |
|---|---|
| 4 — `cadence` unchanged | **HELD.** 91.2000 spm, confidence bit-identical. |
| 3 — `verticalRatio` returns near 3–3.5% | **HELD.** 0.0353937 (3.54%) in 2 of 3 trials, null in the third. |
| 2 — `overstriding`'s median rises, MAD falls | **FALSIFIED.** 0.214979 → **0.128708**, spread ~5% → ~49%. |
| 1 — emitted instants land on the four true onsets | **FALSIFIED.** 9 instants where 4 were expected. |

Probe output, Demo 1, first distinct result:

```
3.92 R, 4.04 L, 4.44 R, 4.92 L, 5.48 R, 5.60 L, 5.84 R, 6.08 L, 6.20 R
gaps:  0.12  0.40  0.48  0.56  0.12  0.24  0.24  0.12
```

Mean gap 0.285 s → ~210 spm against a cadence of 91.2 spm that an independent spectral fit and a
frame count both confirm. Same-side: left 0.88 / 0.68 / 0.48 s, right 0.52 / 1.04 / 0.36 / 0.36 s,
against an expected stride of 1.316 s. Only 2 of 9 land within two frames of a true onset.

**Perfect side alternation is NOT evidence of anything.** `d_left ≡ −d_right` exactly, so one
side's maxima are the other's minima and the merged list alternates by construction, however wrong
it is. That was read as progress on first inspection; it is a tautology. What the complementarity
genuinely buys is narrower: two opposite-side candidates can no longer be emitted at the *same*
instant off a shared common-mode bump, which is how the pre-change detector came to label all three
of its Demo 1 instants the same side.

---

## D11. Diagnosis — the residual is structural, and no gate can reach it

### D11.1 Where the body's bounce survives the subtraction

D3 claimed the whole-body term "cancels exactly" because both feet share one body. That is true only
while the two feet are in the **same state**, and in running they never are. During single support —
which is the whole of stance — one foot is planted, a fixed world point carrying none of the body's
motion, while the other is airborne and carries all of it:

```
while S is planted:   d_S = y_S − y_opposite = ground − (hip_y + rel_opposite)
```

The body term survives at **full amplitude, inverted**. It puts a dip in `d_S` at S's own midstance
(the body's lowest point) and lets `d_S` recover toward toe-off, so one stance can carry two
confirmed maxima; and by complementarity that midstance dip is itself a confirmed maximum on the
other side. Six candidates per stride where there should be two.

**The measured signature matches that prediction and not the alternatives.** The extra same-side
maxima sit 0.36–0.48 s after a contact, against Demo 1's own frame-counted stance durations of
0.36 s (contact B) and 0.44 s (contact C) — i.e. at toe-off, one stance after touchdown, which is
where this mechanism puts them and nowhere a noise model would predict. Three of the eight merged
gaps are 0.12 s (3 frames), too fast for gait at 91 spm; those are the midstance dips and ordinary
jitter.

### D11.2 The gate rescale is derivable, and provably insufficient

The coordinator's framing was right that a correction *would* be derivable if the gate were merely
mis-scaled: differencing two ankles with independent, identically-distributed keypoint noise
multiplies the noise σ by √2, so holding the false-positive rate fixed means scaling the absolute
prominence by √2 — `0.05 → 0.0707` of torso length, no fitting involved.

**It does not reach.** The artifacts are not noise-sized, they are bounce-sized: the runner's own
vertical oscillation is **16.3% of torso on Demo 1**, against a gate of 5% — 3.3× over — and 0.0707
still leaves them 2.3× clear. A gate that did reach would have to exceed the runner's vertical
oscillation, which is a quantity this app *measures and reports*, spanning 16–25% across its own
three clips. There is no clip-independent constant there, and picking one against Demo 1 would be
the same fitted-threshold move this repo has already recorded and rejected twice.

**So the gate was not touched.** `footstrikeMinProminenceRatio` stays 0.05 and keeps its original
job — deciding whether something is a turning point at all.

### D11.3 Why `overstriding` fell instead of rising

D9 predicted the median would rise once the negative toe-off population was removed. It fell 40%
and its spread grew tenfold. That is consistent with the diagnosis rather than against it, and the
error in the prediction was a specific one worth naming.

The sign argument in D3 is a statement about which candidate is **largest** — approaching touchdown
`d_S' > 0`, after touchdown `d_S' < 0`, so the contact is the global maximum of `d_S` over a stride.
It says nothing about how many *other* maxima clear a local prominence gate. D3 and D5 silently
treated "the contact is the biggest" as "the contact is the only one", which is a confusion between
a global ordering and a local criterion. With ~2.3× over-detection the emitted set became a mixture
of contacts (ankle well ahead of the hip), midstance dips (ankle under the hip, ratio ≈ 0) and
toe-off humps (ankle behind the hip, ratio negative), and the median of that mixture necessarily
sits below the contact value. A falling median with a widening spread is the *expected* reading of
an over-detected set, and it is what was measured.

The sign argument itself survives intact — and D12 promotes it from a uniqueness claim, which it
never supported, to an ordering rule, which is all it ever asserted.

---

## D12. The fix: select by amplitude at the clip's own stride rhythm

Prominence answers "is this a turning point". It cannot answer "is this a ground contact", and no
setting of it can. Amplitude can, by a wide margin: a contact sits at the full inter-leg separation
— most of a swing excursion — while the artifacts are the size of the body's bounce. On the unit
fixture built for this (`ARTIFACT_SHAPE`, deliberately bouncier than any measured clip at 36% of
torso peak-to-peak) the three confirmed maxima inside one stride measure **43.9 / 32.7 / −23.0**:
the contact, the toe-off hump, and one the physical non-negativity check rejects outright.

So `selectFootstrikes` accepts candidates greedily in **descending order of contact-series value**,
each accepted one excluding everything within a minimum spacing, ties breaking toward the earlier
instant. Prominence still decides what enters the pool; amplitude decides what leaves it.

**The spacing is derived, not chosen.** Two contacts of the same foot are one stride apart, and the
clip's own fitted step frequency says how long a stride is: `2 / stepFrequencyHz`, from the
definition of a gait cycle — the identical reference `gate-stride-pairs-on-fitted-period` already
established, with no fitted coefficient in it. The floor is the SHORTEST interval that could still
be one stride, `expected / (1 + STRIDE_PERIOD_TOLERANCE)`.

**No new constant.** `STRIDE_PERIOD_TOLERANCE` is reused, not re-derived, and it is reused for
literally the same statistic it was derived for: the fractional deviation of a real same-side
interval from `2 / f` (that change's design D4, a 3σ RSS envelope over biological stride
variability, footstrike quantization, fit grid resolution and fit estimation error). It moved to a
new `stridePeriod.ts` so both consumers can share one declaration — `strideLength.ts` imports
`footstrikes.ts`, so leaving it where it was would have been an import cycle, and declaring it twice
would have let the two sites drift while describing one quantity. `strideLength.ts` re-exports it,
so nothing else changed.

**Insensitivity, on the reused number.** Across the whole range that derivation could have produced
(3σ = 10.7%–15%) the floor on Demo 1 spans 1.144–1.189 s. Every spurious same-side gap measured
there is ≤ 0.88 s and every genuine same-side stride is ≥ 1.24 s, so the entire range gives the same
verdict on every observed pair. The outcome is set by the clip's physics, not by the number.

**A structural invariant, not a coincidence.** Because the floor IS the period gate's own lower band
edge, this selection can only ever drop a same-side pair that `estimateStrideLength`'s gate would
have rejected downstream anyway. The two rules cannot disagree. The corollary is worth recording:
after this change the gate's LOWER edge is unreachable through `detectFootstrikes` — both use the
same fitted frequency on the same frames — so the gate now catches only the *doubling* direction (a
missed strike). The two rules partition the failure space rather than overlapping.

**The gate for using the rhythm at all is `cadenceMinFitR2`,** the same bar cadence itself clears
before it will report a number. Below it the fitted frequency describes noise, and a rhythm derived
from noise must never delete real footstrikes; above it, cadence is willing to put the number on
screen. When the fit fails, `footstrikeMinIntervalSeconds` binds alone — exactly the pre-existing
behaviour, and there is a test pinning that path.

---

## D13. What round 1 also proved, in the unit suite

Three existing tests changed behaviour, and each change is a measurement rather than an
accommodation.

- **`verticalRatio`'s clean-clip test lost its caveat.** It used to assert that the period gate
  rejected exactly two pairs — the run-edge artifacts `findLocalExtrema` manufactures at t=0.0000
  and t=3.9667 on the 4 s synthetic clip. Those two candidates are now removed at source by the
  spacing floor, so the gate has nothing left to reject and the caveat is `null`. The two rules
  independently agreeing on precisely which instants were spurious is the strongest available
  confirmation that the floor is the same criterion, not a second opinion.
- **`verticalRatio`'s period-gate test had to change direction.** Its fixture built a half-stride
  ankle rhythm; that can no longer reach the gate at all, for the structural reason above. It now
  builds a double-stride rhythm and exercises the gate's upper edge, which is the only edge that
  remains reachable.
- **`cadence`'s footstrike-cross-check was passing on a cancellation.** With the two edge artifacts
  gone, `60 / median(intervals)` reads 163.6 spm against the fit's 170.4. The cause is quantization,
  not disagreement: the true step interval is 0.3529 s, a 30 fps grid can only render it as 0.3333 s
  or 0.3667 s, and this fixture's ten intervals split 4/6 between the bins, so the median snaps to
  the heavier bin while the **mean** lands at 0.3533 s — 0.1% from the truth. The artifacts had been
  contributing 0.1667 s and 0.2667 s intervals that dragged the median back down to 0.35 s by
  coincidence. The cross-check now uses the mean, and its `< 3 spm` tolerance was **not** touched.

**Candidate sets on the shared fixtures, before and after.** `generateSyntheticGait` went from 13
candidates to **11**, dropping exactly the two run-edge pivots (whose overstride ratios, 0.02 and
0.384, were the two outliers of the thirteen); the surviving eleven alternate strictly and their
gaps are 0.333–0.367 s against a true step of 0.353 s.

---

## D14. Predictions for round 2

Stated before live verification, again, and again falsifiable.

1. **Instant count.** Demo 1 should emit roughly 4 instants over the ~2.3 s window where it emitted
   9, at a mean gap near the true 0.658 s step rather than 0.285 s. Per side, no two instants closer
   than 1.14 s.
2. **Alignment.** The surviving instants should be the contacts, so they should land near app
   3.98 / 4.68 / 5.24 / 5.92, late by the D6 residual (one to two sampled frames). This is the
   prediction that failed last round; it now rests on the contact being the largest maximum in its
   stride window, which is a 1.3× margin on the fixture's own artifact and should be far wider on a
   real clip where the artifact is bounce-sized and the contact is swing-excursion-sized.
3. **`overstriding`.** The median should now RISE relative to the 0.129 measured in round 1, and its
   spread should collapse from ~49%. Whether it rises past the 0.215 baseline is genuinely open: the
   baseline was itself a contaminated mixture, so there is no reason its value is the target. The
   falsifiable part is the direction and the dispersion, not a number.
4. **`verticalRatio`.** Round 1's 3.54% was explicitly not to be chased. If the instants change, the
   value may move; the honest check is whether the surviving same-side pair is ~1.26 s (one real
   stride) rather than whether the percentage is preserved.
5. **`cadence` must still not move.** 91.2 spm.

**A copy defect to flag rather than fix.** `verticalRatio.ts`'s `'no-period-consistent-pairs'`
caveat says "extra footstrike instants were most likely detected mid-stance". That describes the
halving mechanism, which is now the one direction that can no longer reach that branch. The wording
is user-facing copy on another change's file, so it is reported rather than edited here.
