# Design — spectral amplitude estimation for the scale-calibrated centimetre metric

## Context

`computeVerticalOscillationCm` has three stages: `collectScales` → `buildRuns` →
`estimateAmplitudes`. Only the third knows about extrema. This change replaces exactly that
stage. The pixel→metre conversion (integrating per-frame deltas, `Σ (y[k−1] − y[k]) / s̄[k]`,
restarted at every hip-tracking gap) is untouched in behavior — it is the module's one
correctness constraint and has its own regression test (the 480 cm artifact).

---

## D1 — One spectral fit PER INTEGRATION RUN

`buildRuns` is untouched. For each run, the existing integration loop (now extracted as
`buildMetricSeries`) produces the run's `{ t, v }` metric series in metres, which is handed
directly to `fitSpectralSinusoid` with the frequency grid read from `HeuristicsConfig`
(`spectralFitMinFrequencyHz` / `spectralFitMaxFrequencyHz` / `spectralFitFrequencyStepHz`).

A run contributes nothing when the primitive refuses it (`too-few-samples` at fewer than 12
samples, `insufficient-cycles`, `degenerate-signal`) or when its fit falls below the quality gate
(D3). A run whose scales are entirely unmeasured is dropped before any of that, exactly as
before.

**On both demo clips this is bit-for-bit identical to a single fit over the whole clip.** Hip
coverage inside the presence window is ~100% on both, so `buildRuns` returns one run, and the
primitive mean-centers internally — per-run and whole-clip are the same computation. The
per-run/whole-clip distinction only becomes observable on a fragmented clip, which is precisely
where getting it wrong would be invisible in live verification. Hence deciding it on structure
rather than on measurement.

### Rejected: one fit over de-meaned concatenated runs

The appeal is sample mass: a fragmented clip's runs individually starve the 12-sample floor while
their concatenation would clear it. The proposed fix for the baseline problem — de-mean each run's
values before concatenating, since each run's cumulative series starts at its own arbitrary zero —
does not work, and the reason is Frisch–Waugh–Lovell.

Per-run intercepts are equivalent to de-meaning **the response and every basis column** within
run. De-meaning only the response leaves the sinusoid/linear/quadratic columns un-transformed, so
the fit is not the per-run-intercept model at all — it is a model with a single global intercept
applied to a response that has had a piecewise-constant step function subtracted from it. Under a
global linear drift (which is the case this whole ticket exists to handle), subtracting each run's
own mean turns a straight line into a sawtooth: within each run the drift survives, and at each
run boundary the response snaps back. The residual staircase has magnitude on the order of
`m × (spread of run centres)`, where `m` is the drift slope. On park-like footage that term is
larger than the ~6 cm signal being measured — the "fix" injects a bigger artifact than the one it
removes.

Doing it correctly would mean per-run intercept columns (or within-transforming every column),
which is a materially more complex least-squares problem than the shared primitive exposes, for a
case neither demo clip exercises. Not worth it now; if fragmented clips become the norm, this is
the direction to revisit, done properly.

### Rejected: fit only the longest run

