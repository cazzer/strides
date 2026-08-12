## Why

`computeVerticalOscillationCm` is the one place in this pipeline that reports a real-world
centimetre figure, and it is the last amplitude estimator still pairing extrema. The pixel-space
`computeVerticalOscillation` moved to the shared spectral sinusoid fit (`spectralFit.ts`) because
extrema pairing has no way to separate a runner's bounce from a runner's slow translation across
the frame; the centimetre calculation inherited neither the fix nor the reasoning, and it reads
the signal where translation is worst.

The evidence is on the park clip, whose subject runs *at* the camera. Live diagnostics there
report `verticalOscillationCm ≈ 14.9–15.7` with `scaleDriftRatio` between 3.9 and 5.4, and the
per-half-cycle amplitudes alternate large/small with the drift direction — 24.6 / 6.6 / 14.9 /
4.5 / 18.0 / 4.5 / 31.1 cm. That alternation is the signature of an estimator eating translation
as amplitude: each half-cycle that runs *with* the drift measures bounce plus approach, each one
that runs against it measures bounce minus approach. A median over that mixture is not a bounce.

The spectral fit's `c + d·t + e·t²` trend terms exist for exactly this. They are fitted alongside
the sinusoid rather than after it, so slow translation is removed from the amplitude by
construction rather than by hoping it averages out. The composition seam was designed for this
swap: the module's stages are `collectScales → buildRuns → estimateAmplitudes`, and only the
third stage knows about extrema (see
`openspec/changes/archive/2026-08-12-add-mediapipe-metric-scale-calibration/design.md`, D3
"composition seam").

## What Changes

- `computeVerticalOscillationCm`'s third stage is replaced: the integrated metric series of each
  integration run is handed to `fitSpectralSinusoid` instead of `findLocalExtrema` + half-cycle
  pairing. One fit per run, never a fit across runs (each run's cumulative series restarts at its
  own arbitrary baseline).
- The reported `verticalOscillationCm` becomes the fitted PEAK-TO-PEAK amplitude of one
  contributing run's fit, selected by a sample-count-weighted median over the contributing runs'
  amplitudes — so the reported amplitude and every reported fit diagnostic come from the same
  coherent fit rather than from a blend of several.
- `sampleSize` changes unit: complete BOUNCE cycles across contributing runs, not paired
  half-cycles. This mirrors the identical redefinition the pixel metric took when it adopted the
  spectral fit.
- New reported fields: `fit` (frequency, partial R², total R², second-peak ratio, sample count,
  span, observed cycles, and the peak-to-peak amplitude in centimetres) and `fitFailureReason`
  (one of the primitive's three well-posedness reasons plus `'below-quality-gate'` and
  `'no-usable-run'`). Exactly one of `fit` / `fitFailureReason` is non-null.
- A module-private quality gate `CM_MIN_FIT_R2 = 0.30` replaces the now-dead
  `CM_MIN_PROMINENCE_TORSO_RATIO`. A run whose fit scores below it contributes nothing.
- `computeVerticalOscillationCm` gains a `config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG`
  parameter, read for the shared spectral frequency grid ONLY — never for signal selection, which
  stays hip-pinned unconditionally. The single call site relies on the default and is unchanged.

## Impact

- Affected specs: `form-heuristics` (the scale-calibrated VO requirement — MODIFIED),
  `analysis-diagnostics` (the `scaleCalibration` block's field list — MODIFIED).
- Affected code: `src/heuristics/verticalOscillationCm.ts` (+ its test),
  `src/heuristics/types.ts` (doc comments only — two of them currently claim this calculation
  "takes no config at all", which stops being true), `src/results/analysisDiagnostics.test.ts`
  (the literal that builds a `ScaleCalibratedVerticalOscillation` gains the new fields).
- **Availability widens, deliberately.** The old estimator needed `torsoLengthPx` to convert its
  prominence threshold into metres, so a clip with no resolvable body-scale reference could never
  report centimetres. The spectral fit has no prominence threshold, so that dependency is gone:
  such clips can now report `verticalOscillationCm` with `torsoMeters: null`. `torsoMeters`
  survives purely as the calibration sanity check it always was (a human torso is ~0.5 m), and its
  absence no longer suppresses the measurement it was never actually part of computing.
- **`scaleCalibration`'s key-absence contract is unchanged**: still absent entirely on any backend
  that measures no scale, so a MoveNet run still serializes to exactly the JSON it did before.
- Not archived — this is one ticket inside epic #33; the epic archives as a whole.
