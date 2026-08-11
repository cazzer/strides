## Why

Issue #19 (parent: #16, partial) asks for a fourth running-form heuristic: knee flexion, the
hip-knee-ankle joint angle, for both legs. All three keypoints it needs
(`left_hip`/`left_knee`/`left_ankle` and their right-side equivalents) already exist in
`COMMON_KEYPOINT_NAMES` and flow through `RobustPoseFrame` — no pipeline changes are needed, only
a new metric module in the existing `form-heuristics` capability. Unlike vertical oscillation's
amplitude or trunk lean's angle, a raw per-frame hip-knee-ankle angle isn't itself a single
clip-level "form" number — the issue explicitly calls out that this needs a design decision (which
representative statistic to report, and why) before or alongside implementation. That decision is
made and documented in `design.md`.

## What Changes

- Add `src/heuristics/kneeFlexion.ts`: `computeKneeFlexion(frames, view, config)`, matching the
  existing metric-module shape (`trunkLean.ts`/`overstriding.ts`). Computes a per-leg,
  per-frame hip-knee-ankle joint angle (via a new shared `angleBetweenVectorsDeg` primitive in
  `mathUtils.ts`), converts it to degrees of flexion from full extension, finds each leg's
  swing-phase peak-flexion cycles via the existing gap-aware `findLocalExtrema`, and reports the
  clip-level `value` as the median of both legs' pooled peaks. Hard-gated to side view (front view
  foreshortens the sagittal-plane angle), same policy as trunk lean/overstriding — still computed
  and returned, never withheld, with confidence capped low and a caveat when the view is
  unsuitable.
- Add `src/heuristics/kneeFlexion.test.ts`: a clean clip with resolvable flexion, insufficient/
  unresolvable data → `null` value + caveat, and view-unsuitable gating.
- Extend `src/heuristics/mathUtils.ts` with `angleBetweenVectorsDeg`, an atan2-based three-point
  joint-angle primitive (matching the atan2 style `trunkLean.ts` already uses, rather than
  law-of-cosines/`acos`), reusable by any future joint-angle metric.
- Extend `src/heuristics/types.ts`: add `'kneeFlexion'` to `MetricId`, add `kneeFlexion:
  MetricResult` to `FormHeuristicsResult`, add a `kneeFlexion` entry to `DEFAULT_VIEW_FIT_TABLE`
  (side-primary, front/ambiguous-unsuitable — same table shape as trunk lean/overstriding), and add
  `kneeFlexionMinProminenceDegrees` to `HeuristicsConfig`/`DEFAULT_HEURISTICS_CONFIG`.
- Wire `computeKneeFlexion` into `computeFormHeuristics` in `src/heuristics/index.ts`.
- Add a `kneeFlexion` entry to `METRIC_LABELS`/`METRIC_DESCRIPTIONS` and render a fourth
  `MetricCard` in `src/results/MetricsPanel.tsx`, so the new metric shows up in the results view.
- Update existing `FormHeuristicsResult` test fixtures (`MetricsPanel.test.tsx`,
  `ResultsView.test.tsx`, `useVideoAnalysis.test.ts`) to include the new required field.

## Capabilities

### New Capabilities

<!-- none: this extends the existing form-heuristics capability with a fourth metric -->

### Modified Capabilities

- `form-heuristics`: adds a fourth heuristic (knee flexion) to the set of metrics
  `computeFormHeuristics` returns, with its own view-fit gating and confidence policy, following
  the same requirements the capability already establishes for the other three metrics (output
  contract, view-fit table structure, orchestration).

## Impact

- New file: `src/heuristics/kneeFlexion.ts`, `src/heuristics/kneeFlexion.test.ts`.
- Modified files: `src/heuristics/mathUtils.ts`, `src/heuristics/types.ts`,
  `src/heuristics/index.ts`, `src/results/MetricsPanel.tsx`, and the three test files listed above
  (fixture updates only — no behavior change to what they test).
- No new runtime dependencies, no pipeline/keypoint changes.
