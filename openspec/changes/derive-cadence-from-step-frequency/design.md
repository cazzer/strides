# Design — derive cadence from spectral step frequency

## Context

`computeCadence` reports `60 / median(consecutive inter-footstrike-interval seconds)`, where the
intervals come from `detectFootstrikes` (a prominence-thresholded extrema scan of each ankle's
y-series). Epic #27's investigation (issue #29) measured that estimator ~30% high on the track
demo clip: 120–150 spm (median 125) against an independent ankle-crossing ground truth of 91–98
spm. Spurious footstrikes — extra prominence-confirmed ankle-y extrema that aren't real
ground-contact events — shrink the median inter-strike interval, and a shrunk interval inflates
`60 / interval`. On the park clip the two approaches happen to agree (~180 vs. 186 GT), which is
exactly what makes the bug dangerous: it's invisible on some clips and clip-camera-angle-dependent
on others.

**Physical basis.** This pipeline's hip-mid y-trace bounces twice per full gait cycle — once per
STEP, not once per stride. `syntheticGait.ts` builds `hipMidY` at `2 × strideFreqHz`, where
`strideFreqHz = cadenceStepsPerMin / 120` (two steps per stride, both feet), so bounce frequency
`= 2 × cadenceStepsPerMin / 120 = cadenceStepsPerMin / 60`. Inverting: `cadenceStepsPerMin = bounce
Hz × 60`. The spectral fit's `f*` (already computed for vertical oscillation, via #28's
`fitSpectralSinusoid`) IS the bounce frequency, so `f* × 60` is directly steps/minute — no
harmonic-count correction factor, no calibration constant. Harmonic confusion (fitting `2f*`
instead of `f*`, which would silently double-count) was ruled out during the investigation: RSS
curves over the frequency grid are single-peaked, with no secondary power concentration at `2f*`.

Seven decisions below (D1–D7) were made against this basis and the measured evidence in issue #29;
none are to be revisited inside this ticket.

## D1 — Pure spectral `f* × 60`. No footstrike fallback, no cross-check

**Decision.** `cadence.ts` stops importing `detectFootstrikes` entirely. `value = fit.frequencyHz
× 60`. No fallback to the footstrike path when the spectral fit is weak or absent, and no
agreement/disagreement caveat comparing the two.

**Why no fallback.** Same reasoning #28 already established for vertical oscillation (D1 there): a
quality-gated fallback flips estimators run-to-run precisely on the clips where the two disagree
most, converting a stable bias into discontinuous variance.

**Why no cross-check caveat.** The measured disagreement (track: footstrike-path 120–150 spm vs.
ground truth 91–98 spm vs. spectral fit 93.6 spm) is not "these two methods disagree, trust neither
fully" — it is specific, one-sided evidence that the FOOTSTRIKE path is the wrong one. Surfacing an
"estimators disagree" caveat would misrepresent a known bug as generic uncertainty. Separately,
there is no calibrated threshold for what counts as meaningful disagreement — the evidence base is
two clips (n=2), nowhere near enough to fit a boundary — and per this repo's house rule from #28's
D3 ("no uncalibrated coefficients feed a user-visible score"), inventing one anyway would be worse
than omitting the caveat.

