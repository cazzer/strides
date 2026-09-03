## 1. OpenSpec change

- [x] 1.1 `openspec/changes/stabilize-arm-swing-scale-before-fitting/`: `proposal.md`,
      `design.md` (D1–D6, root cause + confound correction + offline probe verification
      recorded), `tasks.md`, spec delta (`form-heuristics` MODIFIED ×4, exact existing titles).
- [x] 1.2 `openspec validate stabilize-arm-swing-scale-before-fitting --strict` passes.

## 2. Core change — scale stabilization (strides-egw)

- [x] 2.1 `src/heuristics/armSwing.ts`: private `resolveScaleStabilizer(frames)` — strict
      bilateral inter-shoulder proxy (`resolveBilateralPair`), whole-window time-centered
      log-quadratic trend, `f(t) = exp(trend(t)) / median(spans)`, no clamp; fallback ladder
      returning the CONSTANT 1 (<`MIN_SCALE_TREND_SAMPLES = 12` proxy frames; unsolvable system;
      flat trend per `FLAT_TREND_LOG_RANGE` — design D3; non-finite/non-positive factor).
      `computeSideSwing` divides each sample by `f(timestamp)` before the fit.
- [x] 2.2 Invariants held: `seriesY` null pattern / `resolvedCount` / `interpolatedCount`
      unchanged (trend evaluates at every timestamp — no sample dropped for a missing proxy);
      positive divisor preserves the `maximumIs: 'lowest'` sign convention; shared gate/policy
      constants and their placement untouched; `spectralFit.ts`, `bounceInstants.ts`,
      `bodyScale.ts`, `keypoints.ts`, `types.ts` untouched.
- [x] 2.3 Docs: module-doc "Scale stabilization before the fit" section (premise violation,
      Demo 2 120→358 px, why log space, why 3 dof), `SideSwing.seriesY` doc
      ("scale-stabilized … in px at the clip's reference scale"), `computeSideSwing` doc,
      `armSwingSymmetry.ts` "Scale-free by construction — but scale-STABILIZED per frame"
      section, `armSwingAmplitude.ts` normalizer-semantics sentence.

## 3. Caveat rewording (strides-ax3)

- [x] 3.1 `armSwingSymmetry.ts`: "One arm's swing rhythm fit its trace much less cleanly than
      the other's in this clip, so part of the difference between them may be measurement rather
      than form."
- [x] 3.2 `armSwingAmplitude.ts`: same head, tail "…so part of this overall swing size may
      reflect measurement rather than form."

## 4. Tests

- [x] 4.1 Both suites' fixture builders gain `scaleGrowthFactor` (whole-body ×g(t): shoulder
      spread, hip spread, torso, wrist offset AND wrist amplitude; exponential so the log-quad
      trend captures it exactly; `1` bit-identical to the ungrown fixture).
- [x] 4.2 `armSwingSymmetry.test.ts`: mechanism (3× growth, constant body-unit amplitudes →
      ratio matches static twin, clean fit, no caveat; raw trace's R² depressed vs stabilized);
      fallback (<12 both-shoulder frames → exact raw-pixel computation, verified against an
      independent `fitSpectralSinusoid` re-computation); constant-scale no-op pinned explicitly;
      caveat substrings updated.
- [x] 4.3 `armSwingAmplitude.test.ts`: growth value test with hand-computable expectation
      ((40+20)/(2×150) = 0.2 — clip-median torso is the same ×g as the reference scale, so the
      growth cancels); caveat substrings updated.
- [x] 4.4 Existing cases pass untouched — no assertion weakened.

## 5. Verification

- [x] 5.1 `npx tsc -b` clean; `npx eslint` clean on every touched file; `npm test` green (90
      files, 1470 tests).
- [x] 5.2 Offline replay of the strides-101 Demo 2 probe through the shipped `computeSideSwing`
      (scratch vitest file, added-measured-deleted): ratio 0.51834, both sides 1.50 Hz, weakest
      R² 0.51175 — every design-D2 prediction lands. Recorded in design D5.
- [x] 5.3 Live-browser A/B (`scripts/ab-person-selection.mjs`, fresh-process, all three clips)
      against the pre-change baseline: Demo 2 armSwingSymmetry ~0.52 / armSwingAmplitude −~7%,
      arm exemplar instants may move a frame or two; Demo 1/multiperson arm metrics stay tier-3
      EXCLUDED; every non-arm metric bit-identical; anchors hold (VO_cm 4.421467928439415,
      cadence 91.2). **Run by the orchestrator post-implementation** — passed: Demo 2
      armSwingSymmetry 0.518197 exactly as predicted, zero non-arm drift, all anchors
      bit-identical.

## 6. Review round 1 (zero must-fix, three should-fixes — design.md "Review round 1")

- [x] 6.1 The two constant-scale no-op assertions made BIT-EXACT (`toBe(rawPixelRatio(frames))`)
      so a deleted flat-trend snap cannot pass on a 1±1e-15 factor.
- [x] 6.2 Evaluation-time clamp into the fitted proxy window `[tLow, tHigh]` (factor value still
      unclamped — D3 amended); probe replay re-verified BIT-IDENTICAL post-clamp (99/99 probe
      frames carry a bilateral pair, so the clamp cannot bind on Demo 2).
- [x] 6.3 New symmetry test exercising the missing-proxy invariant on the ACTIVE rung, with
      dropped frames at the window edges so the clamp path is covered too.
