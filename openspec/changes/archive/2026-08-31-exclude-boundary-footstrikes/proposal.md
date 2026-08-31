# Exclude footstrikes with one-sided evidence, and price a missing sample honestly

## Why

Two beads, and they are the same defect seen from either end.

**`strides-aah`** — on Demo 2 the background scale pass detects a footstrike at t = 1.66833, the
clip's **final sampled frame**, and it carries the most extreme offset ratio of the five
(**+1.38051**, against a primary-pass maximum of +0.37568). A strike on the last sampled frame has
no following frame to confirm it; a strike on the first has no preceding one. The evidence for a
ground contact is a REVERSAL — the striking foot stops descending, or the two ankles stop
separating — and a reversal is a statement about both sides of an instant. At a boundary only one
side exists, so what gets emitted there is whatever the series was doing when the data ran out.

**`strides-h6r`** — the reported value is `median(offsetRatios)`, and on Demo 2
`usableStrikeCount` is **5 on both passes**. At n = 5 the median IS the third-largest value, so two
high outliers promote the third-smallest into the middle slot:

```
scale-pass ratios sorted: [-0.00793, 0.16306, 0.40424, 0.84934, 1.38051]
median of all five               = 0.40424   <- the reported value
median of the three non-outliers = 0.16306      ratio 2.48x
```

Both of that pass's outliers sit at a clip boundary — +1.38051 on the last frame, +0.84934 at the
edge of the contaminated clip-opening window `strides-boc` measured. **`stepWidth` reports
confidence 1.0 on this clip today**, on the primary pass, which also has only 5 strikes: a
MoveNet-only run is one bad strike from the same failure with nothing flagging it.

**They ship together because they price each other.** The exclusion removes a sample; the minimum
sample size is what prices a missing sample. Excluding boundary strikes alone would silently reduce
`n` while `MIN_STEP_WIDTH_SAMPLE_SIZE = 4` kept reporting full confidence from four. Raising the
minimum alone would leave the contaminated instants in the median it is trying to protect.

## Two findings that reframed the tickets

**(A) Demo 2's scale pass was NOT using the phase detector.** Both passes sample at 1/59.94 s.
Primary strike frames: 6, 26, 46, 66, 85 — deltas 20, 20, 20, 19, consistent with a single period
(`59.94 / 3.02 = 19.85`). Scale pass: 25, 45, 67, 86, 100 — deltas 20, 22, 19, **14**.
`detectFromBouncePhase` emits at a fixed period and never skips a `k`, so consecutive deltas are
confined to `{floor(p), ceil(p)}`; 20/22/19/14 cannot come from any single `p`. Corroborated: the
scale pass's same-side right gap (frames 67 → 100 = 0.5506 s) is BELOW
`shortestPlausibleStrideSeconds(2/3.12) = 0.5574 s`, which `selectFootstrikes` would have rejected
given a trustworthy rhythm. So the scale pass's hip fit was below `cadenceMinFitR2`,
`isRhythmTrustworthy` was false, `detectFromBouncePhase` returned `[]`, and the **fallback** ran
with `minIntervalSeconds` collapsed to the 0.25 s config floor.

This **contradicts** `openspec/changes/archive/2026-08-31-explain-the-step-width-pass-gap/design.md`
D2a, which attributes the differing instants to "two passes that fit different bounce curves". That
doc gets a correction note beside the claim as part of this change; its measurements are untouched.

**(B) The boundary defect is in the FALLBACK by construction, and in the phase path only by
coincidence.** `extrema.ts`'s `findExtremaInRun` unconditionally emits a trailing pivot at every
run's end. Its docstring defends this on PROMINENCE grounds — a claim about amplitude, not about the
event being a ground contact. `selectFootstrikes` then ranks by descending value, so a boundary
pivot on a contaminated frame competes on the strength of its own contamination: Demo 2's scale pass
emitted it at frame 100 at ratio +1.38051. The phase path reaches a boundary only when a predicted
instant happens to snap within half a frame of an end — roughly 2.5% per end.

This answers `strides-aah`'s "worth checking first: is this specific to the phase detector" the
OPPOSITE way to the ticket's framing, and it is decisive about placement: **the fix belongs where
both paths converge, in `detectFootstrikes`** — not in `computeStepWidth`, and not in either
detector.

## What changes

