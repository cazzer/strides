# Design — propagate view confidence to metric gating

## Context

`computeFormHeuristics` (`src/heuristics/index.ts`) called `detectView` and passed only
`view.view` to all eleven metrics; `view.confidence` was stored on the result and read by nothing.
Each metric looks its row up as `config.viewFitTable[metric][view]` and gets a `fit` (which
`metricTier` turns into a hard exclusion when it is `'unsuitable'`) and a `multiplier` (which goes
straight into `computeMetricConfidence`). One label, two consequences, no notion of how sure the
label was.

Measured on Demo 2 (`park-approach.mp4`, 3 trials, bit-identical): `view.view = 'front'`,
`view.confidence = 0.0771`, five sagittal metrics hard-excluded, `armSwingSymmetry` at 0.977 and
`stepWidth` at 1.000.

## Goals / Non-goals

**Goals**: the certainty of the view classification reaches both halves of the gate, through one
quantity, so a single view call cannot simultaneously assert "the camera cannot support this
measurement" and "this measurement is highly trustworthy"; remove the discontinuity at the
classification thresholds; introduce no new tunable; leave every clip that commits to a view label
bit-identical.

**Non-goals**: changing `detectView`'s label, vote logic, `confidence` scalar or margin
arithmetic (all untouched — the `confidence` scale problem is `strides-2iw`, see D8); touching any
of the eleven metric modules; re-deriving any view-detection threshold; changing `metricTier`'s
rule (`viewFit === 'unsuitable'` still means excluded); the `viewFitTable`'s authored row values.

## D1 — Why NOT multiply metric confidence by `view.confidence`

This is the obvious reading of the ticket and it is measurably wrong.

`computeCommittedConfidence` is `clamp01(((bsrMargin + serMargin) / 2) * sampleCoverage)`, where
each margin is the signal's distance PAST the threshold its own committed view required. For
Demo 2:

| term | value |
|---|---|
| BSR 0.5507 vs `frontViewMinBilateralSpreadRatio` 0.55 | `(0.5507 - 0.55) / 0.55` = **0.0013** |
| SER 0.3389 vs `frontViewMaxSagittalExcursionRatio` 0.40 | `(0.40 - 0.3389) / 0.40` = **0.1528** |
| mean × `sampleCoverage` 1.0 | **0.0771** — the observed number, exactly |

The 0.0771 is dominated by BSR clearing its bar by 0.13%. It is **not** evidence that the clip
might be a side view. Side needs BSR <= `sideViewMaxBilateralSpreadRatio` 0.30 (measured 0.55) AND
SER >= `sideViewMinSagittalExcursionRatio` 0.80 (measured 0.34) — it fails both by more than a
factor of two. The clip is decisively not a side view.

So the scalar conflates two questions: *how far past its own bar does this label sit* and *how
sure are we of this label versus the other one*. Only the second should move a metric whose
`viewFit` differs between the two views. Multiplying by 0.0771 would drag `armSwingSymmetry`
(front `primary` 1.0, side `unsuitable` 0.1, ambiguous `unsuitable` 0.2) toward its ambiguous row
and delete it from the panel — on a clip whose own evidence images show both arms clearly.

## D2 — What replaces it: per-view plausibility from the same two signals

`computeViewPlausibility(BSR, SER, config)` (`src/heuristics/viewPlausibility.ts`) returns
`{ side, front, ambiguous }` summing to 1.

Each signal contributes a support in `[0, 1]` for each committed view, ramping linearly across the
band between the two views' own thresholds for that signal:

    bsrSideSupport  = 1 at BSR <= 0.30, 0 at BSR >= 0.55, linear between
    serFrontSupport = 1 at SER <= 0.40, 0 at SER >= 0.80, linear between

A view's plausibility is the **product** of the two signals' support for it, and `ambiguous` takes
the remainder:

    side      = bsrSideSupport * (1 - serFrontSupport)
    front     = (1 - bsrSideSupport) * serFrontSupport
    ambiguous = 1 - side - front

Three properties make this the right shape rather than one shape among many:

1. **The product is the existing decision rule, made continuous.** `detectView` requires both
   signals to vote for a view before committing; a product means one signal alone can never carry
   a view, at any strength of the other. Verified in the suite over the whole BSR range.
