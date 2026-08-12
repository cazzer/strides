## 1. Restructure the calculation around the composition seam

- [x] 1.1 Extract the integration loop out of `estimateAmplitudes` into
      `buildMetricSeries(run, scales): SpectralSample[]`, carrying the deltas-not-absolute-positions
      doc comment across VERBATIM (only the one-line summary changes, since the function no longer
      reads amplitudes). Keeping that comment intact is what makes "the conversion is unchanged"
      reviewable at a glance.
- [x] 1.2 Leave `buildRuns`, `collectScales`, `fillRunScales` and `isUsableScale` untouched.

## 2. Swap the estimator

- [x] 2.1 Replace `findLocalExtrema` + half-cycle pairing with `fitSpectralSinusoid(samples,
      { minFrequencyHz, maxFrequencyHz, frequencyStepHz })`, one fit per integration run, grid read
      from config. Delete `CM_MIN_PROMINENCE_TORSO_RATIO` and the `findLocalExtrema` import; keep
      `median` (for the scale median) and `estimateBodyScale` (for `torsoMeters` only).
- [x] 2.2 Add `CM_MIN_FIT_R2 = 0.3` with the D3 doc at the constant: same calibration as the
      pixel/cadence keys (same hip samples, same n — MediaPipe track n=57, park n=84, inside the
      n≈50+ band), the n-regime caveat (noise floor p95 ≈ 0.34 at n=30, 0.44 at n=20, 0.64 at n=12,
      and per-run fitting can reach the 12-sample floor where this gate is NOT protective — visible
      via `fit.sampleCount`), and the deferred F-test that would replace all three gates together.
- [x] 2.3 Add `selectWeightedMedianFit(fits)` — stable sort by amplitude, first run whose cumulative
      `sampleCount × 2` reaches the total. Document the dominance property.
- [x] 2.4 Add the multi-run failure-reason arbitration: longest run's reason, ties to the earliest;
      `'no-usable-run'` when no run was ever fitted.

## 3. Signature and shape

- [x] 3.1 `computeVerticalOscillationCm(frames, config: HeuristicsConfig =
      DEFAULT_HEURISTICS_CONFIG)`. Call site (`useVideoAnalysis.ts`) unchanged — it relies on the
      default.
- [x] 3.2 `ScaleCalibratedFit` (mirrors `VerticalOscillationFit`, amplitude named
      `peakToPeakAmplitudeCm`) and `ScaleCalibratedFitFailureReason`
      (`SpectralFitFailureReason | 'below-quality-gate' | 'no-usable-run'`) exported; `fit` and
      `fitFailureReason` added to `ScaleCalibratedVerticalOscillation`, exactly one non-null.
      `sampleSize` redefined as complete bounce cycles across contributing runs.
- [x] 3.3 Module doc: which stage swapped and which did not, that the trend terms are the point,
      that `f* × 60` cross-checks cadence, and that config is read for the GRID ONLY — never for
      signal selection, which stays hip-pinned.

## 4. Documentation kept in sync

- [x] 4.1 `src/heuristics/types.ts`, doc-only: the two comments claiming this module "takes no
      config at all" (`VerticalOscillationSignal`'s doc, and `verticalOscillationSignal`'s key doc)
      reworded to the surviving claim. No config key added.
- [x] 4.2 `CLAUDE.md`'s "MediaPipe metric calibration" section: fields line (sample size is cycles
      now, plus `fit`/`fitFailureReason`), the estimator description, and the expected-values table
      with the live numbers measured below. The 480 cm correctness paragraph stays verbatim.

## 5. Tests

- [x] 5.1 `verticalOscillationCm.test.ts`: 480 cm artifact test verbatim (may append a
      `fitFailureReason` assertion); constant-scale equivalence tightened per D5; known 6 cm bounce
      under 1.2x drift unchanged; cross-run baseline test rewritten onto ~40-frame runs and renamed;
      scale-less-run drop test lengthened; missing-scale interpolation test unchanged; finite-stats
      test extended to the fit's numeric fields; hip-pinning test strengthened to actually pass
      `verticalOscillationSignal: 'earMid'`.
- [x] 5.2 New tests: below-quality-gate (seeded noise), drift-absorption thesis (clean vs.
      large linear+quadratic trend), weighted-median dominance (40-sample run vs. 14-sample run).
- [x] 5.3 `src/results/analysisDiagnostics.test.ts`: the literal that builds a
      `ScaleCalibratedVerticalOscillation` gains the new fields (typecheck coverage of the
      pass-through).

## 6. Verification

- [x] 6.1 `npx tsc -b`, `npx vitest run`, `npx eslint .`, `openspec validate
      adopt-spectral-vo-cm-estimator --strict`.
