# Design — exclude interpolated samples from view detection's sagittal range

## D1. Why excluding is safe here and discounting is not

The pipeline's shared policy is "track the interpolated fraction and discount the confidence for
it". That policy is right wherever a metric's reduction is a **median or a mean**: an interpolated
sample there is a slightly worse estimate of a quantity every sample estimates, so dropping it
costs statistical power and keeping it costs a little accuracy. Discounting prices that honestly.

An **extreme-quantile range** is a different estimator and the trade inverts. `computeSagittalRange`
asks "how far apart are this leg's furthest-forward and furthest-back positions", and answers with
`p95 − p5`. Its inputs are not competing estimates of one number; the estimator reads only the ends
of the sorted array and every other sample matters solely by pushing the quantile index around.

Two facts settle it:

1. **A lerped sample cannot carry a real extreme.** `interpolateChannel` places it on the straight
   line between its two flanking detections, so its value lies strictly between theirs. Whatever
   extreme it appears to express, an anchor already expressed at least as strongly. Excluding it
   therefore cannot lose information the retained population does not already hold.
2. **A lerped sample CAN manufacture one.** It adds probability mass, and mass is the only thing an
   order statistic responds to. Ten frames lerped between two bad anchors do not add a new extreme
   value — they add ten copies of one, which is precisely what drags the p95 index into the outlier
   cluster instead of leaving it in the honest body of the distribution.

So exclusion is not a stricter version of discounting; it is the only reduction-appropriate policy.
Discounting the confidence would leave the corrupted `value` in place and merely apologise for it,
and the value is what gates every other metric.

### D1.1. The hull bound is exact for one channel, and this signal reads two

**Fact 1 above is stated per channel, and `computeSagittalRange` measures `ankle.x − hip.x`.**
`interpolateChannel` fills each keypoint independently, with its own run boundaries, so the
difference of two channels is bounded by its own anchors only when both were reconstructed across
the *same* run. That is exactly the whole-frame-dropout case, which is the measured Demo 2 defect —
the detector returned nothing at all for ten consecutive frames, so both channels were filled
together and the argument holds outright there.

**It does not hold when `classifyFrame` drops the two keypoints independently.** The sharpest
counterexample is **hip interpolated, ankle detected**: hip x is near-linear across a short gap so
the lerp tracks it well, while the ankle is the fast non-linear swing channel, so
`ankle.x(real) − hip.x(lerp)` can be a genuine extreme lying outside both anchors' `relX`. The
disjunction discards it and the range reads low.

**The rule is still the right one, because the error is one-directional.** Excluding samples can
only narrow a range, never widen it, so the residual cost is an SER biased **downward**. A low SER
pushes toward the front threshold or toward casting no vote at all, so the worst case on a genuine
side view is **degrade-to-ambiguous, never a confident wrong label** — the same asymmetry the
two-signal agreement rule is built on, and the reason a conservative disjunction beats a clever
per-channel one here. The alternative (exclude only when the SAME run covered both channels) would
be exact and would also re-admit the mixed-interpolation samples whose bound nobody has measured,
in exchange for recovering a signal that only ever reads slightly wider. Not worth the surface.

This qualification is carried in `computeSagittalRange`'s own docstring and softened into the spec
delta's normative sentence, rather than left as an unqualified SHALL that the arithmetic does not
support in every case.

## D2. Why 21, and why it is a constant rather than a config key

`percentile` interpolates at index `p·(n−1)` over the sorted array. The largest sample sits at index
`n−1`, so it influences the p95 exactly when `0.95(n−1) > n−2`:

```
0.95n − 0.95 > n − 2
        1.05 > 0.05n
           n < 21
```

Symmetrically the smallest sample influences the p5 when `0.05(n−1) < 1`, which is the same
condition. So:

| n | p95 index | trims the max? |
|---|---|---|
| 10 | 8.55 | yes — 55% of the max |
| 20 | 18.05 | yes — 5% of the max |
| **21** | **19.00** | **no — exactly the second-largest** |
| 41 | 38.00 | no — exactly the third-largest |

At n = 21 the estimator is exactly `second-largest − second-smallest`: one bad sample at each end is
discarded outright. That is the smallest n at which the function's own docstring claim is literally
true, which is what makes 21 a **derivation** rather than a threshold somebody chose. It is a module
constant for the same reason `SIDE_VIEW_FULL_BILATERAL_SPREAD_RATIO` is one and its front-view
counterpart is a config value: exact statements about the estimator do not belong in a tuning
surface.

