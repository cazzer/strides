# Design — gate stride pairs on the fitted step period

## Context

`verticalRatio = fit.peakToPeakAmplitude / stride.strideLengthPx`. The numerator is verified: it is
the same shared hip-bounce spectral fit `verticalOscillation` and `cadence` read, and `cadence`'s
reading of that fit is independently confirmed correct on Demo 1. The denominator is not verified by
anything. This change gives it the one check the numerator's own fit can supply for free.

---

## D1. The measured defect on Demo 1 (evidence of record — do not re-measure)

Demo 1 is the Pexels side-view track clip: 3840×2160, 25 fps, static camera, subject crossing the
frame laterally.

**Ground truth, read frame by frame off the source.** Ground contact was identified as the frame
where the shoe meets its own shadow (the camera is static and the track surface is uniform, so the
shadow gap is unambiguous). Contact **onsets**:

| contact | ffmpeg `t` (s) |
|---|---|
| A | 3.90 |
| B | 4.60 |
| C | 5.16 |
| D | 5.84 |

Contacts alternate feet, so:

- step intervals: **0.70, 0.56, 0.68 s** (mean 0.647 s → 92.8 spm)
- same-foot strides: A→C = **1.26 s**, B→D = **1.24 s** (so ~1.25 s, → step frequency 1.6 Hz)