1. **`detectFootstrikes` excludes any candidate on the first or last frame of the analysed series**,
   once, after path selection, so both detectors are covered identically. No threshold, no
   tolerance, no per-path exemption.
2. **`MIN_STEP_WIDTH_SAMPLE_SIZE` rises 4 → 7.** `median` is kept; no null floor is added — below
   the minimum, step width is discounted, never withheld.

**Why 7, and which half of it is derived.** With `n` samples of which `k` are contaminants all on
one side, the contaminants occupy the top `k` ranks, and the median touches the clean subsample's
extreme value unless

```
n >= 2k + 3
```

(odd `n` needs `(n+1)/2 < n − k` → `n >= 2k + 2`; even `n` needs `n/2 + 1 < n − k` → `n >= 2k + 3`;
the binding case is `2k + 3`). So `k = 1` → `n >= 5` and `k = 2` → `n >= 7`. **The current constant
fails its own docstring**, which claims 4 is where a single noisy detection stops dominating: at
`n = 4, k = 1` the median is `mean(rank2, rank3) = mean(clean median, clean MAX)`. That is a
correctness defect independent of Demo 2.

`k = 2` is a **judgment call, not a derivation**, and is labelled as one. Its grounds: two
independent contamination mechanisms are documented on this corpus — boundary strikes, fixed here,
and tracker-dropout windows (`strides-boc`), which are NOT fixed and are not fixable at this
layer — and the only clip whose per-strike ratios have been measured carried exactly `k = 2` of
`n = 5`.

## Pre-registered predictions

Recorded before any measurement. Live verification is the user's; this section is the thing it is
checked against.

**Demo 2, primary pass** (strikes at frames 6 and 85 of a 0–100 series, so nothing is excluded):

| field | before | after |
|---|---|---|
| `stepWidth.value` | 0.225311 | **0.225311, unchanged** |
| `stepWidth.confidence` | 1.0 | **0.7142857** (= 5/7; every other factor is provably 1.0) |
| `stepWidth.sampleSize` | 5 | 5 |
| tier | normal | **still normal** (0.714 ≥ `HIGH_CONFIDENCE_THRESHOLD` 0.7) |
| caveat | null | `Only 5 footstrike(s) detected (recommend at least 7) — confidence reduced accordingly.` |

**Demo 2, scale pass** (not visible in the A/B report; needs a driver reading the
`[analysis-diagnostics:scale-pass]` line): the frame-100 strike is excluded, so

```
0.404238 @ 0.2   ->   0.283650 @ 0.114286      n 5 -> 4
```

`0.283650 = mean(0.16306, 0.40424)` — the n = 4, k = 1 case above, live: the median still touches
the clean subsample's maximum. That is the residual this change knowingly does not close, and it is
why the minimum had to move at the same time.

**Demo 1 and multiperson**: values unchanged, confidences scaled by `min(1, n/7)`, tiers still low.

**`cadence` and the whole vertical-oscillation family: byte-identical.** They do not consume this
detector.

⚠️ Demo 2's predicted **0.714286 sits 0.014 above `HIGH_CONFIDENCE_THRESHOLD = 0.7`**. Choosing 8
instead of 7 would push it under, and that would be tuning a constant to a UI outcome — which this
repo's threshold discipline forbids. 7 is what `n >= 2k + 3` gives at `k = 2`; the tier it lands on
is an output, not an input.

## What is NOT changed

- **`computeStepWidth` keeps `median`.** A trimmed statistic at n = 5 discards 40% of the sample,
  and the outliers it would trim are the ones this change removes upstream anyway.
- **No null floor.** Below the minimum the metric is discounted and caveated, never withheld — the
  shared "never a silent wrong number, and never a silently withheld one" contract.
- **The four sibling `MIN_*_SAMPLE_SIZE = 4` constants** (`stepWidthCm`, `footStrikePattern`,
  `kneeFlexion`, `overstriding`) are untouched. The identical arithmetic applies to each, but that
  sweep is a separate decision with its own blast radius.
- **`computeMetricConfidence`'s shape.** Un-saturating `min(1, n/nMin)` would move every metric in
  the pipeline.
- **`extrema.ts`.** Its trailing pivot is correct on prominence grounds, which is all it claims;
  the mistake was reading it as a ground contact. The correction belongs in the footstrike layer,
  and its docstring is cross-referenced rather than rewritten.
