## Why

Issue #29 (epic #27). Shipped `computeCadence` derives cadence as `60 / median(inter-footstrike
interval)` from `detectFootstrikes` — spurious footstrikes shrink the median interval and inflate
the reading. Measured on the track demo clip: footstrike-path cadence reads 120–150 spm (median
125) against an independent ankle-crossing ground truth of 91–98 spm, a ~30% high bias. Over the
same clip, the shared spectral primitive from #28 (`fitSpectralSinusoid`, already vertical
oscillation's estimator as of `adopt-spectral-vo-estimator`) fits the hip-y trace at 1.56 Hz,
and `1.56 × 60 = 93.6` spm — inside the ground-truth band. On the park clip the two approaches
happen to agree (~180 vs. 186 GT), so the bias isn't visible on every clip, which is exactly what
makes it dangerous: a spurious-footstrike inflation that only shows up on some camera angles or
running styles.

The physical basis: this pipeline's hip bounces twice per full gait cycle (`syntheticGait.ts`
builds hip-y at `2 × strideFreqHz`, where `strideFreqHz = cadenceStepsPerMin / 120`) — i.e. once
per STEP, not once per stride. So the fitted bounce frequency `f*` is already steps/sec, and
`f* × 60` is directly steps/minute with no correction factor. Harmonic confusion was ruled out
during investigation (RSS curves single-peaked, no power at `2f*`).

Cadence and vertical oscillation now read the *same* hip-mid trace under the *same* spectral
primitive — reading it twice (once per metric, with two divergent traversal/build code paths)
would be a needless invitation for the two computations to drift apart. This change extracts a
shared `analyzeHipBounce` signal module and rewrites `computeCadence` to consume its `fit.frequencyHz`
directly.

## What Changes

- **New `src/heuristics/hipBounce.ts`**: `analyzeHipBounce(frames, config)` — owns the
  `resolveMidpoint('left_hip', 'right_hip')` traversal, resolved/interpolated counting,
  `SpectralSample[]` construction, and the `fitSpectralSinusoid` call (over the shared
  `spectralFit*` grid config), returning `{ hipY, resolvedCount, interpolatedCount,
  frameCoverage, interpolatedFraction, fit }`. Both `computeVerticalOscillation` and
  `computeCadence` call it independently — a second, bit-identical refit per call, the same shape
  `detectFootstrikes` already uses as a shared extractor for overstriding/cadence/foot-strike-pattern.
- **`src/heuristics/verticalOscillation.ts`** is refactored, not behaviorally changed, to call
  `analyzeHipBounce` instead of its own inline traversal/build/fit. Zero test-assertion changes —
  see design.md D2's acceptance gate.
- **`src/heuristics/cadence.ts`** is rewritten: `detectFootstrikes` is no longer imported.
  `value = fit.frequencyHz × 60`. Gated on a new `cadenceMinFitR2` (0.30) partial-R² threshold,
  same discipline as #28's vertical-oscillation gate, with **no fallback** to the old footstrike
  path and no cross-check/agreement caveat against it — the measured disagreement is evidence the
  footstrike path was wrong, not evidence of uncertainty worth flagging both ways.
  `estimateBodyScale` is no longer read directly by cadence (only via `analyzeHipBounce`'s hip
  traversal) — cadence becomes MORE available, since it only needs a resolvable hip, not a
  resolvable shoulder+hip pair.
- **`sampleSize` is redefined** from footstrike count to `floor(fit.observedCycles)` — now a STEP
  count (bounce cycles = steps, by the physical basis above), fed the unrounded cycle count for
  confidence, floored only for the reported field/caveat text — mirroring vertical oscillation's
  existing `sampleSize`/confidence split exactly.
- **`MIN_CADENCE_SAMPLE_SIZE` (4) is renamed `MIN_CADENCE_STEPS`**, value unchanged, doc rewritten
  to explain why cadence's minimum stays higher than vertical oscillation's 3 bounce-cycle minimum
  even though both now read the same signal.
- **`viewFitTable.cadence.front.multiplier` moves 0.8 → 0.85**, matching vertical oscillation's
  front-view discount exactly — the old 0.8 was justified by ankle-occlusion risk near a
  footstrike, which no longer applies now that cadence reads the identical hip-only input series
  vertical oscillation does.
- **New band-edge caveat**: if `f*` lands within one grid step of `spectralFitMinFrequencyHz` or
  `spectralFitMaxFrequencyHz`, a caveat names the searched frequency range — a factual statement,
  not a tuned threshold; the shared grid (`spectralFitMinFrequencyHz`/`MaxFrequencyHz`/`StepHz`,
  1.2–4.0 Hz) is reused unchanged from vertical oscillation.
- **`src/heuristics/__fixtures__/hipTraceFrames.ts`** (new): `framesFromHipTrace` and its
  supporting seeded-noise helpers, promoted out of `verticalOscillation.test.ts` so
  `cadence.test.ts` and `hipBounce.test.ts` can share them.
- **Separate, doc-only commit**: fixes a pre-existing mislabel — `observedCycles` counts BOUNCE
  cycles, which are STEPS (this ticket's own physical basis), not "complete gait cycles" as
  `verticalOscillation.ts`'s module doc, `types.ts`'s `verticalOscillationMinCycles`/
  `MetricResult.sampleSize` docs, and one line of the archived `adopt-spectral-vo-estimator` spec
  currently say. Does not change the number `3` — only the noun.

## Capabilities

### New Capabilities

<!-- none: this replaces the estimator behind an existing form-heuristics metric -->

### Modified Capabilities

- `form-heuristics`: replaces cadence's footstrike-median-interval requirement with a
  hip-bounce-spectral-frequency one, and replaces cadence's view-tolerance requirement (whose
  title claimed a front-view discount steeper than vertical oscillation's, now false) with one
  stating the two metrics share identical view-fit terms. `verticalOscillation`'s own requirements
  are unaffected — see design.md's "relied on, not modified" list.

## Impact

- New: `src/heuristics/hipBounce.ts` + `src/heuristics/hipBounce.test.ts`,
  `src/heuristics/__fixtures__/hipTraceFrames.ts`.
- Rewritten: `src/heuristics/cadence.ts` (+ test).
- Refactored (no behavior change): `src/heuristics/verticalOscillation.ts` — imports-only change
  to its test.
- Modified: `src/heuristics/types.ts` (`cadenceMinFitR2`, reworded `spectralFit*` docs,
  `viewFitTable.cadence.front` 0.8 → 0.85 + comment rewrite, `MetricResult.sampleSize` doc).
  `src/heuristics/index.test.ts` (drift-guard assertion).
- Untouched: `src/heuristics/footstrikes.ts` and its other consumers (`overstriding.ts`,
  `footStrikePattern.ts`).
- Doc-only, separate commit: `src/heuristics/verticalOscillation.ts` module doc,
  `src/heuristics/types.ts` (`verticalOscillationMinCycles`, `MetricResult.sampleSize`),
  `openspec/changes/adopt-spectral-vo-estimator/specs/form-heuristics/spec.md`.
- **Behavior change users can see**: cadence numbers move — the track demo clip's reported cadence
  drops from the 120–150 spm range to ~85–105 spm (a correction toward ground truth, not a
  regression), and its confidence/sampleSize shift as pre-declared in design.md D4. A front-view
  clip's cadence confidence rises slightly (0.8 → 0.85 multiplier).