**`detectFootstrikes` and its other consumers are untouched.** `overstriding.ts` and
`footStrikePattern.ts` still call it exactly as before — this ticket's scope is cadence's estimator
only. (The footstrike over-triggering that likely also biases those two metrics is explicitly
out of scope for this ticket per issue #29's notes — a candidate follow-up, not fixed here.)

## D2 — Shared signal module `src/heuristics/hipBounce.ts`

**Decision.** Extract the hip-mid traversal, resolved/interpolated counting, `SpectralSample[]`
construction, and `fitSpectralSinusoid` call that `computeVerticalOscillation` already does inline
into a new pure function:

```ts
function analyzeHipBounce(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): {
  hipY: Array<number | null>       // one entry per frame, timestamp-aligned; null where unresolvable
  resolvedCount: number
  interpolatedCount: number
  frameCoverage: number            // resolvedCount / frames.length
  interpolatedFraction: number     // interpolatedCount / resolvedCount
  fit: SpectralFitResult
}
```

It owns exactly what vertical oscillation's inline code already owned:
`resolveMidpoint(frame, 'left_hip', 'right_hip')` per frame, the resolved/interpolated counters,
building `SpectralSample[]` from the resolvable subset, and calling `fitSpectralSinusoid` with the
shared `spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` config
keys. It does NOT own policy — no R² gate, no caveat text, no confidence computation — those stay
in each caller, exactly as `spectralFit.ts`'s own module doc already prescribes for the primitive
one level down ("division of responsibility": well-posedness lives in the shared module, policy
lives in the caller).

Guards: `frames.length === 0` → `frameCoverage: 0` (not a `0/0` NaN); `resolvedCount === 0` →
`interpolatedFraction: 0` (not a `0/0` NaN) — both direct ports of the guards
`computeVerticalOscillation` already has inline.

**Both callers refit independently.** `computeVerticalOscillation` is refactored to call
`analyzeHipBounce` instead of its own inline code (`runMeanHipY` for the chart baseline is
still computed from the returned `hipY` — charting stays vertical oscillation's own concern, not
`hipBounce.ts`'s). `computeCadence` calls `analyzeHipBounce` independently. This means the fit
runs twice per clip when both metrics compute — an accepted, deliberate redundancy: the fit is a
pure function over an immutable `RobustPoseFrame[]` input, so both calls are bit-identical, and
141 grid candidates × a few hundred samples is sub-millisecond (measured in #28's design.md)
against a pipeline that spends tens of seconds in pose detection. Precedent:
`detectFootstrikes` is already a shared extractor called independently by
`overstriding`/`cadence`(previously)/`footStrikePattern`, each re-running the same scan rather than
threading a shared result object through `computeFormHeuristics`. Metric function signatures are
unchanged (`frames, view, config?`) — no new orchestration plumbing.

**Module doc** states plainly: this is the shared hip-bounce SIGNAL, not a metric. Vertical
oscillation reads its fitted amplitude; cadence reads its fitted frequency. POLICY (quality gates,
caveats, confidence) is each caller's own, not this module's.

**Hard acceptance gate.** `verticalOscillation.test.ts` must pass with ZERO assertion changes —
only import lines may move (to `hipTraceFrames.ts`, see D2's fixture note below). If any assertion
needs editing to make the refactor pass, the refactor changed behavior, which is out of scope: stop
and fix the refactor, not the test.

## D3 — Policy: `cadenceMinFitR2 = 0.30`, never falls back

**Decision.** New `HeuristicsConfig` key `cadenceMinFitR2: 0.30`. Below it, `computeCadence`
reports `value: null`, `confidence: 0`, and a caveat naming both the measured partial R² and the
threshold — the same shape vertical oscillation's own sub-threshold caveat already takes. There is
no fallback to any other estimator (D1).

**Why the calibration transfers from vertical oscillation's, at the same value.** Cadence's fit
reads the IDENTICAL series vertical oscillation's does — same `analyzeHipBounce` call, same `n` by
construction (not merely similar; the same frames produce the same resolvable-hip count for both
metrics on a given clip). #28's noise-floor calibration (2000 seeded pure-noise trials at n=50:
p95 ≈ 0.217, p99 ≈ 0.283) and its real-footage floor (worst observed real trial: 0.397) both apply
unchanged, because they were never really about vertical oscillation's semantics — they're a
property of `fitSpectralSinusoid`'s degrees of freedom at a given sample count. Live sample counts
for cadence match vertical oscillation's own (47–81 resolvable hip samples across live runs,
same measurement, same frames).

**This does NOT transfer to other sample-count regimes.** The noise floor is steeply n-dependent
(measured in #28: p95 ≈ 0.22 at n=50, 0.34 at n=30, 0.44 at n=20, 0.64 at n=12) — a fixed 0.30
threshold is safe here only because cadence, like vertical oscillation, operates at n ≈ 50+ in
practice. Restated here rather than only in #28's design.md because this is the second caller to
rely on it, and the risk of silent reuse at a lower n grows with each caller that doesn't restate
the precondition.

**Upgrade path, not implemented here.** An F-test on the 2 sinusoid degrees of freedom against
`n − 5` residual degrees of freedom would replace both `verticalOscillationMinFitR2` and
`cadenceMinFitR2` with a single n-invariant significance level. Out of scope for this ticket —
same reasoning as #28's D2: it changes the config surface shape and needs its own calibration
against the 141-candidate grid's multiple-comparisons structure. Noted here as a UNIFIED
upgrade (both keys replaced together, not just cadence's), so nobody upgrades one threshold and
leaves the other on the old scheme.

**Not gated on `secondPeakRatio`.** `spectralFit.ts` already documents that no calibration
evidence exists for what `secondPeakRatio` value should cost how much confidence (#28's D3), and
this ticket doesn't change that. Concretely on the park clip: `secondPeakRatio` measures
0.345–0.45, which reads like "a real competing rhythm" but is actually the winner's own shoulder —
2.6 Hz sits at the edge of the `max(0.4 Hz, 1/spanSeconds)` exclusion band around `f*`, so the band
is under-excluding rather than a second rhythm genuinely competing. That's a real, documented bug
in `secondPeakRatio`'s exclusion-band sizing (also flagged in #28's design.md "known
imprecision") — it needs fixing before ANYONE gates on it, cadence included. Not fixed here.

## D4 — `sampleSize` = steps; confidence mirrors #28

**`sampleSize = Math.floor(fit.observedCycles)`.** The unit does not change from before (cadence's
`sampleSize` was already meant to read as "how many steps/strikes contributed") — what changes is
that the count is now accurate, since it comes from the fit's actual observed-cycle span rather
than a footstrike count that could include spurious detections. Confidence is fed the UNROUNDED
`fit.observedCycles`, exactly mirroring vertical oscillation's own floored-for-display /
unrounded-for-confidence split (#28 D3) and for the identical reason: flooring in the confidence
computation would turn a difference smaller than the fit's own frequency resolution into a
confidence cliff.

**`MIN_CADENCE_SAMPLE_SIZE` renamed `MIN_CADENCE_STEPS`, value unchanged at 4.** Both this
constant and vertical oscillation's `verticalOscillationMinCycles` (3) now read literally the same
unit off literally the same underlying signal, and are deliberately NOT unified into one shared
constant. Cadence wants a higher minimum because frequency-estimate precision from a finite window
scales with `1/T²` (a spectral estimator's frequency resolution improves with the SQUARE of
observation time, not linearly) — vertical oscillation only needs enough cycles for its AMPLITUDE
estimate to be stable, a weaker requirement than cadence's need for FREQUENCY precision tight
enough to report a number to 1 decimal spm. Documented at both sites (this module and
`verticalOscillationMinCycles`'s doc in `types.ts`) specifically so nobody "simplifies" this into
one shared minimum later without re-deriving why they differ.

**`fitQuality` ramp**, cadence's own policy exactly mirroring vertical oscillation's:

```
fitQuality = clamp01((sinusoidR2 − cadenceMinFitR2) / (FIT_QUALITY_SATURATION_R2 − cadenceMinFitR2))
FIT_QUALITY_SATURATION_R2 = 0.8   // module constant in cadence.ts, not config — same reasoning as #28 D3
```

**`frameCoverage`/`interpolatedFraction` now come from the hip series**, via
`analyzeHipBounce`'s returned `frameCoverage`/`interpolatedFraction` — previously `frameCoverage`
was `bodyScale.sampleCoverage` (shoulder+hip presence) and `interpolatedFraction` was computed
per-footstrike from the ankle-at-strike point. This is a genuine semantic change, visible in
diagnostics: coverage now answers "how much of the clip had a resolvable HIP", not "how much had a
resolvable shoulder+hip pair" or "were the footstrike-adjacent ankle samples interpolated" — a
narrower, more directly-relevant-to-the-actual-signal-used question. Called out explicitly here and
in the spec delta rather than treated as incidental.

**Caveats joined #28-style**: each shortfall that applies (step-count shortfall, sub-saturation fit
quality, band-edge frequency) is named independently and joined with a space, rather than picking
one to report — mirrors vertical oscillation's existing multi-caveat join exactly.

**Pre-declared expected live effects** (record as expected in tasks.md, not treated as
regressions if observed):
- Track clip: confidence moves from ≈1.00 (old footstrike-path, saturated) to ≈0.72 (2.87 steps
  vs. `MIN_CADENCE_STEPS` 4 → sample-size factor ≈0.72, other factors near 1); `sampleSize` moves
  5 → 2 (footstrike count → floored step count).
- Park clip: confidence moves from ≈0.80 to ≈0.66 — crosses `MetricsPanel`'s 0.7 High/Medium
  display threshold. This is an accurate reflection of the fit's own quality (park's sinusoid R²
  sits around 0.69–0.71 per #28's live results), not a bug.
- The known track outlier trial (previously observed at partial R² 0.397, 104.4 spm) lands around
  0.17 confidence under the new computation — correctly flagged as unreliable rather than reported
  at the old path's misleadingly high confidence.

## D5 — Grid reuse + band-edge caveat

**Reuse `spectralFitMinFrequencyHz`/`MaxFrequencyHz`/`FrequencyStepHz` unchanged** (1.2–4.0 Hz =
72–240 spm at the `× 60` conversion). Their `types.ts` doc comments are reworded from
vertical-oscillation-specific language to state they are SHARED across both callers, and to state
the steps/min equivalence explicitly (72–240 spm) alongside the existing Hz framing, since cadence
readers think in spm, not Hz.

**New band-edge caveat**: if `f*` lands within one grid step (`spectralFitFrequencyStepHz`, 0.02
Hz) of either `spectralFitMinFrequencyHz` or `spectralFitMaxFrequencyHz`, cadence's caveat names
the searched frequency range. This is a factual statement about where the grid search landed — a
result pinned at a grid edge means the true frequency might lie outside the searched band entirely
— not a tuned threshold with calibration behind it. Confirmed to fire on neither demo clip during
live verification (both land well inside the band).

**No sub-grid interpolation.** `spectralFitFrequencyStepHz` (0.02 Hz) is already finer than the
frequency resolution any few-second clip supports (0.02 Hz = 1.2 spm, well under a spectral
estimate's actual achievable precision at these clip lengths) — refining further would report false
precision, not real precision.

## D6 — Drop `estimateBodyScale` from cadence

**`f* × 60` is scale-free** — a frequency doesn't need a pixel-to-torso-length normalizer the way
an amplitude does. `computeCadence` no longer calls `estimateBodyScale` directly; the only
body-derived quantity it reads is `analyzeHipBounce`'s hip-mid traversal.

**No-input null path becomes hip-based.** The old "no resolvable body-scale reference
(shoulders/hips)" null path is replaced with "No resolvable hip position in this clip." — the same
wording vertical oscillation already uses for its own no-hip null path (`resolvedCount === 0` in
`analyzeHipBounce`'s caller). Cadence becomes MORE available as a side effect: a clip with
resolvable hips but no resolvable shoulders (previously blocked cadence entirely, since
`estimateBodyScale` needs both) now reports a cadence value.

**Spec impact, flagged rather than delta'd.** The `form-heuristics` requirement "Metrics are
computed over a presence-trimmed window, not the raw clip" has a scenario ending "...every metric
falls back to its existing no-resolvable-body-scale-reference null result, exactly as it would for
an all-unresolvable clip today." For cadence specifically, that phrase now reads as "the
no-resolvable-hip null result" — a narrower, cadence-specific instance of the same behavior CLASS
(a metric's own documented null path fires when its own required input is entirely absent), not a
behavior reversal. No MODIFIED block raised for it, on the same precedent #28's design.md already
established for an analogous narrowing (its "Vertical oscillation is view-tolerant" flag, see that
change's "Spec interactions and known follow-ups"). Flagged here for the archive step in case a
reviewer reads it differently.

## D7 — `viewFitTable.cadence.front.multiplier` 0.8 → 0.85

**Decision.** Cadence's front-view multiplier moves from 0.8 to 0.85, matching vertical
oscillation's exactly.

**Why the old 0.8 is now wrong, not just inconsistent.** The shipped 0.8 was justified (in the old
`types.ts` comment) by ankle-occlusion risk specific to footstrike detection: "near each footstrike
the swing leg's ankle passes close to the stance leg's on screen face-on... a missed or spurious
extremum here directly biases the countable footstrike total." That justification is about ANKLE
tracking, which cadence no longer reads at all (D1, D6) — the justification is falsified by this
change's own premise, not merely superseded. Cadence's input is now byte-identical to vertical
oscillation's (same `analyzeHipBounce` call, same hip-mid series, same view-projection
characteristics), so there is no remaining basis for a steeper front-view discount than vertical
oscillation's own 0.85. `types.ts`'s comment block for `viewFitTable.cadence` is rewritten to state
this directly rather than incrementally edited, since the old comment's entire premise (ankle
occlusion) no longer applies.

**Spec handling.** Because the falsified requirement's own TITLE claims a front-view discount
"steeper than vertical oscillation's" — no longer true — this is handled as REMOVE + ADD (per this
repo's CLAUDE.md guidance: "if a requirement's behavior fully reverses... cleaner to REMOVE the old
one... rather than fighting the validator over a MODIFIED block that no longer resembles the
original"), not a MODIFIED block.

## Requirements this change relies on but does not modify

Cited so a reviewer can confirm none of them needed a delta:

- form-heuristics, **"Cadence participates in the shared orchestration and output contract"** —
  unchanged. `FormHeuristicsResult.cadence` is still a plain `MetricResult`, still computed under
  the same once-per-clip detected view, still `value: null`/`confidence: 0` for an empty frame
  list without throwing. No new diagnostics key: `AnalysisDiagnostics` already gets vertical
  oscillation's fit via `verticalOscillationFit`, and cadence's own frequency is always exactly
  `cadence.value / 60` on any non-null result (see the index.test.ts drift-guard added by this
  change), so no separate fit-diagnostics field is needed for cadence.
- form-heuristics, **"Output contract — value and confidence are always present, never NaN, never
  throws"** — still satisfied; `hipBounce.ts` never divides without a guard (D2), and
  `fitSpectralSinusoid` already returns typed failures rather than NaN.
- form-heuristics, **"Missing and interpolated keypoints are handled per a shared, documented
  policy"** — unchanged in substance; cadence's interpolated-fraction accounting moves from a
  per-footstrike ankle check to `analyzeHipBounce`'s hip-mid check (D4), but the policy itself
  (tolerant midpoint resolution, interpolated fraction feeding confidence) is the same shared
  policy the requirement describes, just applied to a different resolved point per this metric's
  new input.
- form-heuristics, **"Orchestration runs view detection once and shares it across all three
  metrics"** — unchanged; `computeFormHeuristics` still calls `detectView` once and passes the
  same `View` into `computeCadence` as every other metric.
- form-heuristics, **"Metrics are computed over a presence-trimmed window, not the raw clip"** —
  unchanged; `analyzeHipBounce`, like the old inline code, consumes whatever window it's handed.
  See D6 for the narrowing note on this requirement's no-resolvable-body-scale-reference scenario
  as it applies specifically to cadence.

## Rejected alternatives (evidence-based; out of scope for this ticket)

- **Spectral primary, footstrike count as cross-check/caveat** — the design decision named as an
  option in issue #29 itself. Rejected per D1: the measured disagreement is one-sided evidence the
  footstrike path is wrong, not balanced uncertainty worth flagging symmetrically, and no
  calibrated disagreement threshold exists at n=2 clips.
- **Gating on `secondPeakRatio`** — see D3; the park clip's own numbers show why this would be
  actively misleading right now (a shoulder-of-the-winner artifact, not real ambiguity).
- **Unifying `MIN_CADENCE_STEPS` and `verticalOscillationMinCycles` into one constant**, now that
  both read the same signal — see D4; the two answer different precision questions (frequency
  precision vs. amplitude stability) despite sharing a unit.
- **Fixing `secondPeakRatio`'s exclusion-band sizing** — real bug, flagged in D3, not this
  ticket's scope (it belongs to `spectralFit.ts`, shared with vertical oscillation, and neither
  caller currently gates on it, so fixing it isn't blocking either).
