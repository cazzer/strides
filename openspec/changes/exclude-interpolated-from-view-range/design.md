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

`sagittalExcursionInterpolatedFraction` is documented in both the type and the implementation as
the **inverse** of `MetricResult.interpolatedFraction`'s meaning. That one counts interpolated
samples a metric USED and then discounted its own confidence for; this one counts samples the range
REFUSED to look at. Two fields with near-identical names and opposite senses is a real trap; the
mitigation is that the difference is exactly D1's rule, so anyone who reads one docstring learns the
other.

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

`framesWithSignals`'s default sample count moved **20 → 22**, and both properties are load-bearing.
It must clear the 21 floor — at 20, four existing tests (the `strides-2iw` cross-label comparability
suite and the measured-clip test) go `'ambiguous'` and fail, and the correct response to that is the
fixture, never the floor. It must stay **even**, so the two-valued alternating series splits exactly
in half and that fixture's exactness argument (p95 and p5 landing strictly inside the high and the
low block, making the range exactly `ser × TORSO_PX`) still holds.

The new `framesWithBlock` helper uses `bsr = 0.5` by default so that `spread / 2 = 25` is an exact
binary fraction and `ankle.x − hip.x` recovers each offset to the last bit — which is what lets the
no-op test assert with `toEqual`/`toBe` rather than a tolerance. 0.5 also clears
`frontViewMinBilateralSpreadRatio` (0.45).

The defect fixture is the unit-scale miniature of the live measurement: 34 detections at SER 0.33
(±16.5 px against `TORSO_PX` 100) plus a 6-frame block — 15% of the clip, the same order as the
live 16% — lerped to +82.5 px. Including the block moves the p95 from +16.5 to +82.5 and reports
**0.99**, three times the truth; excluding it reports exactly **0.33**.

## D8. Verification

Each new test was checked to actually fail without the code it guards, not merely to pass with it:

- removing the `ankle.interpolated || hip.interpolated` skip fails 3 of the 5 new tests;
- lowering `MIN_SAGITTAL_RANGE_SAMPLES` to 5 fails 2 of them.

The live three-clip, two-backend A/B is the ticket's acceptance criterion and is run separately,
against a baseline captured before this change.