Simple, and defensible on "the longest run is the best-sampled one". But it is strictly dominated
by D2's weighted median, which reduces to exactly this whenever the longest run holds more than
half the samples (D2's dominance property) and does something more sensible than discarding data
when it does not. No reason to take the weaker rule.

---

## D2 — Aggregation: a sample-count-weighted median that SELECTS an actual run's fit

With several contributing runs there are several amplitudes. The reported figure is a
**sample-count-weighted median**: sort the contributing runs by fitted amplitude (stable sort, so
equal amplitudes keep run order), then walk the sorted list accumulating `sampleCount` and take
the first run whose cumulative count, doubled, reaches the total — the lower weighted median.

The point of *selecting* rather than *blending* is that every reported diagnostic
(`frequencyHz`, `sinusoidR2`, `spanSeconds`, `sampleCount`, `observedCycles`, `totalR2`,
`secondPeakRatio`) then comes from **one coherent fit** of one real stretch of footage. An
averaged amplitude paired with an averaged R² describes no fit that ever happened, and the
cadence cross-check (`frequencyHz × 60` against the cadence metric) would be meaningless against a
blended frequency.

**Dominance property**: a run holding more than half the total samples always wins, whatever its
amplitude. Everything before it in sorted order sums to less than half the total, so the
cumulative test cannot trip early; the moment that run is added the cumulative exceeds half. A
noisy 15-sample fragment therefore can never outvote a 50-sample run — which is the failure mode
a plain (unweighted) median of run amplitudes would have.

- `sampleSize` = `Math.floor(Σ observedCycles)` over **all** contributing runs — the honest total
  of complete bounce cycles the calculation saw, not just the winner's. This mirrors the unit the
  pixel metric adopted when it moved to the spectral fit: complete BOUNCE cycles (one per step,
  half a gait cycle), not paired half-cycles.
- `integrationRuns` = number of contributing runs, keeping its existing meaning ("runs that
  contributed").

---

## D3 — Quality gate: `CM_MIN_FIT_R2 = 0.30`, a module constant

A run's fit must score `sinusoidR2 ≥ 0.30` (the sinusoid's PARTIAL R² over a trend-only baseline,
never total R²) to contribute. This replaces the now-dead `CM_MIN_PROMINENCE_TORSO_RATIO`, which
existed only to feed `findLocalExtrema`.

**Module constant, not a config key.** Same call this module already made for the prominence
constant it replaces, and for the same reason: this calculation is not a `MetricId`, has no card,
and is read only by dev diagnostics — a config key is the vocabulary for "a deployment might want
to tune this", and nothing consumes this number in a way that would make tuning meaningful yet.
The upgrade path is recorded rather than pre-built: **#36 promotes this to a config key** if and
when a rendered card's availability depends on it.

**Calibration.** 0.30 is the same number, from the same calibration, as
`verticalOscillationMinFitR2` and `cadenceMinFitR2` — and the transfer is sound for the same
reason cadence's reuse is sound: the same hip samples at the same n. Live MediaPipe runs give
n = 57 (track) and n = 84 (park), inside the n ≈ 50+ band the 0.30 figure was calibrated for
(measured pure-noise partial R²: p95 ≈ 0.22, p99 ≈ 0.28 at n = 50, against a worst observed real
trial of 0.40).

**n-regime caveat, and where it bites harder here than anywhere else.** The pure-noise floor
climbs steeply as n falls: p95 ≈ 0.34 at n = 30, 0.44 at n = 20, 0.64 at n = 12. Because this
module fits PER RUN, a fragmented clip can reach the primitive's 12-sample floor, where a 0.30
gate is **not protective at all** — noise clears it more often than not. That is not hidden: the
winning run's `fit.sampleCount` is reported, so a reader can see the regime the number came from.
The n-invariant replacement is an F-test on the fit's 2 sinusoid degrees of freedom against its
residual degrees of freedom; it is deferred, and when it lands it replaces all three gates
together (`verticalOscillationMinFitR2`, `cadenceMinFitR2`, and this constant), not one of them.

**Signature.** `computeVerticalOscillationCm(frames, config: HeuristicsConfig =
DEFAULT_HEURISTICS_CONFIG)`. The frequency grid is read from config rather than hardcoded
specifically so that retuning the shared grid moves this calculation with it — a hardcoded copy
would silently diverge from cadence and quietly break the `frequencyHz × 60` vs. cadence
cross-check that is this change's cheapest live sanity test. The single call site
(`useVideoAnalysis.ts`) relies on the default and needs no change.

---

## D4 — Result shape

```ts
export interface ScaleCalibratedVerticalOscillation {
  verticalOscillationCm: number | null   // fitted PEAK-TO-PEAK, cm
  sampleSize: number                     // complete bounce cycles across contributing runs
  fit: ScaleCalibratedFit | null         // non-null exactly when the value is
  fitFailureReason: ScaleCalibratedFitFailureReason | null  // non-null exactly when value is null
  scaleDriftRatio: number
  medianPixelsPerMeter: number
  torsoMeters: number | null
  scaleCoverage: number
  integrationRuns: number
}

export type ScaleCalibratedFitFailureReason =
  | SpectralFitFailureReason      // 'too-few-samples' | 'degenerate-signal' | 'insufficient-cycles'
  | 'below-quality-gate'
  | 'no-usable-run'
```

`ScaleCalibratedFit` mirrors `VerticalOscillationFit` field-for-field, with the amplitude named
`peakToPeakAmplitudeCm` for the unit it is actually in: `frequencyHz`, `sinusoidR2`, `totalR2`,
`secondPeakRatio`, `sampleCount`, `spanSeconds`, `observedCycles`.

`frequencyHz` is free and worth having: `frequencyHz × 60` is a steps-per-minute reading of the
same body's same rhythm as the `cadence` metric, derived through an entirely separate series (the
integrated metric series, not the raw pixel trace). A large disagreement between the two in one
diagnostics dump means one of the fits landed on a harmonic or a grid edge — a real defect that
would otherwise take a dedicated investigation to notice.