2. **The remainder is a real quantity, not a fudge.** `side + front <= 1` always, since
   `a*b + (1-a)*(1-b) = 1 - (a*(1-b) + b*(1-a))` and both bracketed terms are non-negative for
   `a, b` in `[0, 1]`. Equality holds only at the two corners where both signals fully agree, so
   the leftover mass is exactly "neither committed view is fully supported" — which is what
   `'ambiguous'` has always meant.
3. **The band the ramp crosses is the band the config already declares undecided.** Between 0.30
   and 0.55 no BSR vote is cast today; the ramp spans exactly that. Saturating AT the far
   threshold rather than some distance past it is the config's own definition of the thresholds:
   `frontViewMinBilateralSpreadRatio` is documented as "BSR at/above which a frame votes
   front-like", so a value that has cleared it is a full front vote by construction.

**No new constant, and no room for one.** The only numbers this uses are the four existing view
thresholds, each in the role it already had. There is no coefficient to fit, no exponent, no
floor. That matters here specifically: this repo has twice recorded that fitting a coefficient to
a three-clip evidence base is editing a criterion to match a result
(`derive-area-floor-from-4k-measurement`), and the temptation in this ticket is precisely to pick
a number that pushes one clip's `armSwingSymmetry` under 0.7.

**Insensitivity, in the form the design admits.** With no new parameter, the only sensitivity left
is to the four existing thresholds, and all three reference clips are far from all of them:

| clip | measured | distance to the nearest threshold that would change its gating |
|---|---|---|
| Demo 2 | BSR 0.5507, SER 0.3389 | front stays 1.0 for **any** BSR >= 0.55 and **any** SER <= 0.40; SER has 0.061 of headroom |
| Demo 1 | side, margins >= 0.548 each (implied by `confidence` 0.774 with coverage <= 1) | BSR <= 0.136 against a 0.30 bar; SER >= 1.238 against a 0.80 bar |
| multiperson | side, margins >= 0.506 each (from `confidence` 0.753) | same shape, slightly tighter |

Demo 2's gating is invariant to the ramp's *shape* entirely — both its signals are outside the
ramped bands, so any monotone interpolation across those bands gives the identical answer. The
only way to move it is to move a threshold across a measured value, which this change does not do.

## D3 — Body-scale coverage gates the plausibility, it does not weight it

`computeCommittedConfidence` multiplies by `sampleCoverage`; `computeViewPlausibility` does not,
and this is deliberate.

Coverage already gates this stage: below `minViewDetectionFrameCoverage` (0.4), `detectView`
returns before computing BSR/SER at all, and now returns `AMBIGUOUS_VIEW_PLAUSIBILITY` with it.
Blending it in on top would charge most metrics twice for the same missing frames — every metric
already multiplies its own `frameCoverage` into its confidence, computed over the same frames, and
for the torso-based metrics that is very nearly the same fraction `estimateBodyScale` reports.
Squaring a coverage penalty is not a more conservative reading, it is a wrong one.

It also keeps the reference clips provably unmoved: a coverage-weighted plausibility would shift
mass to `ambiguous` on any clip with coverage below 1, which (for example) would push Demo 1's
`verticalOscillation` from 0.727 across the 0.7 tier boundary at a coverage of ~0.96, for reasons
having nothing to do with which view the camera was at.

## D4 — `fit` from the most plausible view, `multiplier` from the whole distribution

`resolveViewFitTable` produces one entry per metric:

- **`multiplier`** is the plausibility-weighted mean of the metric's three rows. Because the
  weights sum to 1 and every other factor in `computeMetricConfidence` is view-independent, that
  is exactly the confidence the metric would have reported had the view been known, averaged over
  what is known about the view.
- **`fit`** is the row of `mostPlausibleView(plausibility)` — ties to `'ambiguous'`, because
  committing needs agreement and a tie is not agreement. (`side` and `front` can never tie for the
  maximum: equal plausibility forces both to `a*(1-a) <= 0.25`, always below the ambiguous
  remainder.)

Two rules for two things, matched to what they are: `fit` is a categorical claim about the camera
geometry, so it names the geometry we most believe we have; the multiplier is a quantity, so it
averages. A blend of `'unsuitable'` rows is still unsuitable, which is why Demo 2's sagittal
metrics stay excluded under any plausibility that keeps them unsuitable everywhere.