- [x] 6.2 Live results — MediaPipe override, ≥3 trials per clip, real GPU:
  - [x] Track clip (regression anchor): `verticalOscillationCm`, `fit.sinusoidR2`,
        `fit.frequencyHz`, `fit.sampleCount`, `sampleSize`, `scaleDriftRatio`, `torsoMeters`.
        Pre-registered rule: a stable drop of up to ~7% (≥ 5.65 cm) is the documented sine-underfit
        bias (#28 measured −3…−7% on the pixel path) and is recorded, not treated as a regression;
        anything above 6.10, below 5.60, or with cross-trial spread above 0.05 cm is investigated —
        never averaged away, and never fixed by tuning `CM_MIN_FIT_R2`.
  - [x] Park clip: everything recorded. A substantial drop from 14.8 is expected; single digits are
        an expectation of the epic, NOT an assertion of this ticket, and nothing is tuned toward it.
  - [x] Both clips: `fit.frequencyHz × 60` cross-checked against `metrics.cadence.value` in the same
        dump; a large disagreement means a harmonic or grid-edge fit and gets reported.
  - [x] MoveNet control, 1 trial per clip: `'scaleCalibration' in diagnostics === false`, other
        metrics inside their recorded spreads.

## Live results (measured 2026-08-12, real GPU, MediaPipe override, 3 trials/clip)

Before/after measured on the same machine on the same day: `feat/epic-33-vo-family` at
port 5287 (extrema estimator) against this branch at port 5286 (spectral fit).

**Track clip — the regression anchor**

| trial | VO_cm before | VO_cm after | fit.sinusoidR2 | fit.frequencyHz | fit.sampleCount | sampleSize | driftRatio | torsoMeters |
|---|---|---|---|---|---|---|---|---|
| 1 | 6.0746 | 4.7899 | 0.4861 | 1.52 | 57 | 3 | 1.0114 | 0.5053 |
| 2 | 6.0796 | 4.7816 | 0.4850 | 1.52 | 57 | 3 | 1.0114 | 0.5053 |
| 3 | 6.0753 | 4.7867 | 0.4855 | 1.52 | 57 | 3 | 1.0114 | 0.5053 |

Cross-trial spread after: 0.008 cm (rule wanted ≤ 0.05 — met). Level: 4.79 cm, i.e. −21.2%, which
is BELOW the rule's 5.60 floor. **Rule fired; investigated, not tuned, not averaged away.**

Finding: the new figure agrees with the *pixel* path's spectral fit on the identical clip. Pixel
fit reports 42.24 px peak-to-peak; ÷ 871.9 px/m = 4.844 cm, against this path's 4.786 cm — 1.1%
apart, with an identical winning frequency (1.52 Hz), identical sample count (57), identical span
(2.24 s) and `sinusoidR2` within 0.003 (0.4860 vs. 0.4886). That is D5's affine-equivalence
identity holding on real footage, the residual 1.1% being the real (mild, 1.011) scale drift
making the delta-weighted conversion differ from a single median-scale division.

So the drop is not this change introducing an error — it is the pipeline's two VO estimators,
which disagreed by 25% on this clip (4.84 cm-equivalent from the fit vs. 6.07 cm from extrema
pairing), being brought into agreement. The pre-registered −7% bound was inherited from #28's
sine-underfit measurement on the raw pixel trace of better-fitting clips; at this clip's
`sinusoidR2` ≈ 0.49 a sine explains under half the residual variance, so it underfits the peak
excursions by far more than 7%. The bound was wrong, not the measurement.

Secondary finding, against risk (2): the integration adds almost no noise. The cm path's
`sinusoidR2` (0.4860) is within 0.6% of the pixel path's (0.4886) over the same samples — if scale
noise were accumulating materially as red noise through the integration, the cm path's fit quality
would be visibly worse. It is not.

**Park clip**

| trial | VO_cm before | VO_cm after | fit.sinusoidR2 | fit.frequencyHz | fit.sampleCount | sampleSize | driftRatio | torsoMeters |
|---|---|---|---|---|---|---|---|---|
| 1 | 11.72 | 9.43 | 0.418 | 3.28 | 76 | 4 | 4.24 | 0.470 |
| 2 | 14.85 | 10.25 | 0.726 | 2.92 | 84 | 4 | 3.91 | 0.472 |
| 3 | 15.52 | 12.00 | 0.639 | 2.92 | 83 | 3 | 5.41 | 0.475 |

Median 14.85 → 10.25 cm, a 31% drop. Single digits in one trial only — recorded as measured, with
nothing tuned toward the epic's expectation. Park is NOT deterministic on this backend: the
presence-trimmed window lands on 76/83/84 samples across trials and that alone moves the number.
One BASELINE park trial sampled a single frame and emitted no `scaleCalibration` at all — the
cold-start flake already documented in CLAUDE.md, on the unmodified branch, unrelated to this
change.

**Cadence cross-check (`fit.frequencyHz × 60` vs. `metrics.cadence.value`, same dump)**

| clip / trial | cm fit ×60 | cadence | Δ |
|---|---|---|---|
| track 1–3 | 91.2 | 91.2 | 0 (exact, all three) |
| park 1 | 196.8 | 195.6 | 1.2 spm = 1 grid step |
| park 2 | 175.2 | 176.4 | 1.2 spm = 1 grid step |
| park 3 | 175.2 | 177.6 | 2.4 spm = 2 grid steps |

No harmonic, no grid-edge disagreement — the two fits reach the same rhythm through two different
series.

**MoveNet control (1 trial/clip, this branch)**

`'scaleCalibration' in diagnostics` is `false` on both clips. Track: 74 detected frames, view
`side` @ 0.769 confidence, VO 0.176, cadence 93.6, kneeFlexion 120.2, trunkLean 12.27 — all inside
CLAUDE.md's recorded MoveNet spreads. Park: 78/78 detected, view `front` @ 0.107, VO 0.241,
cadence 180.0, kneeFlexion 89.9.

## 7. Not archived

- [x] 7.1 Leave the change unarchived — epic #33 archives as a whole.
