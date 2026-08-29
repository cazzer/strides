# Propagate view confidence to metric gating

## Why

`computeFormHeuristics` runs `detectView` and then passes only `view.view` — the LABEL — to all
eleven metrics. `view.confidence` is stored on the result for diagnostics and read by nothing. The
view classification's own certainty therefore never reaches the decision it exists to inform, and
the gate is a cliff: a metric flips between "structurally unmeasurable, no value shown at all" and
"High confidence" on which side of a threshold one signal lands, with nothing in between.

Measured live on the front-approach demo clip (`park-approach.mp4`, 3 trials, bit-identical):
`view.view = 'front'` at `view.confidence = 0.0771`, and on the strength of that one label the
panel simultaneously hard-excludes five sagittal metrics and reports `armSwingSymmetry` at 0.977
and `stepWidth` at 1.000.

**The naive fix — multiplying metric confidence by `view.confidence` — is wrong, and this clip is
the proof.** That scalar is `((bsrMargin + serMargin) / 2) * sampleCoverage`, a distance PAST A
THRESHOLD, not a comparison between views. Its 0.0771 is dominated by BSR sitting 0.13% above
`frontViewMinBilateralSpreadRatio`:

    BSR 0.5507 vs front bar 0.55  ->  (0.5507 - 0.55) / 0.55  = 0.0013
    SER 0.3389 vs front bar 0.40  ->  (0.40 - 0.3389) / 0.40  = 0.1528
    mean 0.0771 * coverage 1.0    =  0.0771     (reproduces the observed number exactly)

Side view, meanwhile, is ruled out twice over on the same clip: it needs BSR <= 0.30 (measured
0.55) AND SER >= 0.80 (measured 0.34), failing both by more than 2x. Degrading `armSwingSymmetry`
toward its `ambiguous` row there — which is what a `view.confidence` multiplier does — would
EXCLUDE a metric whose own evidence images plainly show both arms, on the theory that the clip
might be a side view the geometry positively excludes.

The honest quantity for gating is which views the data supports, not how far past its own bar the
winning label sits. This change derives that from the two signals view detection already computes,
and gates on it.

## What Changes

- `detectView` additionally returns `plausibility: ViewPlausibility` — how much the clip's own
  geometry supports each of `side`, `front` and `ambiguous`, summing to 1. Its existing `view`
  label, `confidence` scalar, vote logic and margin arithmetic are **untouched**.
- `computeFormHeuristics` resolves the config's `viewFitTable` against that plausibility once and
  hands every metric the resolved table plus the most plausible view. The `fit` a metric reports
  and the multiplier it applies now come from the same distribution, so they can no longer disagree
  about how certain the view is.
- No metric module changes. The resolution lands on the table every metric already reads, not on
  eleven call sites.
- **Clips that commit to a label are bit-identical, by construction.** Committing requires both
  signals strictly inside one view's regions, which is exactly when the plausibility is one-hot on
  that same label; resolving against a one-hot distribution is the identity, and those clips reach
  every metric with the caller's own config object and the same label as before. All three
  reference clips (Demo 1 side, Demo 2 front, multiperson side) are in that set.
- The behaviour change is confined to clips that read `'ambiguous'` today. They stop being gated by
  a flat all-or-nothing row and are graded instead: a clip that rules out side but falls short of
  the front bar keeps its front-primary metrics, discounted for the residual doubt, rather than
  losing them entirely.

## Impact

- Affected specs: `form-heuristics` (2 added requirements, 6 modified — see `design.md` D6 for the
  reconciliation list, which a parallel change touching this capability must read).
- Affected code: `src/heuristics/viewPlausibility.ts` (new), `src/heuristics/viewDetection.ts`,
  `src/heuristics/index.ts`, `src/heuristics/types.ts`. Ten test files gain a `plausibility` field
  in their `ViewDetectionResult` fixtures.
- `[analysis-diagnostics]`'s `view` object gains `plausibility` by verbatim pass-through — the
  existing "surfaced verbatim" requirement already covers it, so no `analysis-diagnostics` delta.
- **Blast radius to state up front**: view fit drives `metricTier`, which drives which metrics are
  `metric-excluded`, which drives evidence coverage totals. On any clip whose label is `'ambiguous'`
  those totals will move — a previously-excluded metric gaining a card gains an evidence section.
  None of the three reference clips is in that set, so their coverage should not move at all.
- Not addressed here, filed as `strides-2iw`: `view.confidence` itself is not comparable between a
  side and a front label, because the BSR margin saturates at roughly twice the anatomical maximum
  of the signal. Nothing gates on it after this change; it remains a diagnostic, and
  `fuseFormHeuristicsResults` still tie-breaks a multi-clip session's reported view on it.