The alternative considered for `fit` was a mass-majority rule ("unsuitable if the mass on views
where it is unsuitable exceeds the mass where it is not"). It is equally parameter-free and
almost never disagrees with the argmax — the parametrisation constrains the reachable simplex
tightly enough that the disagreement region is a sliver near `side == ambiguous`. Argmax was
chosen for being one rule instead of two.

The resolved entry is written under **all three** view keys, so a lookup can no longer disagree
with the resolution whichever label a caller passes. The label stops being load-bearing rather
than merely being ignored.

## D5 — Resolving at the table, and the no-op proof

The resolution lands on the `viewFitTable` inside `computeFormHeuristics`, not on eleven call
sites. Every metric already reads `config.viewFitTable[metric][view]`, so handing it a resolved
table makes this a gating change instead of eleven metric changes — and three of those eleven
modules were owned by parallel work.

**Committed clips are bit-identical, by construction.** A committed label requires both signals
strictly inside one view's regions, which is exactly the condition under which both supports
saturate, so a labelled clip's plausibility is one-hot **on that same label**. `resolveViewFitTable`
returns the input table BY REFERENCE for a one-hot distribution (blending against it is the
identity), and `computeFormHeuristics` then passes the caller's own config object through
unchanged. Same table, same object, same label — the same argument `fuseFormHeuristicsResults`
makes with its single-clip reference identity, and asserted in the suite both at the unit level
(`resolveViewFitTable(table, oneHot)` is `table`) and at the integration level (three metrics deep-
equal a direct call with `view.view` and the untouched default config).

The converse is the scope of the change: **only clips that read `'ambiguous'` today behave
differently.** One-hot also covers the disagreement corner (one signal fully side, the other fully
front), so even a clip that is ambiguous *by disagreement* is unchanged. What changes is the
undecided bands, where the votes fall silent and the label has never had anything to say.

## D6 — Spec reconciliation ⚠ READ THIS BEFORE ARCHIVING ANOTHER CHANGE IN THIS CAPABILITY

Two requirements ADDED, six MODIFIED. The six modifications are all the **same one-clause
rewording** of an identical claim that appears in six places:

> "the returned `<metric>.viewFit` reflects the same `view.view` label present in the same result"

becomes "…reflects the same resolved view as every other metric — the view holding the most
plausibility mass, which is `view.view` itself whenever the clip commits to a label". The six:

1. `Orchestration runs view detection once and shares it across all three metrics`
2. `Cadence participates in the shared orchestration and output contract`
3. `Knee flexion is included in orchestrated output`
4. `Vertical ratio participates in the shared orchestration and output contract`
5. `Vertical oscillation in centimetres participates in the shared orchestration and output contract`
6. `Step width in centimetres participates in the shared orchestration and output contract`

Every other clause in those six is reproduced verbatim. `strides-5x1` is expected to touch
confidence requirements in this same capability; per CLAUDE.md, two in-flight MODIFIED blocks on
one requirement clobber each other silently, so if that change touches any requirement on this
list, reconcile against the archived-first version rather than trusting archive order.

**Deliberately NOT modified**: the per-metric requirements that describe a metric "applying a
per-view confidence multiplier from `viewFitTable.X` (`side: 1.0`, `front: 0.85`,
`ambiguous: 0.6`)" and similar. Those statements are incomplete after this change (an
uncommitted clip applies a blend of the three), not false — the rows remain the table's contents
and the endpoints of every blend, and each such requirement's scenarios are view-specific and stay
true as written. The added requirement states the precedence explicitly, once, rather than
repeating a caveat into eight requirement bodies and multiplying the clobber surface by four.

`analysis-diagnostics` needs no delta: it already requires the `FormHeuristicsResult.view` object
to be surfaced verbatim, so the new `plausibility` field rides along under the existing
requirement.

## D7 — Predicted effect per reference clip

| clip | today | after | why |
|---|---|---|---|
| Demo 1 (side, `confidence` 0.774) | — | **no change, provably** | both signals inside side's regions -> one-hot side -> table returned by reference |
| multiperson (side, 0.753) | — | **no change, provably** | same |
| Demo 2 (front, 0.0771) | armSwing 0.977, stepWidth 1.000, five sagittal excluded | **no change** | BSR 0.5507 >= 0.55 and SER 0.3389 <= 0.40 -> one-hot front |

