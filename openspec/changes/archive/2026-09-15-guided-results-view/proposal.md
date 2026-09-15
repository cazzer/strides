# Present each metric against a cited reference band

## Why

This app measures twelve things about a runner's form and prints twelve numbers. A reader who sees
`172 steps/min` cannot tell from the page whether that is unusual, what moving it would do, or why
we measured it at all. The results view is a **readout**, not guidance — every number is delivered
with a confidence and a caveat about *our* measurement, and nothing at all about the runner.

The obvious fix — put a target next to each number — is the one thing this repo has already decided
it will not do. Bead `strides-yg8` set out to give `overstriding` an interpretive band so a
cross-clip disagreement could surface on it, and closed without one, naming *"why not just pick a
number"* explicitly: a per-metric magnitude threshold means eleven unjustifiable constants.
CLAUDE.md's **"The 4K area floor cannot be re-derived"** section is the same story told as a
measurement — a threshold measured, found inside a factor-of-2.9 squeeze, and the whole direction
abandoned rather than tuned. Inventing twelve interpretive thresholds to make a guidance page look
complete would be that mistake twelve times over.

So the governing constraint is not *"add guidance"*. It is: **a band is cited or it does not ship.**
Under that constraint five of the twelve metrics can carry a published reference range and seven
cannot, and the page has to be honest about which is which rather than hiding the gap.

## What Changes

- **A second results view**, opt-in beside the existing one at `?view=guide`, with a visible toggle.
  The classic view stays the default and is not edited.
- **Three ranked groups.** Measured with a published band (5 metrics) → expanded, ranked, with a
  scale. Measured with no defensible band (7) → collapsed, value and links but **no scale**. Not
  measured on this clip → collapsed, with the reason and a concrete capture hint.
- **A band renders its provenance on screen** — source, population and sample size — or it does not
  render. The citation is not a footnote; it is part of the band.
- **A band states a position, never a target.** "Most runners in <study> fall between X and Y", and
  nothing on the page grades the runner by colour, word or icon.
- **The speed caveat rides with the band** wherever speed moves the metric materially. This app
  cannot measure running speed, and speed moves four of the five banded metrics.
- **A metric with no band still renders** its value, its research links and its remediation links.
  Banding decides whether a **scale** renders, not whether the **metric** renders.
- **New pure module `src/guidance/`** holding the twelve-entry guidance record and the scale
  component. No React in the data layer.

## Impact

- **New**: `src/guidance/` (types, the twelve-entry record, `MetricScale`),
  `src/results/GuidedResultsView.tsx`, `src/results/guidedGroups.ts`,
  `src/results/resultsViewMode.ts`, `src/results/ResultsViewToggle.tsx`,
  `src/results/__fixtures__/metricResult.ts`.
- **One branch** at `MultiClipVideoSession.tsx`'s existing `ResultsView` call site, plus the state
  the toggle needs. Nothing else in that component moves.
- **Zero edits** to `ResultsView.tsx`, `MetricsPanel.tsx`, `src/heuristics/`, `src/pose/`,
  `src/video/`. No metric value, confidence, caveat, exemplar, crop or image changes — this change
  computes nothing. It only decides what to say about numbers the pipeline already produced.
- **New capability `guided-results-view`.** The existing `results-view` capability is untouched:
  this change writes ADDED requirements only, against a capability that does not yet exist.
