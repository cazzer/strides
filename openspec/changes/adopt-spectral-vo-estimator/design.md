# Design — spectral sinusoid-fit amplitude estimator for vertical oscillation

## Context

`computeVerticalOscillation` reported `median(consecutive-extremum differences) / torsoLengthPx`,
with extrema found by `findLocalExtrema` under a prominence threshold of 3% of torso length. Epic
#27's investigation (recorded in CLAUDE.md) established two independent failure modes: run-to-run
instability driven by which extrema clear the threshold, and no mechanism at all for separating
bounce from camera-approach drift. This change replaces the estimator. Six decisions below (D1–D6)
were made up front against measured evidence; the rejected alternatives at the end were rejected
with evidence too, and are not to be revisited inside this ticket.

## D1 — Replace the extrema path entirely; no fallback

**Decision.** The spectral fit is vertical oscillation's ONLY estimator. `verticalOscillation.ts`
stops importing `findLocalExtrema`. `extrema.ts` itself stays exactly as it is — `overstriding`,
`cadence` (via `footstrikes.ts`), `kneeFlexion` and `armSwingSymmetry` all still use it.

**Why not keep the old path as a fallback for clips the fit rejects.** A quality-gated fallback
flips estimators run-to-run precisely on the marginal clips where the two estimators disagree most.
MoveNet is not bit-reproducible (documented in CLAUDE.md: 74 vs 75 detected frames across
otherwise-identical trials), so a clip sitting near the gate would report a spectral value on one
run and an extrema value on the next, differing by more than either estimator's own noise. That
converts a stable, documented bias into discontinuous variance — strictly worse than either
estimator alone. It would also double the semantics of `caveat` and `sampleSize`, which would have
to mean different things depending on which estimator ran.

**Consequence, accepted.** A clip spanning under one bounce cycle now returns `null` with a caveat
instead of a number. That is honest: those were exactly the single-half-cycle readings the
investigation measured at 2.8%–59% within one run.

## D2 — Gate on the sinusoid PARTIAL R², at 0.30

**Decision.** `sinusoidR2 = 1 − RSS(f*) / RSS_trendOnly`, where `RSS_trendOnly` comes from fitting
`c + d·t + e·t²` alone (computed once, outside the grid loop). Below
`verticalOscillationMinFitR2` (default 0.30) the metric reports `value: null`, `confidence: 0`, a
populated `series`, and a caveat naming both the measured quality and the threshold.

**Why partial and never total.** Total R² measures the whole model, trend terms included, and on a
drifting clip the trend alone explains nearly everything. Measured on the park clip: totalR² 0.985
while the sinusoid's partial R² is 0.687. A total-R² gate would wave through exactly the fits most
in need of gating. Total R² is also not comparable across clips — its denominator is whatever
variance that clip happened to contain, drift included — so it is reported as a diagnostic only.

**Why 0.30.** Two-sided calibration:

- *Above noise.* Fitting pure Gaussian noise at n = 50 over the shipped 1.2–4.0 Hz / 0.02 Hz grid
  (2000 seeds, measured in this change): median partial R² 0.115, p95 0.217, p99 0.283, max 0.418.
  12 of 2000 seeds (0.6%) cleared 0.30. So 0.30 rejects roughly 99.4% of pure-noise traces. It is a
  filter, not a guarantee — stated plainly here because a threshold sold as a guarantee invites
  someone to stop checking.
- *Below real footage.* The worst real trial observed across the epic's live runs scored 0.397 with
  an otherwise-normal amplitude. The gate must not reject that trial, so it cannot be tightened
  toward the noise distribution's tail without losing real data. 0.30 sits in the gap.

Live values measured on this change's own verification runs: track ≈ 0.83, park ≈ 0.69 — both
comfortably clear.

## D3 — Confidence and sampleSize

**`fitQuality` as a confidence factor.** `MetricConfidenceParams` gains an optional
`fitQuality?: number`, defaulting to 1 and multiplied into the existing product, clamped by the
existing `clamp01`. Precedent: `travelDirectionKnown` is already an optional factor that only one
pair of metrics supplies. The factor answers a question none of the existing ones do — an estimator
can have abundant, fully-detected, well-viewed input and still be describing something that isn't
there.

**The R² → fitQuality mapping is vertical oscillation's policy, not `confidence.ts`'s**, and lives
in `verticalOscillation.ts`:

```
fitQuality = clamp01((sinusoidR2 − verticalOscillationMinFitR2) / (FIT_QUALITY_SATURATION_R2 − verticalOscillationMinFitR2))
FIT_QUALITY_SATURATION_R2 = 0.8   // module constant, not config
```

