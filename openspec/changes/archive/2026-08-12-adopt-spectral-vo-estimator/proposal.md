## Why

Issue #28 (epic #27) is the keystone ticket of the vertical-oscillation accuracy stack. The
existing `computeVerticalOscillation` measures bounce by pairing consecutive prominence-filtered
local extrema of the hip-mid y trace and taking the median trough-to-peak difference. That
estimator has two measured problems, both recorded in this repo's CLAUDE.md "Vertical oscillation
accuracy investigation":

1. **It is unstable run to run.** Which extrema clear the prominence threshold depends on
   frame-level detail that MoveNet does not reproduce bit-exactly between runs, and on a short clip
   a couple of extrema either way moves the median a lot. Per-half-cycle ratios inside a *single*
   run of the park clip spanned 2.8%–59%; cross-trial spread of the reported value ran 18–23%.
2. **It cannot separate bounce from camera-approach drift.** A runner growing on screen translates
   their whole body up the frame; an estimator built on differences between consecutive extrema has
   no term for that and charges it to the oscillation.

A spectral sinusoid fit fixes both at once: fitting a whole waveform uses every sample rather than
a handful of hand-picked ones, and adding low-order polynomial trend terms to the model gives the
drift somewhere to go other than the amplitude. Measured on the park clip, cross-trial spread fell
from 18.2% to 4.2% (4.3x), with the track clip neutral.

The primitive is extracted as its own module rather than inlined, because two follow-up tickets in
epic #27 (cadence, and the ear-mid signal-selection ticket) consume the same fit over different
input series.

## What Changes

- **New `src/heuristics/spectralFit.ts`**: `fitSpectralSinusoid(samples, options)`. For each
  candidate frequency on a configured grid, least-squares solves
  `v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²` over the supplied `{ t, v }` samples and picks
  the candidate with the smallest residual sum of squares. Reports peak-to-peak amplitude
  `2·√(a²+b²)`, the winning frequency, a sinusoid **partial** R² against a trend-only baseline, a
  total R² (diagnostic only), a second-peak ratio, and the observed cycle count. No resampling and
  no interpolation — irregular timestamps and gaps are the expected input, not a preprocessing
  problem. Degenerate input returns a typed failure (`too-few-samples` / `degenerate-signal` /
  `insufficient-cycles`), never `NaN`.
- **`src/heuristics/verticalOscillation.ts`** stops importing `findLocalExtrema` and uses the
  spectral fit as its ONLY estimator. Value is the fitted peak-to-peak amplitude divided by the
  clip-median torso length (`estimateBodyScale` unchanged). Below the configured minimum fit
  quality, or on any fit failure, it reports `value: null` with a caveat naming the reason — there
  is no fallback to the old path (see design.md D1).
- **`sampleSize` for this metric is redefined** as the count of complete gait cycles observed,
  `floor(spanSeconds × frequencyHz)`, replacing the old half-cycle count.
  `verticalOscillationMinCycles` is repurposed accordingly and its default moves 4 → 3.
- **`src/heuristics/confidence.ts`** gains an optional `fitQuality` factor (default 1), multiplied
  into the existing product alongside `viewFitMultiplier`, `frameCoverage`, the interpolation
  penalty, the sample-size factor and `travelDirectionKnown`. The mapping from R² to `fitQuality`
  is vertical oscillation's own policy and lives in its module.
- **`HeuristicsConfig`** gains `spectralFitMinFrequencyHz` (1.2), `spectralFitMaxFrequencyHz` (4.0),
  `spectralFitFrequencyStepHz` (0.02) and `verticalOscillationMinFitR2` (0.30), and loses
  `verticalOscillationMinProminenceRatio`, which nothing reads any more.
- **`VerticalOscillationResult` gains `fit: VerticalOscillationFit | null`**, non-null exactly when
  `value` is non-null, and `AnalysisDiagnostics` gains a `verticalOscillationFit` passthrough so a
  live harness run can read the fitted frequency and fit quality without re-deriving them.
- The chart `series` output is unchanged in shape and is populated on every path that has a
  resolvable hip trace, including the paths that report no value.

## Capabilities

### New Capabilities

<!-- none: this replaces the estimator behind an existing form-heuristics metric -->

### Modified Capabilities

- `form-heuristics`: adds a requirement specifying vertical oscillation's amplitude estimator, its
  configuration, and its no-value-below-quality-threshold behavior. No existing requirement changes
  behavior — "Vertical oscillation is view-tolerant", the shared output contract, the
  missing/interpolated keypoint policy and the presence-window requirement all continue to hold
  exactly as written (see design.md for why each is unaffected).

## Impact

- New: `src/heuristics/spectralFit.ts` + `src/heuristics/spectralFit.test.ts`.
- Modified: `src/heuristics/verticalOscillation.ts` (+ test), `src/heuristics/types.ts`,
  `src/heuristics/confidence.ts` (+ test), `src/results/analysisDiagnostics.ts` (+ test).
- Test-fixture updates only: `src/results/MetricsPanel.test.tsx`, `src/results/ResultsView.test.tsx`,
  `src/results/LowConfidenceBanner.test.tsx`, `src/results/useVideoAnalysis.test.ts` — each
  constructs a `VerticalOscillationResult` literal that now needs `fit`.
- Doc-only: `src/heuristics/trunkLean.ts`, `src/heuristics/armSwingSymmetry.ts`,
  `src/heuristics/extrema.test.ts` reference vertical oscillation's old half-cycle/extrema approach
  in comments; those references are corrected.
- No new runtime dependencies. `extrema.ts`, `bodyScale.ts`, `mathUtils.ts`, `MetricsPanel.tsx`,
  `VerticalOscillationChart.tsx`, the pose backends and the robustness layer are untouched.
- **Behavior change users can see**: a clip whose hip trace has no fittable rhythm now shows no
  vertical-oscillation number plus an explanation, where before it would show a value derived from
  one or two half-cycles. That is the intended correction, not a regression — those values were the
  2.8%–59% spread documented above.
