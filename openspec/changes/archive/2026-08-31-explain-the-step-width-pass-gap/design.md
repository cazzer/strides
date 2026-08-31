# Design — the 1.79x stepWidth gap, explained

One temporary probe inside `computeStepWidth` dumping both passes' internals (both passes compute
heuristics, so one run yields two lines: primary first, scale pass second). Demo 2, cold page load,
real GPU, dev server identity-verified. Probe reverted; `src/` clean.

## D1. The measurement

| | primary (MoveNet) | scale pass (MediaPipe) |
|---|---|---|
| `view` | front | ambiguous |
| `value` | **0.225311** | **0.404238** |
| `hipWidthPx` | 91.383 | **88.463** |
| candidates / usable | 5 / 5 | 5 / 5 |
| `interpolatedFraction` | 0.000 | 0.000 |

Per-strike, which is where the answer is:

| primary | | scale pass | |
|---|---|---|---|
| t = 0.10010 left | **+0.37568** | — | *(no strike)* |
| t = 0.43377 right | +0.07781 | t = 0.41708 right | **+0.84934** |
| t = 0.76743 left | −0.16605 | t = 0.75075 left | −0.00793 |
| t = 1.10110 right | +0.22531 | t = 1.11778 right | +0.16306 |
| t = 1.41808 left | +0.34832 | t = 1.43477 left | +0.40424 |
| — | *(no strike)* | t = 1.66833 right | **+1.38051** |

## D2. Three findings, in order of how much they matter

### D2a. The two passes detect footstrikes at DIFFERENT INSTANTS

Not a small offset — a different **set**. The scale pass **misses the primary's first strike
entirely** (t = 0.10010) and **gains one the primary never sees** (t = 1.66833). The four in between
correspond but sit 0.010-0.020 s apart.

This is the mechanism `strides-87x` predicted as a candidate. Since `strides-cjl`, `detectFootstrikes`
derives touchdown from the **fitted hip-bounce phase**, so two passes that fit different bounce
curves produce different instants by construction. They do differ: the primary's cadence is 181.2
spm (3.02 Hz) against the scale pass's fitted 3.12 Hz. Over the clip's 1.67 s that is ~0.17 of a
cycle of accumulated phase — easily enough to shift every instant and to drop one strike off the
front and add one off the back.

> ⚠️ **CORRECTION (2026-08-31, `exclude-boundary-footstrikes`, beads `strides-aah`/`strides-h6r`).
> The paragraph immediately above is WRONG about the scale pass's mechanism, and the measurements
> either side of it are untouched.** The scale pass did not use the phase detector at all — it used
> the **ankle-difference fallback**, so the two passes' instants differ because they came from two
> different DETECTORS, not from two fits of the same one.
>
> Both passes sample at 1/59.94 s. The primary's strike frames are 6, 26, 46, 66, 85 — deltas 20,
> 20, 20, 19, consistent with a single period (`59.94 / 3.02 = 19.85`). The scale pass's are 25, 45,
> 67, 86, 100 — deltas 20, 22, 19, **14**. `detectFromBouncePhase` emits at a fixed period and never
> skips a `k`, so its consecutive deltas are confined to `{floor(p), ceil(p)}`; 20/22/19/14 cannot
> come from any single `p`. Corroborated independently: the scale pass's same-side right gap (frames
> 67 → 100 = 0.5506 s) is BELOW `shortestPlausibleStrideSeconds(2 / 3.12) = 0.5574 s`, which
> `selectFootstrikes` would have rejected had it been working from a trustworthy rhythm. So the
> scale pass's hip fit fell below `cadenceMinFitR2`, `isRhythmTrustworthy` returned false,
> `detectFromBouncePhase` returned `[]`, and the fallback ran with `minIntervalSeconds` collapsed to
> the 0.25 s config floor.
>
> This matters beyond bookkeeping: D2b's frame-100 outlier is then not a coincidence of the fitted
> phase but a structural product of the fallback, whose extremum scan emits an unconfirmed trailing
> pivot at the end of every run and then ranks candidates by amplitude — so the boundary instant
> competes on the strength of its own contamination. That is why the fix landed as a
> path-independent eligibility rule in `detectFootstrikes` rather than as a change to either
> detector. The 3.02 vs 3.12 Hz figures quoted above are real; they simply are not what produced the
> differing instant sets.

### D2b. Both of the scale pass's outliers sit on contaminated frames

- **t = 0.41708, ratio +0.84934** — immediately at the edge of the clip-opening window
  `strides-boc` identified as contaminated (MediaPipe misses 10 of 12 frames at t = 0.033-0.267 s,
  and the raw outliers run to t < 0.45 s).
- **t = 1.66833, ratio +1.38051** — the clip's **final sampled frame**. A footstrike detected on the
  last frame has no following frame to confirm it, and this is the strike the primary does not find.

### D2c. THE BEAD'S OWN PREMISE WAS WRONG — a median over FIVE is not outlier-robust

`strides-87x` reasoned that `stepWidth` takes a median at footstrikes, so a concentrated outlier
cluster should not move it. That is true asymptotically and **false at n = 5**:

```
scale pass ratios sorted: [-0.00793, 0.16306, 0.40424, 0.84934, 1.38051]
median of all five                       = 0.40424   <- the reported value
median of the three non-outliers         = 0.16306
                                    ratio  2.48x
```

Two outliers out of five move the median by **2.48x**. With `usableStrikeCount = 5` the median is
simply the third-largest value, so two high outliers promote the third-smallest into the middle
slot. Outlier resistance needs samples this clip does not have. Had the non-outlier median (0.16306)
stood, it would sit *below* the primary's 0.22531 rather than 1.79x above it.

## D3. REFUTED: the denominator

`hipWidthPx` is 91.383 (primary) vs 88.463 (scale pass) — a ratio of **0.968**, i.e. the scale pass's
denominator is 3% *smaller*, which would move `stepWidth` 3% *up*, not 79%. The hypothesis that
`stepWidth`'s distinct denominator (`hipWidthPx`, not the `torsoLengthPx` already cleared by
`strides-boc`) explained the gap is dead. Both passes also report
`interpolatedFraction: 0.000` here, so — unlike the SER defect — **interpolation is not involved in
this gap at all**. The two defects are genuinely separate.

## D4. JUDGEMENT FOR `strides-wac`: `stepWidthCm` on Demo 2 is NOT trustworthy

This is what `strides-wac` was blocked waiting for, and the answer is no.

The scale pass's `stepWidth` of 0.404238 is a median over five strikes of which **two are
contaminated**, taken at instants that **disagree with the primary's**, including one on the clip's
final frame that the primary does not detect at all. Strip the two outliers and the same data reads
0.16306. `stepWidthCm` (4.5309 cm) is the same computation in different units and inherits all of it.

So `strides-fn4`'s original caution was right, though not for the reason it gave. It withheld
`strides-wac` on the grounds that "MediaPipe's ankles are bad". `strides-boc` showed the ankles are
mostly fine — cross-backend median ankle distance ~20 px. The real problem is **which instants get
sampled, and how few of them there are**.

**`strides-wac` must not simply inherit the primary's view and render the number.** Options, none
chosen here: gate `stepWidthCm` on a minimum usable-strike count; drop strikes on the first and last
sampled frames; or reconcile the two passes' footstrike instants before grafting. Filed separately.

## D5. What this does NOT explain

Why the two passes' bounce fits differ (3.02 vs 3.12 Hz) is not established here — only that they do,
and that it is sufficient to move the instants. That is a smaller question than it looks, since
`strides-boc` already showed MediaPipe's clip-opening frames are contaminated and a bounce fit reads
the whole series.