**What the app detected.** App time maps to source time as `app = ffmpeg + 0.08` (this clip's
documented edit-list offset — see CLAUDE.md's evidence-seek section). The app's three same-side
strikes are app `4.00 / 5.04 / 5.60` → ffmpeg `3.92 / 4.96 / 5.52`:

| app t | ffmpeg t | what is actually happening on that frame |
|---|---|---|
| 4.00 | 3.92 | contact **A**'s onset — a real footstrike |
| 5.04 | 4.96 | contact **B**'s **toe-off** |
| 5.60 | 5.52 | **late stance inside contact C** |

B and C are different contacts and therefore **opposite feet**, yet all three carry the same `side`
label. The mechanism is the one `cadence.ts`'s module doc already names: a trailing leg produces a
secondary prominence-confirmed ankle-y maximum while the *other* foot is in stance, and
`detectFootstrikes` keeps per-side ankle-y maxima with no notion of ground contact.

**Consequence.** The two candidate same-side pairs span **1.04 s** and **0.56 s** against a true
stride of ~1.25 s. `strideLengthPx` is the median of their hip displacements, so the denominator is
measured over roughly one *step*. `verticalRatio` reads ~6.8% at confidence 0.72–0.73 where the
truth is ~3–3.5%: about 2× high, at High confidence, with no caveat.

**Cross-check that the numerator is innocent.** VO reads 16.3% of torso and `verticalRatio` 6.8%, so
the implied stride is `0.163 / 0.068 = 2.40` torso lengths ≈ 1.2 m. At the reported 46 strides/min
that is 0.92 m/s — a brisk walk, not what the clip shows. Doubling the stride gives ~2.8 m and
~2.1 m/s, a plausible jog. The error is entirely in the denominator.

**`cadence` is correct and must not be "fixed".** 91.2 spm against a frame-counted 92.8 spm. It
reads the spectral fit, not `detectFootstrikes`, and that migration was made for exactly this
failure mode.

---

## D2. Why an external reference answers an objection the internal one could not

`strideLength.ts` already considered and rejected a **fit-period multiplicity correction**:

> compare each pair's `d` against the median `d` and halve (or discard) any pair suspiciously close
> to 2x the median … Rejected: on a short clip a "suspicious 2x" threshold has no calibrated
> boundary … and misclassifying a genuinely long single stride as doubled would silently halve a
> real value.

That objection is **specifically about a self-referential comparison**: with 2–7 pairs on a short
clip, "2× the median" is a statement about a sample whose own median may already be wrong. On Demo 1
it is catastrophically so — *both* pairs are wrong, so no comparison among them can detect anything.
A median-relative rule is structurally blind to a systematic error.

The reference used here is **external to the pair set and physically derived**:

```
stride = 2 steps                       (definition of a gait cycle)
fit.frequencyHz = step frequency       (cadence.ts: cadence_spm = frequencyHz × 60)
⇒ expected stride period = 2 / fit.frequencyHz
```

No coefficient is fitted, tuned, or calibrated in that derivation. And it is already in scope at the
call site: `verticalRatio.ts` calls `analyzeHipBounce` (line 247) *before* `estimateStrideLength`
(line 265) and already holds `fit` when it does. The plumbing is one optional parameter.

**Independently validated on this clip.** `fit.frequencyHz = 1.52 Hz` → expected stride period
**1.316 s**. The frame-counted whole-record step frequency is 1.546 Hz (mean step 0.647 s) → the
fit's frequency error is **1.7%**. The two candidate pairs sit at **0.79×** and **0.43×** of the
expected period. The reference cleanly separates the truth (~1.25 s, 0.95× of expected) from both
offenders.

**A note on the "2 ×" factor.** `fit.frequencyHz` is the *step* frequency, not the stride frequency,
and this is load-bearing. `cadence.ts`'s module doc establishes it: the hip-mid y-trace bounces once
per step (twice per gait cycle), so `cadence_spm = frequencyHz × 60` with no harmonic correction, and
`syntheticGait.ts` builds its fixture that way (`hip-y oscillates at 2 × strideFreqHz`). Getting this
backwards would make the gate reject every genuine stride and accept every step-length pair — the
exact inversion of the intended behaviour, which is why the unit suite pins both directions.

---

## D3. Where the gate goes, and in what order

The gate is a **time** check on the candidate pair, applied inside `estimateStrideLength` before the
existing hip-resolution and `d > 0` displacement checks. New step 4a in the module's gate order:

```
4a. interval = strikes[i+1].timestamp − strikes[i].timestamp
    ratio    = interval / (2 / stepFrequencyHz)
    reject unless  1/(1+TOL) ≤ ratio ≤ (1+TOL)
```

**Why inside the extractor rather than in `verticalRatio.ts`.** The extractor owns pair
construction, the median, and all three pair counts. Filtering outside it would mean the caller
recomputing the median and the counts from `pairs`, duplicating the extractor's own contract, and
leaving `strideLengthPx` describing a pair set the caller no longer agrees with.

**Why before the displacement checks.** A pair that is not a stride should be counted as *not a
stride*, not as "couldn't be read cleanly" — which is what it would become if hip-resolution
happened to fail on it first. Putting the interval check first makes `periodRejectedPairCount`
deterministic and independent of tracking quality.

**Why log-symmetric bounds rather than `|ratio − 1| ≤ TOL`.** The errors this gate must reject are
**multiplicative** (½× for a spurious extra strike, 2× for a missed one). A band symmetric in
`log ratio` treats "half as long" and "twice as long" as equally distant, which they are. It also
avoids the asymmetry of an additive band, where `±0.15` is 15% of headroom above and 15% below but
17.6% and 13.0% of the *reference* in ratio terms. Implemented as the equivalent bounds
`[T/(1+TOL), T·(1+TOL)]` rather than a `Math.log` call, which is the same set and cheaper to read.

**Inertness by construction.** With no `stepFrequencyHz` supplied (or a non-finite / non-positive
one), the expected period is `null`, the check is skipped, `periodRejectedPairCount` is `0`, and
every existing count and failure reason is bit-identical to before. There is exactly one production
caller, `verticalRatio.ts`, so this is the *only* path the gate is live on.

---

## D4. The tolerance — derivation

This is the one judgement call in the change, so it is derived from physical quantities and then
checked against the outcome, **never** chosen to produce an outcome.

### D4.1 What the band has to tolerate

A genuine same-side footstrike pair's measured interval differs from `2 / fit.frequencyHz` for four
independent reasons. Each is estimated as a standard deviation, expressed as a fraction of the
stride period.

| # | source | σ | where it comes from |
|---|---|---|---|
| 1 | **stride-to-stride biological variability** | **2.5%** | Stride-time coefficient of variation in healthy adult running is consistently reported in the low single digits — roughly 1–3%, tighter in trained runners than untrained (the stride-interval variability literature: Jordan/Challis/Newell; Nakayama et al.). 2.5% is the pessimistic end of that range. |
| 2 | **footstrike-instant quantization** | **2.7%** | Each strike snaps to a sampled frame, so each endpoint carries a ±½Δt uniform error and their difference has σ = Δt/√6 ≈ 0.41·Δt. This repo's live runs sample 47–99 frames over 2–4 s (Δt ≈ 0.02–0.08 s); at the pessimistic Δt = 0.08 s against a T = 1.2 s stride, 0.41 × 0.0667 = 2.7%. Demo 1's own Δt = 0.04 s against T = 1.32 s gives 1.2%. |
| 3 | **fit frequency-grid resolution** | **0.5%** | `spectralFitFrequencyStepHz = 0.02` over the 1.2–4.0 Hz band. The winning frequency is uniform within ±½ step of the true peak, σ = 0.02/√12 = 0.0058 Hz; worst case at the band's slowest end, 0.0058/1.2 = 0.5%. |
| 4 | **fit frequency estimation error beyond the grid** | **2.0%** | The grid is finer than a few-seconds record's real frequency resolution (that key's own doc says so), so the estimator, not the grid, dominates. The one measurement available: Demo 1's fitted 1.52 Hz against a frame-counted 1.546 Hz = **1.7%**. Rounded up to 2%. |