**Three distinguishable outcomes**, where there used to be two:

| outcome | shape |
|---|---|
| no frame carried a scale | the whole return is `null` (unchanged) |
| measured, but nothing fittable | object exists, `verticalOscillationCm: null`, `fit: null`, `fitFailureReason` names which of the five reasons; `scaleDriftRatio` / `medianPixelsPerMeter` / `torsoMeters` / `scaleCoverage` still populated |
| measured and fitted | `verticalOscillationCm` non-null, `fit` non-null, `fitFailureReason: null` |

That middle row is the point of `fitFailureReason`: an unexplained `null` amplitude is
indistinguishable from a bug, and #36's excluded-metric tier renders exactly this string.

**Multi-run reason arbitration.** When no run contributes, the reported reason is the reason of
the **longest** run that produced one (ties broken toward the earliest run) — the longest run is
the one whose verdict carries the most evidence. Runs dropped for carrying no scale at all produce
no verdict (they were never fitted). When there are no runs at all, or every run was scale-less,
the reason is `'no-usable-run'`.

---

## D5 — Under a constant scale, matching the pixel path is now an ALGEBRAIC IDENTITY

Worth stating because it changes what the cross-path test is testing. Under a constant scale `s`
the metric series telescopes to `v[k] = (y[0] − y[k]) / s` — an **affine image** of the pixel
series the pixel path fits, over the same samples at the same timestamps. Affine responses do not
change a least-squares problem's geometry:

- the constant offset is absorbed exactly by the intercept column (and by the primitive's
  mean-centering before that),
- every candidate frequency's RSS scales by the same factor `1/s²`, so the argmin — the winning
  grid frequency `f*` — is **identical**,
- `sinusoidR2 = 1 − RSS(f*)/RSS_trendOnly` is a ratio of two quantities that both scale by
  `1/s²`, so it is **identical**,
- the amplitude scales by exactly `1/s`.

Before this change the two paths used different estimators and could only be expected to agree
approximately, on a fixture built so that extrema land exactly on peaks. Now they agree by
algebra, so the test is tightened accordingly: equal `sampleSize` (both count cycles now), exactly
equal `frequencyHz`, `sinusoidR2` equal to 9 decimal places, and `peakToPeakAmplitudeCm` equal to
the pixel fit's amplitude ÷ scale × 100 to 9 decimal places. A future regression in either path
that breaks the identity now fails loudly instead of hiding inside a loose tolerance.

---

## D6 — Config is read for the GRID ONLY; the signal stays hip-pinned

Threading `HeuristicsConfig` in creates one hazard worth naming, because a reader who sees a
config parameter reasonably assumes `verticalOscillationSignal` applies: it does not, and must
not. This calculation is anchored to the hip/shoulder torso segment unconditionally — the whole
scale calibration is derived from that segment, and `torsoMeters`' ~0.5 m sanity check only means
anything against it. The config is read for three keys and no others:
`spectralFitMinFrequencyHz`, `spectralFitMaxFrequencyHz`, `spectralFitFrequencyStepHz`.

This is pinned by a test that passes `verticalOscillationSignal: 'earMid'` against a fixture whose
head bounces 3× its hips and asserts the centimetre figure is unchanged — a real pin now that
config is actually threaded through, where before the same test could only observe that no config
parameter existed.

`types.ts` carries two doc comments asserting the old, now-false claim ("takes no config at all");
both are reworded to the surviving claim — ignores `verticalOscillationSignal`, hip-based
unconditionally, reads config only for the shared spectral grid. No config key is added.

**Spec-delta note.** The `form-heuristics` scenario `Amplitudes are never paired across an
integration-run boundary` keeps its exact original title even though nothing pairs anything any
more, and its body is restated for the fit-based mechanism. It was going to be renamed to "A run's
baseline offset never becomes amplitude" — `openspec validate --strict` rejects that: a MODIFIED
requirement must retain every scenario title the current spec has, and there is no scenario-level
rename in the delta grammar (only requirement-level `RENAMED`). Renaming would have required
REMOVE+ADD of the whole requirement, which misstates what changed: the requirement's identity is
the CONVERSION, and the conversion is untouched. The new title survives as the unit test's name.

**Consequence worth stating loudly**: dropping the prominence threshold drops this calculation's
only use of `torsoLengthPx` as an *input*. A clip with no resolvable body-scale reference could
previously never report centimetres; now it can, with `torsoMeters: null`. That is a deliberate
widening — `torsoLengthPx` was never part of the conversion, only of a threshold that no longer
exists — and it is recorded in the proposal's Impact rather than left for review to discover.