So the headline clip does not move, and that is the finding, not an oversight — see D9. The
change is observable on any clip whose signals land in an undecided band, of which the repo
currently has none. A clip 0.13% to the other side of Demo 2's BSR — today `'ambiguous'`, with
`armSwingSymmetry` and `stepWidth` hard-excluded as structurally unmeasurable — now reports both,
at a multiplier of ~0.997 rather than at the flat 0.2 the ambiguous row would have given them.

Evidence coverage follows view fit through `metricTier`, so on such a clip a metric that gains a
card also gains an evidence section. Not observable on the three reference clips for the same
reason as above.

## D8 — The BSR margin ceiling is real (verified, filed, NOT fixed here)

`marginAwayFromZero(value, threshold)` reaches 1.0 only at `2 * threshold`, i.e. BSR 1.10 for the
front branch. BSR is `(shoulderSpread + hipSpread) / (2 * torsoLengthPx)` over pose-model keypoints
— shoulders near the acromion, hips at the hip JOINT CENTRES, which are far narrower than external
hip breadth:

    biacromial keypoint separation          ~0.33-0.41 m
    hip-joint-centre separation             ~0.16-0.22 m
    torso length (shoulder-mid to hip-mid)  ~0.47-0.52 m
        -- measured in this repo as torsoMeters 0.5041 (Demo 1) and ~0.47 (Demo 2)

    dead-on front, central estimate: (0.37 + 0.18) / (2 * 0.49) = 0.561
    dead-on front, generous bound:   (0.41 + 0.22) / (2 * 0.47) = 0.670

So `frontViewMinBilateralSpreadRatio` 0.55 sits essentially AT the anatomical ceiling of the
signal, and the margin's saturation point is about twice a value no runner can produce. The front
BSR margin therefore tops out at 0.020 (central) to 0.218 (generous), and a PERFECT front view
(SER 0, coverage 1) tops out at `((0.020..0.218) + 1) / 2` = **0.510 to 0.609** — structurally
below the 0.7 the results view calls "High confidence". Demo 2, a genuinely dead-on front
approach, measures BSR 0.5507, right at the central estimate: empirical corroboration that the bar
sits at the ceiling rather than below it.

The side branch has no such problem: `marginTowardZero(BSR, 0.30)` reaches 1 at BSR 0 (a true side
view collapses left and right together — the synthetic fixture reads 0.04, margin 0.87), and
`marginAwayFromZero(SER, 0.80)` saturates at SER 1.6, an ankle excursion a running stride does
reach. Hence 0.774 and 0.753 on the two side clips against 0.0771 on the front one — a property of
the formula, not of the footage.

Filed as **`strides-2iw`**, deliberately not folded in. It is a calibration question about a
scalar this change stops gating on, and it has a live consequence of its own:
`fuseFormHeuristicsResults` picks a multi-clip session's reported view by highest
`view.confidence`, so a mixed-view session systematically reports the side clip's view whichever
classification is better supported.

## D9 — What this change does NOT do, and why that is the right answer

The ticket's acceptance criterion asks that Demo 2's `armSwingSymmetry` and `stepWidth` stop
reading "High confidence". **They do not, and should not.**

The premise — that a 0.0771 view confidence means the classification is untrustworthy — does not
survive the arithmetic in D1 and D8. That number is a broken measurement of a marginal *front*
label, on a scale that cannot read high for any front view at all; it is not a measurement of
doubt between views. On the question that governs `armSwingSymmetry` — could this be a side view,
where the far arm is occluded and superimposed? — the data is unambiguous: no. Both of side
view's conditions fail by more than 2x. Reporting arm swing symmetry at high confidence from a
front view with full frame coverage is the correct behaviour, and the earlier verdict that
deleting it "would be a regression, not a fix" is what the plausibility arithmetic independently
concludes.

What was actually wrong on that clip is the *cliff it is standing on*: 0.13% less BSR and the
identical footage loses `armSwingSymmetry` and `stepWidth` entirely, to an exclusion that claims
the camera geometry cannot support a measurement the camera geometry plainly supports. That cliff
is removed. The structural half of the acceptance criterion is met in full and by construction:
after this change the exclusion and the discount are resolved from one distribution, so a
genuinely uncertain view degrades everything coherently and can no longer hard-exclude one metric
while granting another 1.0.

Tuning Demo 2 under 0.7 would have required inventing a coefficient whose only justification is
that it produces the requested number on one clip. That is the trap this repo has twice written
down, and it is declined here.