Sources 1–4 are independent, so they combine as RSS:

```
σ_total = √(2.5² + 2.7² + 0.5² + 2.0²) = √(6.25 + 7.29 + 0.25 + 4.00) = √17.79 = 4.22%
3σ      = 12.7%
```

**Chosen: `STRIDE_PERIOD_TOLERANCE = 0.15`** — the 3σ envelope, rounded up to a round number. A 3σ
envelope is the right shape because the cost of the two errors is asymmetric: wrongly rejecting a
genuine stride costs one sample (and, at worst, the metric goes null with an honest reason), while
wrongly accepting a half-stride puts a 2×-wrong number on screen at High confidence. Rounding *up*
from 12.7 to 15 buys the genuine-stride side a little extra margin at negligible cost on the other.

### D4.2 The derivation is insensitive to the literature value

The only soft input is source 1. Recomputing at both ends of the reported CV range:

| assumed stride-time CV | σ_total | 3σ |
|---|---|---|
| 1.0% (trained-runner end) | 3.55% | 10.7% |
| 2.5% (chosen) | 4.22% | 12.7% |
| 3.0% (untrained end) | 4.47% | 13.4% |

The whole range lands between 10.7% and 13.4%, all of which round to the same 15%. The choice does
not hinge on pinning the biomechanics literature to a specific number.

### D4.3 Sanity bounds — the band is far from every boundary that matters

The accept band at TOL = 0.15 is `ratio ∈ [1/1.15, 1.15] = [0.870, 1.150]`.

**Upper bound on any admissible tolerance (multiplicity separation).** The nearest wrong
multiplicities are 0.5× (a step mistaken for a stride) and 2× (two strides mistaken for one). A band
that reaches either is useless, so TOL < √2 − 1 = 41.4% is a hard ceiling. In log terms the chosen
band's edges sit **0.554 nats** from *both* offenders, against a band half-width of **0.140 nats** —
the band is ~4× narrower than its distance to the nearest thing it must exclude, symmetrically.

