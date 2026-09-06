# Surface a cross-clip metric disagreement to the reader

## Why

`strides-5hj`: **fusion tie-breaks to clip 1, silently hiding an equally-confident clip that
contradicts it.** `pickBestWithIndex` uses strict `>`, so equal confidences resolve to the lowest
clip index — and 1.0 is the confidence ceiling, so an equally-confident later clip can *never*
displace clip 1. The tie is structurally unwinnable, not merely unlucky.

Measured on the three bundled demo clips (`f7b02e8`, then re-measured on the current branch, 3
trials, zero spread):

| metric | side-landscape | side-portrait |
|---|---|---|
| `cadence` | 174 @ 0.907, n=5 | **null @ 0, n=0** |
| `overstriding` | **+0.512135** @ **1.0**, n=5 | **−0.00809497** @ **1.0**, n=13 |
| `footStrikePattern` | **+0.115103** (heel) @ **1.0**, n=5 | **−0.239589** (forefoot) @ **1.0**, n=13 |

Two side-view clips of the same runner, both at the confidence ceiling, and the panel shows clip
1's answer alone with no trace that clip 2 said something else. On `footStrikePattern` the card
reads **"Heel strike (proxy)"** while a second clip of the same run read forefoot.

**Why they disagree is diagnosed and is not this change's problem.** `strides-cjl` made touchdown
the fitted hip-bounce low point minus `T/4`, retaining the ankle-difference detector as the
fallback when the hip fit falls below `cadenceMinFitR2` (`footstrikes.ts`). side-portrait's cadence
is null, so its hip fit is below that bar and its footstrikes come from the fallback while
side-landscape's come from the fitted phase. The n=5 vs n=13 split corroborates it. These are two
different constructions, both claiming confidence 1.0. Which is closer to the truth is **not
established** — there is no ground truth for this footage.

## What Changes

Fusion keeps its picking rule and every computed field, and gains a second sentence after the
existing provenance sentence: when a clip fusion did *not* pick would have put a **different word**
on the card, the caveat names that clip and what it read.

- **The rule is threshold-free and invents no constant.** Surface only where the losing clip lands
  in a different **category of a band the metric already owns and already ships**. Today that is
  exactly one metric: `footStrikePattern`, whose `classifyFootStrike` maps its signed ratio into
  `heel | midfoot | forefoot` through the symmetric `footStrikeMidfootBandRatio` dead zone — and
  whose card value *is* that word, not a number.
- **No magnitude threshold, deliberately.** Eleven metrics in eleven units would be eleven
  unjustifiable constants; this repo already has the worked example of where that ends (the 4K area
  floor, measured into a factor-of-2.9 squeeze and abandoned rather than tuned).
- **No bare-sign rule.** `stepWidth`/`stepWidthCm` do own a zero-crossing (`value < 0` → their
  crossover-gait caveat), but with no dead zone it would flip on noise and would miss two
  same-signed readings a torso apart. `cadence`'s `isNearGridEdge` is a claim about the measurable
  range, not a category the value is read in. Both are declined explicitly, in the code.
- Eligibility reuses the app's own display gate (`metricTier !== 'excluded'`), so a clip whose
  reading the panel already declines to show on its own is never quoted as a contradiction.
- **The tie-break is untouched, confidence is untouched, and no computed value moves.** Only
  `caveat` changes. A single-clip session still returns `results[0]` by reference.

## Impact

- Affected specs: `multi-clip-analysis` (one ADDED requirement; the existing
  `Per-metric confidence fusion across clips` requirement is untouched and stays true).
- Affected code: `src/results/fuseHeuristics.ts` and its test.
- User-visible: one extra sentence on `footStrikePattern`'s card in a multi-clip session whose
  clips straddle the midfoot band. Nothing else on any card changes.
