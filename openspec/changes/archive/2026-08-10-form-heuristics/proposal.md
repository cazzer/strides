## Why

The robustness layer (#5) turns raw pose detection into a gap-tolerant `RobustPoseFrame[]`
stream, but a stream of keypoint positions isn't a running-form assessment yet. Someone has to
turn "where the shoulders/hips/ankles were, frame by frame" into the numbers a runner cares
about — bounce, lean, whether the foot lands ahead of the hip — without knowing a priori whether
the clip was shot from the side or head-on. Getting that camera-angle question wrong silently
would be worse than not answering it: a trunk-lean or overstride number from a front-view clip
isn't just noisier, it measures a different physical quantity than the one displayed, since the
sagittal-plane motion those heuristics need is invisible in that framing. This change owns that
biomechanics judgment call end to end — view classification, the three heuristic formulas, every
constant — and documents the reasoning so it's reviewable and tunable later, not an opaque
threshold buried in code.

## What Changes

- Add `src/heuristics/types.ts`: `View`, `ViewFit`, `MetricId`, `ViewDetectionResult`,
  `MetricResult`, `FormHeuristicsResult`, `HeuristicsConfig` (including the per-metric
  view-fit table), and their default values/constants.
- Add `src/heuristics/keypoints.ts`: `resolveMidpoint` (tolerant single-side fallback, for
  center-of-mass proxies) and `resolveBilateralPair` (strict both-sides-required, for signals
  where the left/right separation itself is the measurement) — plus `resolvePoint`, a small
  shared single-keypoint accessor both of the above (and view detection's per-side signal) build
  on.
- Add `src/heuristics/bodyScale.ts`: `estimateBodyScale`, the shared torso-length normalizer used
  by view detection and all three heuristics.
- Add `src/heuristics/travelDirection.ts`: `estimateTravelDirection`, resolving forward/backward
  from net hip-x displacement, with an explicit indeterminate (`0`) case for treadmill/in-place or
  front-view footage.
- Add `src/heuristics/extrema.ts`: `findLocalExtrema`, a gap-aware, prominence-thresholded
  min/max finder shared by vertical oscillation (hip-y bounce) and overstriding (ankle-y
  footstrike proxy).
- Add `src/heuristics/confidence.ts`: `computeMetricConfidence`, the shared confidence formula
  (product of view-fit, coverage, interpolation, and sample-size penalty factors).
- Add `src/heuristics/viewDetection.ts`: `detectView`, classifying a clip as `'side'`, `'front'`
  (meaning front-or-back — no face keypoints exist in this pipeline), or `'ambiguous'` from two
  independent geometric signals that must agree before committing to a label.
- Add `src/heuristics/verticalOscillation.ts`, `src/heuristics/trunkLean.ts`,
  `src/heuristics/overstriding.ts`: the three heuristics, each returning a `MetricResult` with a
  value, a confidence, and a view-fit-derived degradation policy — vertical oscillation is
  view-tolerant (a discounted but still-computed number in front view); trunk lean and
  overstriding are hard-gated to side view (still computed and returned, never hidden, but
  confidence capped low with an explicit caveat).
- Add `src/heuristics/index.ts`: `computeFormHeuristics`, the orchestrator that runs view
  detection once and feeds its result into all three metrics, so ticket #8 makes one ordered call
  instead of four.
- Add `src/heuristics/__fixtures__/syntheticGait.ts`: a parametric sinusoidal-gait generator
  producing view-consistent `RobustPoseFrame[]` fixtures with hand-computable expected outputs.
- Unit tests per module (see `tasks.md`), including a clean side-view sequence sane across all
  three metrics, a front-view sequence correctly gating/discounting the view-inappropriate
  metrics, and a heavily-interpolated/unrecoverable sequence (built via the real
  `applyRobustness`, not hand-authored) showing visibly reduced confidence without crashing.
- No UI, no live polling loop, no results-view rendering — this is a pure batch computation,
  `RobustPoseFrame[]` in, `FormHeuristicsResult` out. Ticket #8's job.

## Capabilities

### New Capabilities

- `form-heuristics`: view classification (side/front/ambiguous) from keypoint geometry, plus
  three running-form heuristics (vertical oscillation, trunk lean, overstriding) computed from the
  robustness layer's output, each with a documented view-applicability policy, a confidence score
  derived from view-fit/coverage/interpolation/sample-size, and a contract that never throws and
  never returns `NaN`.

### Modified Capabilities

<!-- none: form-heuristics is additive, it doesn't change pose-robustness's existing contract -->

## Impact

- New code only, under `src/heuristics/**`; no existing files change.
- No new runtime dependencies.
- Establishes the `FormHeuristicsResult` contract that the results-view ticket (#8) will consume.
- Every biomechanical formula, threshold, and constant introduced here is documented with its
  reasoning in `design.md` — this ticket is explicitly the one that owns those judgment calls, per
  the issue's own framing.
