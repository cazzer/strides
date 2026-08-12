## Why

Issue #30 (epic #27). Two coupled gaps:

**(a) Head keypoints are discarded at the adapter boundary.** `COMMON_KEYPOINT_NAMES`
(`src/pose/types.ts`) is a hardcoded 12-entry limb-only list; `toPoseFrame`
(`src/pose/backends/common.ts`) silently drops MoveNet's/MediaPipe's nose/eyes/ears before
robustness or heuristics ever see them. Every downstream consumer (confidenceFilter, interpolate,
analysisDiagnostics, the skeleton overlay) is already name-driven off `COMMON_KEYPOINT_NAMES`
rather than hardcoding "12" as a magic number, so widening the list is close to free — verified in
this change (see design.md D1) rather than assumed.

**(b) Vertical oscillation's hip-mid signal has a plausible, untested alternative.** Prior
investigation (test4-headbob.json, cited in issue #30) found ear-mid bounce roughly half hip's
run-to-run spread on both evaluated clips (track 7.7% vs. 18.3%; park 13.0% vs. 23.3%), ≥99%
coverage in both views, and a 0.80–0.92 damping ratio versus hip. That's promising enough to be
worth a real integration-level A/B, not promising enough to switch the default on ad-hoc evidence
— head bounce is a physically different quantity (not a center-of-mass proxy) from pelvis bounce,
so flipping the default has real cost if the earlier signal doesn't hold up end-to-end.

This change widens the keypoint surface, makes the vertical-oscillation input signal selectable
via `HeuristicsConfig`, and decides the shipped default from a live, paired, multi-trial A/B
against both demo clips — recorded in design.md with the actual numbers, not the prior
investigation's numbers.

## What Changes

- **`COMMON_KEYPOINT_NAMES` widens from 12 to 15**: `nose`, `left_ear`, `right_ear` appended
  (never interleaved, so existing positional assumptions about the original 12 are undisturbed).
  `PoseFrame`/`RobustPoseFrame`'s keypoints-array docstrings become count-free ("one entry per
  name in COMMON_KEYPOINT_NAMES, in that fixed order, never sparse") rather than asserting a
  literal "12", since the actual invariant downstream code (`interpolate.ts`'s positional
  index-join, most load-bearingly) depends on is "matches COMMON_KEYPOINT_NAMES", not any
  particular count.
- **Skeleton overlay renders the head**: `SKELETON_EDGES` gains a head triangle (`left_ear`-`nose`,
  `right_ear`-`nose`) and two neck anchors (`left_ear`-`left_shoulder`, `right_ear`-`right_shoulder`)
  — three otherwise-floating dots would read as a rendering artifact, not a head. Unrecoverable
  ears already skip every edge touching them via the existing per-endpoint skip rule; no new logic
  needed there.
- **`syntheticGait.ts`'s test fixture gains a head model**: nose/ears as a rigid unit above the
  shoulders, phase-locked to the hip bounce but with its own damped amplitude
  (`headBounceDamping`, default 0.85), so `earMid`'s expected vertical-oscillation value stays
  hand-computable in tests (`verticalBouncePx * headBounceDamping / TORSO_LENGTH_PX`).
- **`hipBounce.ts`'s extractor generalizes to take a keypoint pair**: `analyzeBounceSignal(frames,
  config, pair)` replaces the single-purpose hip-only traversal, defaulting to the hip pair.
  `analyzeHipBounce(frames, config)` stays as a thin hip-pinned wrapper so cadence's call site
  (`cadence.ts`) is unchanged — cadence never varies the pair, by design (see Boundaries below).
- **New `HeuristicsConfig.verticalOscillationSignal: 'hipMid' | 'earMid'`** (default `'hipMid'`,
  pending the A/B below). `computeVerticalOscillation` resolves
  `SIGNAL_KEYPOINTS[config.verticalOscillationSignal]` and passes it to `analyzeBounceSignal`. No
  per-frame fallback between signals ever: an unresolvable configured signal contributes nothing
  to a given frame (null in `series`, absent from the fit) rather than silently substituting the
  other signal, which would inject step/amplitude discontinuities that corrupt `sinusoidR2`
  nondeterministically. `resolveMidpoint`'s existing tolerant single-side fallback stays intact
  WITHIN whichever signal is configured (one ear/hip standing in for its pair, flagged
  interpolated).
- **Default decided by a pre-registered rule**, applied to a live paired A/B (both demo clips, ≥3
  trials/signal/clip, real GPU, MoveNet) run AFTER the rule is written — see design.md D4 for the
  rule and the resulting numbers/decision.
- **`verticalOscillationCm` and `cadence` are unaffected** — both stay unconditionally hip-based
  regardless of `verticalOscillationSignal`, pinned by regression tests (T10/T11 in design.md's
  test plan).

## Impact

- Affected specs: `pose-detection` (keypoint count/subset requirements), `pose-robustness`
  (per-keypoint count language, reworded count-free), `form-heuristics` (vertical oscillation's
  spectral-fit and view-tolerance requirements gain the configured-signal phrasing; new
  requirement for the signal-selection contract itself).
- Affected code: `src/pose/types.ts`, `src/pose/robustness/types.ts`,
  `src/heuristics/keypoints.ts`, `src/heuristics/hipBounce.ts`, `src/heuristics/verticalOscillation.ts`,
  `src/heuristics/types.ts`, `src/results/skeletonGeometry.ts`,
  `src/heuristics/__fixtures__/syntheticGait.ts`, plus adapter-boundary test coverage
  (`common.test.ts`, `movenet.test.ts`, `mediapipePoseLandmarker.test.ts`,
  `confidenceFilter.test.ts`, `interpolate.test.ts`).
- No change to `verticalOscillationCm.ts`, `cadence.ts`'s public behavior, `detectFootstrikes` or
  its consumers, or any broken backend (`blazepose`/`posenet` stay broken, unfixed, out of scope —
  this change only verifies the widened keypoint list doesn't change their compile-time behavior).
