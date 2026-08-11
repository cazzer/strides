## Why

Issue #18 (parent: #16, partial) asks for a cadence metric — steps per minute, both legs
combined — alongside the three existing form heuristics (vertical oscillation, trunk lean,
overstriding). Cadence is one of the most commonly cited running-form numbers runners already
know how to interpret (roughly 170-190 steps/min is the usual "good" range cited in running
coaching), and unlike the other three metrics it requires no new detection primitive: ticket #17
already extracted `detectFootstrikes(frames, config)` out of `overstriding.ts` specifically to
unblock this ticket (and the future foot-strike-pattern ticket) without reimplementing ankle-y
footstrike detection. This change is purely "divide an existing count by an existing duration,"
plumbed through the same `compute<Metric>(frames, view, config) => MetricResult` shape every
other heuristic already follows.

## What Changes

- Add `src/heuristics/cadence.ts`: `computeCadence(frames, view, config) => MetricResult`, using
  `detectFootstrikes` directly (no reimplemented footstrike detection) and clip duration derived
  from `frames[frames.length - 1].timestamp - frames[0].timestamp` (real playback time, per
  `RobustPoseFrame.timestamp` already being `video.currentTime` — holds regardless of playback
  rate).
- Extend `src/heuristics/types.ts`: add `'cadence'` to `MetricId`, add `'stepsPerMinute'` to
  `MetricResult['unit']`, extend `FormHeuristicsResult` with a `cadence: MetricResult` field, add
  a `cadence` entry to `DEFAULT_VIEW_FIT_TABLE` (view-tolerant, following vertical oscillation's
  pattern rather than trunk lean/overstriding's hard side-view gate — see `design.md` for why).
- Wire `computeCadence` into `computeFormHeuristics` in `src/heuristics/index.ts`, so cadence is
  computed under the same once-per-clip detected view as the other three metrics.
- Add a `cadence: 'Cadence'` entry (plus a description) to `MetricsPanel.tsx`'s label/description
  maps and render a fourth `MetricCard` for it; add a `'stepsPerMinute'` case to `formatValue` so
  it displays as e.g. "172 steps/min" instead of raw ratio/degree formatting.
- Unit tests in `src/heuristics/cadence.test.ts`: a clean side-view clip with a resolvable
  cadence close to the fixture's requested rate, a front-view and an ambiguous-view clip
  (view-tolerant, discounted confidence, non-null value), too few footstrikes (null value,
  explicit caveat, no crash), no body-scale reference at all, and a zero-duration single-frame
  clip (no crash, null value, no NaN/Infinity).
- Extend the shared fixtures in `index.test.ts`, `MetricsPanel.test.tsx`, `ResultsView.test.tsx`,
  and `useVideoAnalysis.test.ts` that construct a full `FormHeuristicsResult` to include the new
  `cadence` field.

## Capabilities

### New Capabilities

<!-- none: cadence is a new requirement on the existing form-heuristics capability, not a new capability -->

### Modified Capabilities

- `form-heuristics`: adds a fourth metric, cadence (steps/min), computed via the shared
  `detectFootstrikes` primitive and gated by a new `viewFitTable.cadence` entry. Does not change
  any existing requirement's behavior — vertical oscillation, trunk lean, overstriding, and view
  detection are untouched.

## Impact

- New file: `src/heuristics/cadence.ts` + `src/heuristics/cadence.test.ts`.
- Modified: `src/heuristics/types.ts`, `src/heuristics/index.ts`, `src/results/MetricsPanel.tsx`
  (plus its test), and the four other test files that build a full `FormHeuristicsResult` fixture
  (`src/heuristics/index.test.ts`, `src/results/ResultsView.test.tsx`,
  `src/results/useVideoAnalysis.test.ts`).
- No new runtime dependencies. No changes to `overstriding.ts`, `verticalOscillation.ts`,
  `trunkLean.ts`, or `footstrikes.ts`'s own logic.
- `FormHeuristicsResult` gains a required `cadence` field — any other in-flight branch that
  constructs one by hand (rather than via `computeFormHeuristics`) will need the same fixture
  update; expected to surface as a routine merge conflict, not a design problem, per the parallel
  knee-flexion/arm-swing-symmetry/foot-strike-pattern tickets touching the same shared files.
