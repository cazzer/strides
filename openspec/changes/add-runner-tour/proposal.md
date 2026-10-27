## Why

The guided results page sets each of thirteen metrics against a cited band, one card at a time.
A runner asking "what should I look at, and is there one thing to change?" still has to read all
thirteen. The runner-led results PRD (`docs/prd/runner-led-results-research.md`) groups the metrics
by body region and walks them as a short tour that ends on at most one cue. This change adds the
pure data layer for that tour (`strides-trn2.1`); the tour and summary views that render it are
later tickets (`strides-trn2.2`, `.3`, `.5`).

## What Changes

- `src/guidance/focusAreas.ts`: six focus areas in fixed tour order (rhythm, arms, posture, knees,
  landing, foot path), each owning a fixed set of metrics in headline-preference order, and
  `focusAreaView` to pick an area's headline and supporting metrics from a fused result.
- `src/guidance/feedbackPoints.ts`, which gives each area:
  - a *cue*: an existing Try line, shown only where a normal-tier value is past its cited band on
    the costly side;
  - a cited *why* line, keyed to the cue's metric (or to the headline when there is no cue);
  - a cited *non-point* where the evidence says not to change.

  It also provides `selectOneThing`. That returns the first area cue in priority order. It reports
  "nothing to change" only when every cue-capable metric was measured at the normal tier, and
  otherwise reports an unclear state with a reason.
- `src/guidance/bandApplicability.ts`: `tryLineApplies`, `renderableBand`, `sourceHasProvenance`,
  `pastCostlySide` and `GuidedEntry`, moved down from `src/results` and re-exported there.
- Tests pinning every URL, the word budgets, the no-grading rule and the one-thing rules.
- `docs/prd/runner-led-results-research.md` gains the verified Arellano & Kram 2011 citation that
  the step-width non-point rests on.

## Capabilities

### New Capabilities

- `runner-feedback`: focus-area grouping and cited feedback points (why, cue, non-point, one thing).

## Impact

No UI, no change to `src/heuristics/**`, to any band, or to any Try line text. `src/guidance`
imports nothing from `src/results` or `src/runner`; `src/results` re-exports what moved.
