## 1. Shared spectral-fit primitive

- [x] 1.1 Add `src/heuristics/spectralFit.ts`: `fitSpectralSinusoid(samples, options)` over a
      `SpectralSample { t, v }` list, grid-searching `minFrequencyHz..maxFrequencyHz` at
      `frequencyStepHz`, accumulating a symmetric 5×5 normal matrix + RHS per candidate in one pass
      and solving via a private Gaussian elimination with partial pivoting and a magnitude-relative
      pivot guard. Time centered at the sample mean, values mean-centered. No resampling, no
      caching. Module doc covers why normal equations, why no resampling, and why the reported
      quality number is a partial R².
- [x] 1.2 Typed failure contract: `too-few-samples` (below `MIN_SPECTRAL_FIT_SAMPLES = 12`),
      `degenerate-signal` (zero span, singular system, or `RSS_trendOnly` at the relative
      degeneracy floor — covers flat/ramp/parabola traces), `insufficient-cycles`
      (`spanSeconds × f* < 1`). Non-finite samples dropped before the count check; `spanSeconds`
      from the surviving samples; success only when the amplitude is finite; order-independent.
- [x] 1.3 `src/heuristics/spectralFit.test.ts` — recovery (clean on-grid, off-grid, drift ≫ signal
      compared explicitly against the drift-free fit, seeded noise at 15% of amplitude), invariance
      (+600 s time offset, +constant value offset, shuffled order), gaps (0.4 s mid-gap, 0.42 s
      leading gap, 40% dropout, 5 ms/60 ms alternating intervals), degenerate inputs (empty, n=5,
      the 11-vs-12 boundary, constant, ramp, parabola, identical timestamps, 0.72 cycles), noise
      calibration (8 fixed seeds all below 0.30), and the diagnostic invariants
      (`secondPeakRatio ∈ [0,1]`, two-tone above single-tone, amplitude bounded by the observed
      spread).

## 2. Type contract and configuration

- [x] 2.1 `src/heuristics/types.ts`: add `spectralFitMinFrequencyHz` (1.2),
      `spectralFitMaxFrequencyHz` (4.0), `spectralFitFrequencyStepHz` (0.02) and
      `verticalOscillationMinFitR2` (0.30) to `HeuristicsConfig` and
      `DEFAULT_HEURISTICS_CONFIG`, each with a doc comment justifying its default.
- [x] 2.2 Repurpose `verticalOscillationMinCycles` from half-cycles to COMPLETE gait cycles,
      default 4 → 3; document the new `sampleSize` unit at `MetricResult.sampleSize`.
- [x] 2.3 Delete `verticalOscillationMinProminenceRatio` and reword the `armSwingMinProminenceRatio`
      doc comment that referenced it by name.
- [x] 2.4 Add `VerticalOscillationFit` and the `fit: VerticalOscillationFit | null` field on
      `VerticalOscillationResult`, documenting the `fit !== null` iff `value !== null` invariant.

## 3. Confidence

- [x] 3.1 `src/heuristics/confidence.ts`: optional `fitQuality?: number` on
      `MetricConfidenceParams`, defaulting to 1 and multiplied into the existing product (clamped by
      the existing `clamp01`); extend the doc block's factor enumeration.
- [x] 3.2 `src/heuristics/confidence.test.ts`: defaults to 1 when omitted, multiplies in directly,
      compounds with the other factors, clamps out-of-range input.

## 4. Vertical oscillation

- [x] 4.1 Rewrite `computeVerticalOscillation`: drop the `findLocalExtrema` import and the
      half-cycle pairing loop; build the fit's input from the resolved hip-mid RAW pixel y (NOT the
      sign-flipped, normalized chart series); call `fitSpectralSinusoid`; map the three failure
      reasons plus a sub-threshold R² to four distinct caveats over a PRESERVED `series`; compute
      `value = peakToPeakAmplitude / torsoLengthPx`, `sampleSize = floor(observedCycles)`, and
      `fitQuality` from the R² ramp between `verticalOscillationMinFitR2` and
      `FIT_QUALITY_SATURATION_R2 = 0.8`.
- [x] 4.2 Rewrite the module doc: the method, the −3…−7% peaky-waveform bias direction, drift
      tolerance, why there is no fallback, and the new `sampleSize` meaning.
- [x] 4.3 `src/heuristics/verticalOscillation.test.ts`: keep the four existing behaviors (clean
      fixture, tightened from 1 to 3 decimals; confidence ≈1 side / ≈0.85 front; gapped clip;
      no-resolvable-hip), retarget the flat-trace test at the degenerate-signal wording, and add
      sub-one-cycle, noise-only (caveat names measured value AND threshold), marginal-but-usable
      fit, two-cycle sample-size penalty, the fit/value invariant, and a no-NaN sweep.

## 5. Diagnostics and fixtures

- [x] 5.1 `src/results/analysisDiagnostics.ts`: add `verticalOscillationFit`, sourced from
      `heuristics.verticalOscillation.fit`; test both the passthrough and the null case.
- [x] 5.2 Add `fit: null` to the `VerticalOscillationResult` literals in `MetricsPanel.test.tsx`,
      `ResultsView.test.tsx`, `LowConfidenceBanner.test.tsx`, `useVideoAnalysis.test.ts` and
      `analysisDiagnostics.test.ts`.
- [x] 5.3 Correct the now-stale cross-references to vertical oscillation's extrema/half-cycle
      approach in `trunkLean.ts`, `armSwingSymmetry.ts` and `extrema.test.ts`.

## 6. Verification