A linear ramp from "just cleared the gate" to "as good as a clean clip gets", so a marginal fit
loses confidence proportionally instead of falling off a cliff one side of a boundary.
`FIT_QUALITY_SATURATION_R2` is a module constant rather than config because, unlike the minimum
(a publish-or-not policy worth tuning), it only sets the shape of the ramp between the gate and
perfection, and moving it independently of the gate only makes the two numbers disagree.

Effect on the existing fixture assertions, which must and do still hold exactly: the synthetic gait
fixture scores R² > 0.99 → fitQuality 1 → side-view confidence stays 1.0 and front-view stays 0.85.
Live: track ≈ ×1.0 (R² 0.83 saturates), park ≈ ×0.77 (R² 0.687).

**`sampleSize` = complete gait cycles**, `Math.floor(spanSeconds × frequencyHz)`, replacing the
half-cycle count. The fit consumes the whole waveform rather than pairing individual extrema, so
the cycle is its natural sample unit. `verticalOscillationMinCycles` is repurposed to full cycles
and its default drops 4 → 3, which keeps roughly the same real-world requirement (4 half-cycles was
2 full cycles; 3 full cycles is a modest tightening, appropriate now that the estimator actually
needs several cycles of waveform rather than one clean trough-to-peak). Documented at both
`MetricResult.sampleSize` and in the module doc.

**`secondPeakRatio` is computed and reported but deliberately NOT wired into confidence.** It is a
real diagnostic — how well the best frequency outside a resolution-aware exclusion band fits,
relative to the winner — but there is no calibration evidence for what value should cost how much
confidence, and inventing a coefficient would put an unfounded number into a user-visible score.

## D4 — Configuration

Added to `HeuristicsConfig` / `DEFAULT_HEURISTICS_CONFIG`:

| Key | Default | Why |
| --- | --- | --- |
| `spectralFitMinFrequencyHz` | 1.2 | Bounce is twice per gait cycle, so 1.2 Hz ≈ 72 steps/min — below any running cadence, low enough not to force walking-speed footage onto a faster candidate. |
| `spectralFitMaxFrequencyHz` | 4.0 | ≈ 240 steps/min, above any sustained human running cadence. Higher candidates could only be fitting per-frame jitter. |
| `spectralFitFrequencyStepHz` | 0.02 | 141 candidates over the band — finer than the frequency resolution a few-second clip supports, so the grid is never the limiting factor; the whole search is sub-millisecond. |
| `verticalOscillationMinFitR2` | 0.30 | See D2. |

Repurposed: `verticalOscillationMinCycles` 4 half-cycles → 3 full cycles (D3).
Removed: `verticalOscillationMinProminenceRatio`, dead once the extrema path is gone. The
`armSwingMinProminenceRatio` doc comment referenced it by name and is reworded.

Deliberately module constants, not config: `MIN_SPECTRAL_FIT_SAMPLES = 12` and
`SECOND_PEAK_MIN_BAND_HZ = 0.4` in `spectralFit.ts` (correctness floors, not tuning knobs — see
D5), and `FIT_QUALITY_SATURATION_R2 = 0.8` in `verticalOscillation.ts` (D3).

## D5 — Numerics

Per grid point the 5×5 symmetric normal matrix and 5-vector RHS are accumulated in one pass and
solved by ~25 lines of Gaussian elimination with partial pivoting and a magnitude-relative pivot
guard. The solver is private to `spectralFit.ts` rather than promoted to `mathUtils.ts`: it exists
to serve one caller with one conditioning story, and a general-purpose linear solver in a shared
module invites use on systems where normal equations are the wrong tool.

Conditioning is handled before the matrix is formed: time is centered at the sample mean and values
are mean-centered. Both are exactly amplitude- and frequency-invariant (the `c`/`d`/`e` terms span
the same subspace either way; a time shift only rotates `a` into `b`), so this is free insurance,
not a change of model. RSS is computed from actual residuals rather than the algebraic
`yᵀy − βᵀXᵀy` shortcut, which is a difference of nearly-equal large numbers whenever the fit is good
and can land slightly negative, poisoning every R² downstream.

No caching or incremental optimization. 141 candidates × a few hundred samples is sub-millisecond
against a pipeline that spends tens of seconds in pose detection.

**`MIN_SPECTRAL_FIT_SAMPLES = 12` is load-bearing, not a formality.** With five free parameters, a
handful of samples can be interpolated near-exactly: measured at n = 5, the fit returns R² = 1
alongside a peak-to-peak amplitude of 422 for a ±1 signal. No quality gate downstream can catch
that, because the fit genuinely is perfect. The only defense is refusing to fit. 12 leaves at least
7 residual degrees of freedom.