Note the corollary the rewritten docstring now carries: the trim's strength is
`≈ ceil(0.05(n−1))` samples per end and is therefore **n-dependent**, worth one bad sample at n=21
and two at n=41. The floor does not make the estimator robust; it makes the claim of robustness
honest, and stops it silently degrading into a min-max.

## D3. Why the floor does NOT route into the insufficient-coverage early return

`detectView` already has a hard early return that yields `confidence: 0` and
`AMBIGUOUS_VIEW_PLAUSIBILITY` when body-scale coverage is below
`minViewDetectionFrameCoverage`. It would be one line to send a below-floor SER there too, and it
would be wrong.

That return exists for a clip that could not be classified **at all** — no usable body scale, so
neither signal means anything. A clip with a thin sagittal population is not that clip: its BSR may
be perfectly good, and its frames resolve. Routing the floor into that branch would force
`confidence: 0` on a clip the shipped requirement "View detection degrades to ambiguous, zero
confidence, under insufficient coverage" does not describe, falsifying a requirement rather than
extending one.

Instead the floor makes SER **unavailable**, which is a state the existing vote logic already
handles: an unavailable signal casts no vote, two votes are never reached, the label is
`'ambiguous'`, and confidence is the ordinary `0.3 × coverage`. `computeViewPlausibility` already
returns the all-ambiguous weighting when either ratio is null. No branch was added.

The unit test for the floor asserts `confidence ≈ 0.3` **and** `frameCoverage === 1` specifically to
pin that distinction, so a later "simplification" that merges the two paths fails loudly.

## D4. Diagnostics shape, and the naming trap

Both new fields are **required** and nullable-free, matching this repo's convention that every
construction site must state what it means rather than defaulting by omission. Both are per side,
because the floor is applied per side and a one-legged SER is a real, reachable outcome.

`sagittalExcursionSampleCount` is reported **even when that side's count fell below the floor**.
Reporting a bare null ratio with no count makes "18, one short" indistinguishable from "0, the
detector never found this leg", and those want opposite responses.

`sagittalExcursionInterpolatedFraction` is **numerically the same statistic** as
`MetricResult.interpolatedFraction` — interpolated over resolvable, exactly as `stepWidth.ts`
computes it. What differs is the **consequence**, not the meaning of the number: that one counts
interpolated samples a metric USED and then discounted its own confidence for, this one counts
samples the range REFUSED to look at. Both the type and the implementation say it that way, and both
say explicitly that it is **not** a complement — an earlier draft called it "the INVERSE", which
invites a reader to compute `1 − x` and is simply wrong. The difference between the two fields is
exactly D1's discount-versus-exclude rule, so anyone who reads one docstring learns the other.

Denominator is `detected + discarded`, i.e. resolvable samples, and the fraction is 0 when that is
0 — a side with nothing resolvable discarded nothing.

## D5. Documented non-goal — `resolveMidpoint`'s flag is overloaded

**Any future ticket extending this exclusion to a midpoint-derived signal must first un-conflate two
different meanings of `interpolated`.** `resolveMidpoint` (`keypoints.ts`, L39 and L57-61) returns
`interpolated: true` for its **single-side fallback**, regardless of that point's own status — a
deliberate documented choice, because standing one side in for a bilateral average is an
approximation of the same "trust this less" character as temporal interpolation, and it should feed
the same confidence discount.

That is fine for discounting and wrong for excluding. A single-side stand-in from a directly
detected keypoint **is** a real observation of a real position; it is not bounded between two
flanking detections the way a lerped sample is, so D1's argument does not cover it and excluding it
would discard genuine extremes.

`computeSagittalRange` reads `resolvePoint` only, so the trap does not apply here and nothing about
`resolveMidpoint` is touched by this change. Recorded so that the next ticket does not read the
identical field name and assume the identical semantics.

## D6. What was deliberately not touched

