# Tasks

## 1. Confirm or refute the hypothesis before changing anything

- [x] 1.1 Add a temporary `[armswing-probe]` dev-only line (add/measure/revert) dumping each side's
      series, confirmed extrema, half-swing spacings and amplitudes, and a spectral fit of the same
      series
- [x] 1.2 Drive all three clips, 3 trials, **fresh Chromium process per trial**, real GPU
- [x] 1.3 Confirm the extremum scan fragments below a half-cycle on Demo 2 (9 half-swings against
      ~4.8 real ones; spacings down to 0.050 s against a 0.331 s half-cycle) — **confirmed**
- [x] 1.4 Measure the halved "stride band" alternative on all three clips — **rejected**, it lands
      on the grid floor on two of them (design D3)
- [x] 1.5 Revert the probe (`src/heuristics/armSwingProbe.experimental.ts` deleted, no probe call
      left in `armSwingSymmetry.ts`)

## 2. Implementation

- [x] 2.1 `computeSideSwing` fits `fitSpectralSinusoid` over the per-side wrist-relative-to-shoulder
      trace on the shared frequency grid, replacing `findLocalExtrema` + median pairing
- [x] 2.2 Drop the `estimateBodyScale` dependency — the ratio is scale-free (design D6)
- [x] 2.3 Add the cross-side frequency-agreement check (`MAX_SIDE_FREQUENCY_DISAGREEMENT`) and its
      null branch (design D4)
- [x] 2.4 Swap `armSwingMinProminenceRatio` for `armSwingMinFitR2` in `HeuristicsConfig` and its
      default; gate on the WEAKER side
- [x] 2.5 Confidence: weakest-side `interpolatedFraction` (was pooled), weakest-side observed
      cycles against `MIN_ARM_SWING_CYCLES = 2`, plus a `fitQuality` ramp on the weaker R²
- [x] 2.6 Add the side-fit-disparity caveat (`SIDE_FIT_QUALITY_DISPARITY_R2`)
- [x] 2.7 Build the exemplar pair from the fitted phase via `selectBounceInstants`
      (`maximumIs: 'lowest'`), score on detection alone

## 3. Tests

- [x] 3.1 Extend the fixture generator with deterministic jitter and a step-rate harmonic
- [x] 3.2 Regression test that the retired prominence scan really does mis-space its pairs on that
      fixture (asserted against `findLocalExtrema` directly, so it pins the mechanism)
- [x] 3.3 Exemplar pair spans one half-swing, within one frame interval
- [x] 3.4 Reported ratio tracks the fixture's real amplitude ratio through harmonic + jitter
- [x] 3.5 Rhythm mismatch between the two arms yields null
- [x] 3.6 One arm unfittable yields null, never a fabricated asymmetry
- [x] 3.7 Confidence reads the worse arm and caveats the disparity
- [x] 3.8 Below-gate behaviour via an `armSwingMinFitR2` override
- [x] 3.9 A clip with no resolvable torso is still measured

## 4. Verification

- [x] 4.1 `npx tsc -b` clean
- [x] 4.2 `npx eslint src/` clean
- [x] 4.3 `npx vitest run` — 1219 passed, 0 failed
- [x] 4.4 Live, 3 fresh-process trials per clip, real GPU, all three clips — before and after
- [x] 4.5 Regression anchor re-checked (Demo 1 `verticalOscillationCm` 4.421467928439415,
      `fitHz × 60` = cadence = 91.2, `subjectAgreement` 52/53)
- [x] 4.6 `openspec validate fit-arm-swing-amplitude --strict`

## 5. Follow-ups filed, not done here

- [x] 5.1 `strides-9c9` — the sub-144-spm band floor (design D3) — arm swing sits at half the step rate, and the
      shared grid's 1.2 Hz floor was sized for the per-step bounce
- [x] 5.2 `strides-56e` — Demo 2's remaining measurement/form split (design D5) — the near/far keypoint-quality
      confound is now disclosed rather than resolved, and resolving it needs footage where the
      runner passes at a constant distance