**Two 0/0 traps, both guarded relatively rather than with an absolute epsilon** (residuals carry the
input's units, so an absolute constant would be wrong for pixel-space and normalized traces alike):
`RSS_trendOnly ≈ 0` (a flat trace, a pure ramp, or a pure parabola — the existing
`verticalBouncePx: 0` fixture hits this) is checked as `rssTrendOnly > tss * 1e-9`, and pivot
magnitude is checked against the largest matrix entry × 1e-12. Both return
`reason: 'degenerate-signal'`.

**`secondPeakRatio` uses a resolution-aware exclusion band**, `max(0.4 Hz, 1 / spanSeconds)`. Two
grid points a hairsbreadth apart are the same peak sampled twice, not competitors, and on a short
clip frequency resolution is bounded by observation length however fine the grid is. The ratio is
built from explained sum of squares (`RSS_trendOnly − RSS(f)`), which is non-negative by
construction and maximized at `f*`, so it lands in [0, 1] by construction rather than by clamping.

## D6 — Fit diagnostics are exposed

`VerticalOscillationResult` gains `fit: VerticalOscillationFit | null`, with the invariant
`fit !== null` **iff** `value !== null` — a reported value always has a fit behind it, and a fit
that failed or fell below the gate never yields a value. `AnalysisDiagnostics` gains
`verticalOscillationFit`, sourced straight from `heuristics.verticalOscillation.fit`. Without this,
a live harness run could see that a value changed but not whether the frequency, the fit quality or
the cycle count moved — which is most of what there is to debug about this estimator. Broken out as
its own diagnostics key rather than folded into `metrics.verticalOscillation`, because
`MetricDiagnostics` is deliberately uniform across all seven metrics and only this one has a fit.

## Requirements this change relies on but does not modify

Cited so a reviewer can confirm none of them needed a delta:

- form-heuristics, **"Vertical oscillation is view-tolerant"** — unchanged. The view-fit table, the
  0.85 front-view multiplier and the "compute for every view rather than withholding" rule all
  still hold; only the estimator behind the value changed.
- form-heuristics, **"Output contract — value and confidence are always present, never NaN, never
  throws"** — still satisfied, and more strictly than before: the primitive returns typed failures
  instead of NaN, and every new no-value path sets `confidence: 0` with a non-null caveat.
- form-heuristics, **"Missing and interpolated keypoints are handled per a shared, documented
  policy"** — unchanged. Input is still `resolveMidpoint(frame, 'left_hip', 'right_hip')` over
  `RobustPoseFrame`, and `interpolatedFraction` is still tracked and still fed to confidence.
- form-heuristics, **"Metrics are computed over a presence-trimmed window, not the raw clip"** —
  unchanged; the fit consumes whatever window it is handed.
- results-view, **"Vertical oscillation timeseries chart"** — unchanged. `series` keeps its shape,
  its 1:1 frame alignment, its sign flip and its null-for-gap semantics, and is now populated on
  strictly more paths than before (every no-value path with a resolvable hip trace).
- analysis-diagnostics, **"Diagnostics aggregation"** — the new `verticalOscillationFit` key is
  purely additive to an aggregation the requirement describes in general terms.

## Rejected alternatives (evidence-based; out of scope for this ticket)

- **Velocity gate**, **One-Euro filter**, **per-frame height normalizer**, **linear scale
  regression** — all four were evaluated in epic #27's investigation and rejected there.
- **Resample onto a uniform grid, then FFT.** Interpolation invents signal exactly where signal is
  missing, which is where an amplitude estimate is most fragile. The least-squares formulation over
  the samples that actually exist has no such failure mode; a gap simply contributes no equations.
- **A cubic or higher trend term.** A quadratic is the lowest-order trend that can bend, which is
  as much freedom as is safe over a handful of cycles; higher orders start competing with the
  oscillation itself for the same variance.
- **Gating on `secondPeakRatio`** — see D3; no calibration evidence exists.

## Known, accepted bias

A real bounce waveform is peakier than a sine, and a single sinusoid underfits its peaks, so this
estimator reads roughly 3–7% LOW versus the extrema baseline on the same footage. Chosen
deliberately: a consistent small underestimate is usable, run-to-run swings of tens of percent are
not. Not to be "corrected" with a fudge factor — the epic's remaining tickets address the signal
and the normalizer, which is where the real error lives.