- **BSR.** It reduces by a median (D1's discounting side), and `resolveBilateralPair` does not
  return the flag at all. Changing it is a separate question with a separate argument.
- **Vote logic, confidence branches, plausibility, the coverage early return.** See D3.
- **`stepWidth.ts`'s reduction, footstrike detection, the MediaPipe adapter.** Separately owned.
- **`interpolate.ts` / `maxGapSeconds`.** The measurement used `maxGapSeconds: 0.05` as a probe to
  isolate the mechanism, not as a candidate fix. Shortening the gap budget would degrade every
  metric that legitimately benefits from filled gaps in order to protect one that should not have
  been reading them.
- **No shared view-result test builder.** Eleven fixture literals across ten test files were updated
  mechanically. Introducing a builder is a wider refactor of files this change has no other reason
  to touch.

## D7. Fixture arithmetic the new tests depend on

`framesWithSignals`'s default sample count moved **20 → 22**, for one load-bearing reason: it must
clear the 21 floor. At 20, four existing tests (the `strides-2iw` cross-label comparability suite
and the measured-clip test) go `'ambiguous'` and fail, and the correct response to that is the
fixture, never the floor.

Evenness is a **convention, not a requirement** — an earlier draft of this section and of the
fixture doc claimed the count had to stay even so the two-valued series split exactly in half. It
does not: for any n ≥ 21 the p95 and p5 indices land strictly inside the high and the low block
either way, so the exactness argument (range exactly `ser × TORSO_PX`) holds for an odd count too.
The floor test itself calls the fixture with **21** and reads its `ser` back exactly, which is the
proof.

The new `framesWithBlock` helper uses `bsr = 0.5` by default so that `spread / 2 = 25` is an exact
binary fraction and `ankle.x − hip.x` recovers each offset to the last bit — which is what lets the
no-op test assert with `toEqual`/`toBe` rather than a tolerance. 0.5 also clears
`frontViewMinBilateralSpreadRatio` (0.45).

The defect fixture is the unit-scale miniature of the live measurement: 34 detections at SER 0.33
(±16.5 px against `TORSO_PX` 100) plus a 6-frame block — 15% of the clip, the same order as the
live 16% — lerped to +82.5 px. Including the block moves the p95 from +16.5 to +82.5 and reports
**0.99**, three times the truth; excluding it reports exactly **0.33**.

## D8. Each guard was checked against its own absence

Every new test was confirmed to actually fail without the code it guards, not merely to pass with
it:

- removing the `ankle.interpolated || hip.interpolated` skip fails 3 of the 5 new tests;
- lowering `MIN_SAGITTAL_RANGE_SAMPLES` to 5 fails 2 of them.

## D9. Live A/B — all four ship conditions met, and one premise refuted

Run by the coordinator against a baseline captured before this change; recorded here because one of
its results contradicts this change's own stated expectation.

**The four pre-registered conditions all hold.** Demo 2 on the MediaPipe-primary path moves
**SER 1.59113 → 0.675891**, inside the predicted 0.60–0.70 band. Its plausibility moves
`{ambiguous 1, front 0}` → **`{ambiguous 0.689728, front 0.310272}`** with the label still
`'ambiguous'` — the expected outcome, since at SER 0.676 MediaPipe still clears neither bar and the
label stays ambiguous by abstention (this change was never aimed at that label; see the proposal).
Demo 1 reads **1.5448** and multiperson **1.76229**, both still `'side'`. **No metric value,
confidence or tier moved on any clip.** The lowest `sagittalExcursionSampleCount` anywhere is **48**,
well clear of the 21 floor — so the floor is not load-bearing on this repo's own footage and exists
for the thin-sample clip nobody has filmed yet.

**Refuted: "the MoveNet path is bit-identical because 99/99 detected ⇒ nothing excluded."** This
change's proposal and its no-op unit test both say the default path should not move. Demo 2's
MoveNet SER **moved, 0.328358 → 0.334267**. The unit test is not wrong — it asserts the no-op for a
clip with *no interpolated samples*, which is still exactly right — but the premise that the default
path IS such a clip was wrong, and the new diagnostic is what shows why:

| clip | `sagittalExcursionInterpolatedFraction` | `sagittalExcursionSampleCount` |
|---|---|---|
| demo1 | left 0.153, right 0.186 | 50 / 48 |
| demo2 | left 0.152, right 0.202 | 84 / 79 |
| multiperson | left 0.083, right 0.181 | 88 / 86 |

**`sampling.detectedFrames` counts FRAMES; an individual KEYPOINT inside a detected frame can still
be interpolated.** So **15–20% of the ankle samples feeding view detection were synthesized on all
three clips, on the default MoveNet path** — reading a frame-level count as a keypoint-level one is
what hid it. Nobody knew this until this change added the instrument, and it is the strongest
justification for having added the two diagnostics: the fix moved a number on a path everyone
expected it not to touch, and the diagnostic explained the move in one line instead of prompting a
regression hunt. It also retires the framing that this defect is latent on MoveNet and waiting for a
worse clip — MoveNet is running through interpolated ankle samples on every clip in the repo today.

The movement itself is small (+1.8% on Demo 2, no tier or metric change anywhere), consistent with
the exclusion removing a modest amount of near-extreme mass rather than an outlier cluster.