**Lower bound (don't reject real strides).** A 5% deviation — comfortably larger than anything in
D4.1's budget individually — is at ratio 0.95 or 1.05, well inside `[0.870, 1.150]`. Demo 1's own
*true* stride, 1.25 s against the expected 1.316 s, is at ratio **0.950** and would be accepted.

**Distance to the outcome flip.** Demo 1's larger offender sits at ratio 0.7904. Rejecting it
requires `1/(1+TOL) > 0.7904`, i.e. **TOL < 26.5%**. The chosen 15% clears that by a wide margin,
and — critically — *every* value the derivation could plausibly have produced (10.7%–15%) rejects it
too. The outcome is not sensitive to the judgement call; it is determined by the physics.

### D4.4 What was deliberately NOT done

- **The band was not fitted to Demo 1.** No candidate value was tried against the clip before being
  derived. The derivation is written above in full and reaches 12.7% without any Demo 1 number
  except source 4's 1.7% *frequency* error — which is a property of the fit, not of the pairs being
  gated.
- **No existing tuned threshold was moved.** `footstrikeMinIntervalSeconds`,
  `footstrikeMinProminenceRatio`, `verticalOscillationMinFitR2`, `spectralFit*` and
  `MIN_STRIDE_PAIRS` are all untouched. The change adds one new constant and reads two existing ones
  (`spectralFitFrequencyStepHz` and `spectralFitMinFrequencyHz`) only to *justify* it, not at
  runtime.
- **The tolerance is a module constant, not a `HeuristicsConfig` key.** It has exactly one use site
  and is not shared between metrics, matching the precedent of `MIN_STRIDE_PAIRS` and
  `FIT_QUALITY_SATURATION_R2`. A config key would also buy nothing today: the heuristics config has
  no dev-time override plane (CLAUDE.md's Backlog records this as unbuilt). It is `export`ed so the
  unit suite can state its assertions in terms of the band rather than duplicating the number.

---

## D5. Expected outcome on Demo 1 — (a), null with an honest reason

Both of the ticket's outcomes were acceptable and neither was to be preferred by tuning. The derived
band produces **(a)**:

| pair | interval | ratio to expected 1.316 s | verdict at TOL = 0.15 |
|---|---|---|---|
| app 4.00 → 5.04 | 1.04 s | 0.790 | **rejected** (below 0.870) |
| app 5.04 → 5.60 | 0.56 s | 0.426 | **rejected** (below 0.870) |

No pair survives, so `estimateStrideLength` returns `{ ok: false, reason:
'no-period-consistent-pairs' }` and `verticalRatio` reports `value: null`, `confidence: 0`, and a
caveat naming the real cause.

**This is arguably the correct result, not a degradation.** The detector genuinely found no real
stride on this clip: of the three instants it labelled same-side strikes, one is a footstrike and two
are late-stance/toe-off instants belonging to the *other* foot. There is no stride in that data to
measure. Reporting nothing, with a caveat that says why, is the honest reading; reporting 6.8% at
High confidence is not.

Outcome **(b)** (~3–3.5%) was only ever reachable if a genuinely-correct pair existed in the
detected set. On Demo 1 none does — the ground-truth read above shows the detector never produced two
consecutive instants one stride apart on the same foot — so (b) was not available at *any*
tolerance. A looser band (TOL > 26.5%) would have admitted the 1.04 s pair, giving a stride 17% short
and a ratio ~20% high (≈4.1%): still wrong, and now wrong *quietly*. That is the outcome the
derivation avoids on principle rather than by preference.

**Unmeasured, and flagged for live verification.** How often the gate leaves *other* clips with too
few pairs (or none) is not measured here — this change ships with no browser run, by instruction.
Demo 2 is excluded from `verticalRatio` at tier 3 today and multiperson's coverage is not
run-to-run deterministic, so the live signal to watch is: `verticalRatio` on Demo 1 going null with
the new caveat, and multiperson's `verticalRatio` either holding or reporting a pair-count-reduced
confidence rather than silently keeping its old value.

---

## D6. Failure-reason and count surface

`StrideLengthFailureReason` gains **`'no-period-consistent-pairs'`**, returned when the kept-pairs
list is empty *and* at least one pair was period-rejected. When nothing was period-rejected the
reason stays `'no-usable-pairs'`, byte-for-byte the old behaviour — so the new reason always carries
real information (a pair *was* seen and *was* judged not-a-stride) rather than being a rename.

The success result gains **`periodRejectedPairCount`**, with the invariant
`pairCount + periodRejectedPairCount ≤ candidatePairCount`; the remainder is the pre-existing
hip-unresolvable / non-advancing drop. `candidatePairCount`'s meaning is unchanged (pairing
*opportunities*, before any drop), so no existing assertion about it moves.

`verticalRatio.ts` consumes both:

- the new reason gets a caveat naming the **real cause** — that no pair lasted a full stride at the
  clip's own measured step rhythm, and that extra strike instants are the likely reason — not the
  generic "no usable pairs" text, which would describe a displacement failure that did not happen;
- the existing "N stride pair(s) couldn't be read cleanly" caveat now subtracts
  `periodRejectedPairCount` from its count, and period rejections get their own sentence. Folding
  them into "couldn't be read cleanly" would be wrong on the facts: those pairs read perfectly
  cleanly, they just weren't strides.

---

## D7. Does this also help the doubling bias? Yes, for free

The module's documented doubling bias (a *missed* footstrike, so the next same-side strike is two
strides later) puts the pair's interval at ratio ≈ 2.0 — outside `[0.870, 1.150]` by a factor of
1.74. Where the reference is available, the gate rejects it explicitly rather than relying on the
median to outvote it. That does not retire the median-based mitigation (the gate is inert without a
`stepFrequencyHz`), but it does mean the module now catches **both** directions of the multiplicity
error where it matters.