- [x] 6.1 `npx tsc -b` — no errors.
- [x] 6.2 `npx vitest run` — 44 files, 340 tests, all passing.
- [x] 6.3 `npx eslint .` — no issues.
- [x] 6.4 Live verification, 5 trials per clip, both demo buttons, MoveNet default, real GPU
      (`--headless=new --enable-gpu --ignore-gpu-blocklist`), dev server on port 5281. Results
      below.

### Live results — this change (5 trials/clip, no sampling collapses)

| clip | trial | VO value | confidence | sampleSize | f* (Hz) | sinusoidR² | totalR² | secondPeakRatio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| track | 1 | 0.1758 | 0.957 | 2 | 1.56 | 0.843 | 0.886 | 0.128 |
| track | 2 | 0.1701 | 0.957 | 2 | 1.56 | 0.818 | 0.881 | 0.149 |
| track | 3 | 0.1765 | 0.965 | 2 | 1.54 | 0.842 | 0.903 | 0.099 |
| track | 4 | 0.1737 | 0.945 | 2 | 1.54 | 0.820 | 0.874 | 0.132 |
| track | 5 | 0.1870 | 0.957 | 2 | 1.56 | 0.847 | 0.894 | 0.063 |
| park | 1 | 0.2379 | 0.659 | 4 | 3.00 | 0.687 | 0.985 | 0.175 |
| park | 2 | 0.2460 | 0.700 | 4 | 3.00 | 0.712 | 0.986 | 0.177 |
| park | 3 | 0.2330 | 0.682 | 4 | 3.00 | 0.701 | 0.987 | 0.155 |
| park | 4 | 0.2375 | 0.672 | 4 | 3.00 | 0.695 | 0.986 | 0.167 |
| park | 5 | 0.2303 | 0.682 | 4 | 3.02 | 0.701 | 0.986 | 0.162 |

**Medians vs. acceptance criteria**

| criterion | target | measured | verdict |
| --- | --- | --- | --- |
| park VO median | 0.20–0.26 (predicted ~0.236) | **0.2375** | pass |
| park VO spread `(max−min)/median` | ≤ 8% (baseline 18–23%) | **6.6%** | pass |
| track VO median | −10%…0 vs. extrema baseline | **0.1758**, −0.9% vs. the same-session baseline (0.1775) | pass |
| `verticalOscillationFit.frequencyHz` | park ≈3.0, track ≈1.56 | park 3.00–3.02, track 1.54–1.56 | pass |
| null rate outside sampling collapses | 0 | 0 (10/10 trials reported a value) | pass |
| `f*` pegged at a grid edge (1.2 / 4.0) | none | none | pass |

The track clip's presence-trimmed window is 1.84–1.88 s (47–48 resolvable hip samples) and its
fitted bounce runs 2.83–2.90 cycles, so `sampleSize` floors to 2 against a minimum of 3 and the
"only 2 complete bounce cycle(s)" caveat applies. That is a property of the clip, not of the
estimator. Confidence still uses the unrounded 2.83–2.90, so it lands at 0.945–0.965 rather than the
0.667 a floored count would give.

> **Confidence column note.** The runs above were captured before the review fix that feeds
> confidence the unrounded cycle count. The `confidence` column has been recomputed from the
> same runs' unchanged inputs (`viewFitMultiplier × frameCoverage × (1 − 0.5·interpolatedFraction) ×
> min(1, observedCycles / 3) × fitQuality`), which is exact — nothing else in the product changed,
> and the same formula reproduces every originally-logged value to three decimals when given the
> floored count. Only the five track rows moved (0.667 → 0.945–0.965); every park row is unchanged,
> since park observes 4.86 cycles and was already saturated at 1 on that factor. Every other column
> is as logged.

### Live results — baseline (feat/epic-27-vo-stack, extrema estimator, 5 trials/clip)

Run on the same machine, same GPU flags, same session, dev server on port 5282, for a like-for-like
before/after. One track trial hit the known `sampling.totalSamples === 1` collapse and is excluded
(it nulls both estimators identically); the remaining nine are used.

| clip | baseline VO per trial | baseline median | baseline spread |
| --- | --- | --- | --- |
| track | 0.1716, 0.1728, 0.1821, 0.1957 | 0.1775 | 13.6% |
| park | 0.1997, 0.2134, 0.2156, 0.2185, 0.2430 | 0.2156 | 20.0% |

**Before/after**

| clip | metric | baseline | this change | verdict |
| --- | --- | --- | --- | --- |
| track | VO median | 0.1775 | 0.1758 (−0.9%) | inside the −10%…0 acceptance band, and in the expected direction (the sine underfits a peaky waveform) |
| track | VO spread | 13.6% | 9.6% | tighter |
| park | VO median | 0.2156 | 0.2375 | inside the 0.20–0.26 acceptance band; the baseline's own median is unreliable at 20% spread |
| park | VO spread | **20.0%** | **6.6%** | 3.0x tighter — the headline result, and the epic's stated goal (≤8%) |

- [x] 6.5 Confirm no other metric moved. `verticalOscillation` is the only metric whose code
      changed, and `fitQuality` defaults to 1 for the other six, so their inputs and confidence
      products are untouched. Cross-checked empirically against the same-session baseline run: the
      median CONFIDENCE of all six is bit-identical before and after on both clips (track 1.000 /
      1.000 / 1.000 / 0.979 / 0.068 / 1.000; park 0.050 / 0.050 / 0.800 / 0.050 / 0.98x / 0.050),
      and their median values move only within their own already-documented cross-trial spread
      (`kneeFlexion` track: +0.0%; `trunkLean` track: +1.7% against a 4-7% own-spread;
      `overstriding` and `footStrikePattern` swing more, but their own cross-trial spreads are
      122% and 70% respectively on the baseline branch — MoveNet nondeterminism, not this change).
