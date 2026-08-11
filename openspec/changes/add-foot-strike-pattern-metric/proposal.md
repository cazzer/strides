## Why

Issue #21 (parent: #16, partial) asks for a fourth running-form indicator: foot strike pattern
(heel / midfoot / forefoot). This pipeline has no toe/foot keypoint and no ground-plane
calibration anywhere — the same gap `overstriding.ts`'s footstrike-detection doc already documents
for "ground contact" (12-keypoint set stops at the ankle, per #3). A real strike-pattern
classification, which needs the foot's angle relative to the ground at the instant of contact,
isn't possible from this input. This change implements a documented, explicitly-labeled **proxy**
instead: at each footstrike (reusing `detectFootstrikes`, shared with overstriding), classify
based on where the ankle sits relative to the same-side knee, in the direction of travel — an
ankle notably ahead of the knee reads as heel-strike-like, roughly under the knee reads as
midfoot-like, notably behind reads as forefoot-like. Per the issue's explicit, hard requirement,
this must ship with a `caveat` that is non-null on every returned result, including the cleanest,
highest-confidence one — every other metric in this package only populates `caveat` for
degraded/low-confidence cases, and that pattern must not be copied here.

## What Changes

- Add `src/heuristics/footStrikePattern.ts`: `computeFootStrikePattern(frames, view, config)`,
  matching the existing metric-module shape (`overstriding.ts` is the closest reference — same
  footstrike-timing + travel-direction + torso-normalization pattern), plus an exported
  `classifyFootStrike(ratio, midfootBandRatio)` helper so presentation code can turn the returned
  numeric ratio back into a heel/midfoot/forefoot label without duplicating the threshold logic.
- Extend `src/heuristics/types.ts`: add `'footStrikePattern'` to `MetricId`, a
  `footStrikePattern: MetricResult` field on `FormHeuristicsResult`, a `footStrikePattern` entry in
  `DEFAULT_VIEW_FIT_TABLE` (side-view-primary, hard-gated like `trunkLean`/`overstriding`), and a
  new `footStrikeMidfootBandRatio` config knob (default `0.05`) plus a doc-comment on
  `MetricResult.caveat` flagging `footStrikePattern` as the one deliberate exception to "caveat
  only populated when degraded".
- Wire `computeFootStrikePattern` into `computeFormHeuristics` in `src/heuristics/index.ts`.
- Add `footStrikePattern: 'Foot strike pattern'` (plus a description and a proxy-aware value
  formatter) to `src/results/MetricsPanel.tsx`, and render a fourth metric card, so the
  approximation is visible in the UI rather than only in code — including the always-present
  caveat text.
- Update `src/results/MetricsPanel.test.tsx`, `src/results/ResultsView.test.tsx`,
  `src/results/useVideoAnalysis.test.ts`, and `src/heuristics/index.test.ts` for the new
  `FormHeuristicsResult` field, including a dedicated assertion that the foot-strike-pattern card's
  caveat renders even in an otherwise-clean, unflagged result.
- Add `src/heuristics/footStrikePattern.test.ts`: synthetic heel/midfoot/forefoot classification,
  insufficient-footstrikes and no-body-scale null cases, front-view gating, and an explicit
  consolidated test asserting `caveat` is non-null across every one of those cases, including the
  clean/high-confidence one — the guardrail for this change's hard requirement.
- Document the exact proxy design (why the knee and not the hip, why a symmetric band, why `0.05`)
  in `design.md`.

## Capabilities

### New Capabilities

<!-- none: footStrikePattern is a new metric within the existing form-heuristics capability, not
     a new capability of its own -->

### Modified Capabilities

- `form-heuristics`: adds a fourth metric, foot strike pattern, computed as an explicit
  ankle-relative-to-knee proxy at each detected footstrike, hard-gated to side view, with a
  caveat that is unconditionally non-null (a new, documented exception to this capability's
  existing "caveat only for degraded results" convention).

## Impact

- New file: `src/heuristics/footStrikePattern.ts` (+ its test file).
- Modified: `src/heuristics/types.ts`, `src/heuristics/index.ts`, `src/results/MetricsPanel.tsx`,
  plus the test files listed above that construct `FormHeuristicsResult` fixtures.
- No new runtime dependencies. No change to `RobustPoseFrame`, `detectFootstrikes`, or any other
  existing metric's behavior or output shape.
- Reviewer note carried over from the issue: this must not read, in code or in the UI, as if it
  were a real foot-strike classification. The always-non-null caveat is the guardrail for that.