The module's second documented bias — the `d > 0` filter truncating a near-zero displacement
distribution upward — is untouched and unrelated (it is a displacement effect, not a timing one).

---

## D8. The missing bias direction in the documentation

`strideLength.ts` documents only the **doubling** bias:

> missed strike → interval spans 2 strides → `strideLengthPx` reads **HIGH** → caller's ratio reads
> **LOW**

The defect this change fixes is the mirror image and was undocumented:

> spurious extra strike → interval spans ~½ a stride → `strideLengthPx` reads **LOW** → caller's
> ratio reads **HIGH**

Both directions now appear in the module doc, with the halving one carrying the Demo 1 measurement
and the note that the median offers **no** protection against it when it is systematic — on Demo 1
*every* pair was affected, so there was no clean majority for the median to land among. That is the
structural difference between the two biases: the doubling one is an occasional outlier (median
handles it), the halving one is a systematic property of how `detectFootstrikes` treats a trailing
leg (median does not).

---

## D9. Adjacent consumers — assessed, not changed

`overstriding` and `footStrikePattern` also consume `detectFootstrikes`, and are **out of scope by
instruction**. Read-only assessment, for a separate ticket:

- Neither uses an inter-strike **interval**, so neither is exposed to *this* defect. They read a
  per-instant geometry at each strike and take a median of ratios; a spurious instant contributes an
  extra *sample*, not a wrong denominator.
- They are, however, exposed to the same spurious *instants*, and the contamination is **directional
  rather than random**, so a median does not neutralise it:
  - `overstriding` measures `ankle.x − hipMid.x` signed by travel direction. At toe-off / late
    stance the ankle is *behind* the hip, so a spurious instant contributes a strongly negative
    ratio — pulling the median toward "not overstriding". Circumstantial support in CLAUDE.md's
    recorded distribution: Demo 1 `overstriding` has n = 7, median 0.2266, **MAD 0.2403** — a spread
    as large as the median itself, the shape of a bimodal mixture rather than a noisy unimodal one.
  - `footStrikePattern` measures `ankle.x − knee.x` signed by travel direction. At late stance the
    ankle is behind the knee, which classifies as **forefoot**. The ticket's note that "a late-stance
    instant still classifies an on-ground foot" is true but not sufficient: being on the ground does
    not make the shank angle representative of the strike, and the bias has a definite sign.
- The clean fix for both is upstream in `footstrikes.ts` (distinguishing a contact onset from a
  trailing-leg secondary maximum), not per-metric — which is exactly why it is not attempted here.
