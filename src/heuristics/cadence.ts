import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { analyzeHipBounce } from './hipBounce'
import type { SpectralFitFailureReason } from './spectralFit'
import { computeMetricConfidence } from './confidence'
import { clamp01 } from './mathUtils'
import type { RobustPoseFrame } from '../pose/robustness/types'

/**
 * Minimum step count below which confidence is penalized via the sampleSize factor. Same UNIT as
 * vertical oscillation's `verticalOscillationMinCycles` (both now count complete hip-bounce
 * cycles off the identical shared fit — see `hipBounce.ts`), and deliberately NOT the same value.
 * Cadence needs a higher minimum than vertical oscillation's 3: a spectral estimator's FREQUENCY
 * resolution improves with the SQUARE of observation time (more cycles buys disproportionately
 * more precision on "how fast", the number cadence reports), where vertical oscillation only
 * needs enough cycles for a stable AMPLITUDE estimate — a weaker requirement. Kept as a separate
 * constant, at the same value (4) the old footstrike-count minimum used, specifically so nobody
 * "simplifies" the two metrics onto one shared minimum without re-deriving why they differ — see
 * `verticalOscillationMinCycles`'s doc in `types.ts` for the mirror-image note.
 */
const MIN_CADENCE_STEPS = 4

/**
 * Sinusoid partial R² at or above which the fit is treated as fully trustworthy — mirrors
 * `verticalOscillation.ts`'s `FIT_QUALITY_SATURATION_R2` exactly, for the identical reason: a
 * module constant, not config, because it only shapes the ramp between the gate
 * (`cadenceMinFitR2`) and "as good as a clean clip gets", and moving it independently of the gate
 * would only make the two numbers disagree.
 */
const FIT_QUALITY_SATURATION_R2 = 0.8

function nullResult(viewFit: MetricResult['viewFit'], caveat: string): MetricResult {
  return {
    metric: 'cadence',
    value: null,
    unit: 'stepsPerMinute',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
  }
}

function caveatForFailure(reason: SpectralFitFailureReason, sampleCount: number): string {
  switch (reason) {
    case 'too-few-samples':
      return `Hip position resolved in only ${sampleCount} frame(s) — too few to fit a step rhythm.`
    case 'insufficient-cycles':
      return 'Hip position was tracked, but the clip is too short to contain a complete step.'
    case 'degenerate-signal':
      return 'Hip position was tracked, but showed no oscillating vertical motion to measure.'
  }
}

/** `true` when the winning frequency sits within one grid step of either edge of the searched
 * band — a result there means the true frequency might lie outside the band entirely, which is
 * worth naming even though nothing here says which direction it might be off. A small epsilon
 * absorbs float roundoff in how the grid's candidate frequencies are generated. */
function isNearGridEdge(frequencyHz: number, config: HeuristicsConfig): boolean {
  const tolerance = config.spectralFitFrequencyStepHz + 1e-9
  return (
    frequencyHz - config.spectralFitMinFrequencyHz <= tolerance ||
    config.spectralFitMaxFrequencyHz - frequencyHz <= tolerance
  )
}

/**
 * Cadence: steps per minute, both legs combined, from the SAME shared hip-bounce spectral fit
 * vertical oscillation uses (`hipBounce.ts`'s `analyzeHipBounce`) — `value = frequencyHz × 60`.
 *
 * ## Why `× 60` needs no correction factor
 *
 * This pipeline's hip-mid y-trace bounces TWICE per full gait cycle — once per STEP, left and
 * right, not once per stride. `syntheticGait.ts`'s fixture makes this explicit: hip-y oscillates
 * at `2 × strideFreqHz`, where `strideFreqHz = cadenceStepsPerMin / 120` (two steps per stride,
 * both feet combined), so bounce frequency `= cadenceStepsPerMin / 60`. Inverting:
 * `cadenceStepsPerMin = frequencyHz × 60` — the fitted bounce frequency IS the step frequency,
 * directly, with no harmonic-count factor to apply or calibrate. (Harmonic confusion — fitting
 * `2×` the true frequency, which would silently double-count — was ruled out during the
 * investigation that motivated this estimator: RSS curves over the frequency grid are
 * single-peaked, with no secondary power concentration at `2f*`.)
 *
 * ## Why this replaced a footstrike-interval estimator, and why there is no fallback to it
 *
 * The previous estimator computed `60 / median(inter-footstrike-interval)` from
 * `detectFootstrikes`'s ankle-extrema scan. Measured on the track demo clip, that read 120–150
 * spm (median 125) against an independent ankle-crossing ground truth of 91–98 spm — ~30% high.
 * Spurious prominence-confirmed ankle-y extrema (not real ground-contact events) shrink the
 * median inter-strike interval, and a shrunk interval inflates `60 / interval`. The spectral fit's
 * `f* × 60` on the same clip reads 93.6 spm — inside the ground-truth band.
 *
 * There is no fallback to the footstrike path when the spectral fit is weak, and no
 * agreement/disagreement caveat comparing the two. Both are deliberate: a quality-gated fallback
 * would flip estimators run to run on exactly the clips where they disagree most (MoveNet is not
 * bit-reproducible — see this repo's CLAUDE.md), converting a stable bias into discontinuous
 * variance. And the measured disagreement itself is one-sided evidence that the FOOTSTRIKE path
 * was wrong, not balanced uncertainty worth flagging symmetrically — no calibrated disagreement
 * threshold exists at the two-clip evidence base this was measured against, and inventing one
 * would put an uncalibrated coefficient into a user-visible score. `detectFootstrikes` itself is
 * untouched and still serves `overstriding`/`footStrikePattern` — only cadence stopped consuming
 * it.
 *
 * ## Quality gate
 *
 * Gated on `cadenceMinFitR2` (default 0.30), reusing vertical oscillation's exact calibration —
 * see that key's doc in `types.ts` for why the reuse is sound (cadence fits the IDENTICAL hip-mid
 * series at the IDENTICAL sample count) and for the explicit warning that this does NOT license
 * reuse at other sample counts (the pure-noise R² floor is steeply n-dependent). Below the gate,
 * `value` is `null` with a caveat naming the measured quality and the threshold — never a
 * low-confidence number, since below the gate the fitted frequency describes noise.
 *
 * View tolerance is identical to vertical oscillation's (`viewFitTable.cadence` == side 1.0,
 * front 0.85, ambiguous 0.6) — see `types.ts`'s comment on that table entry for why the two are no
 * longer merely similar but exactly the same, now that both fit the same input series.
 */
export function computeCadence(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.cadence[view]
  const hipBounce = analyzeHipBounce(frames, config)

  if (hipBounce.resolvedCount === 0) {
    return nullResult(viewFitEntry.fit, 'No resolvable hip position in this clip.')
  }

  const fit = hipBounce.fit
  if (!fit.ok) {
    return nullResult(viewFitEntry.fit, caveatForFailure(fit.reason, fit.sampleCount))
  }

  const minFitR2 = config.cadenceMinFitR2
  if (fit.sinusoidR2 < minFitR2) {
    // Reported as no-value rather than a low-confidence value on purpose — same reasoning as
    // vertical oscillation's identical gate: below the threshold the fitted frequency describes
    // noise, and no confidence discount is honest enough to make a meaningless number worth
    // showing.
    return nullResult(
      viewFitEntry.fit,
      `Hip position was tracked, but no consistent step rhythm could be fit (fit quality ${fit.sinusoidR2.toFixed(2)}, below the ${minFitR2.toFixed(2)} minimum).`,
    )
  }

  const value = fit.frequencyHz * 60
  // Reported as a whole count, because "2.87 steps" is not a thing a reader can act on. Confidence
  // below deliberately uses the FRACTIONAL count instead — see verticalOscillation.ts's identical
  // reasoning on its own `sampleSize`/confidence split.
  const sampleSize = Math.floor(fit.observedCycles)

  // Linear ramp from "just cleared the gate" (0) to "as good as a clean clip gets" (1). Denominator
  // is guaranteed positive as long as the saturation point sits above the gate, which the defaults
  // satisfy by a wide margin (0.30 vs 0.80).
  const fitQuality =
    FIT_QUALITY_SATURATION_R2 > minFitR2
      ? clamp01((fit.sinusoidR2 - minFitR2) / (FIT_QUALITY_SATURATION_R2 - minFitR2))
      : 1

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage: hipBounce.frameCoverage,
    interpolatedFraction: hipBounce.interpolatedFraction,
    // Fractional, not `sampleSize` — see the comment on `sampleSize` above.
    sampleSize: fit.observedCycles,
    minRequiredSampleSize: MIN_CADENCE_STEPS,
    fitQuality,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  // Every shortfall that applies is named independently rather than picking one to report — same
  // multi-caveat join vertical oscillation already uses.
  const caveats: string[] = []
  if (sampleSize < MIN_CADENCE_STEPS) {
    caveats.push(
      `Only ${sampleSize} step(s) observed (recommend at least ${MIN_CADENCE_STEPS}) — confidence reduced accordingly.`,
    )
  }
  if (fit.sinusoidR2 < FIT_QUALITY_SATURATION_R2) {
    caveats.push(
      `Step rhythm fit quality is ${fit.sinusoidR2.toFixed(2)} (a clean rhythm scores ${FIT_QUALITY_SATURATION_R2.toFixed(2)} or above) — confidence reduced accordingly.`,
    )
  }
  if (isNearGridEdge(fit.frequencyHz, config)) {
    caveats.push(
      `The fitted step frequency sits at the edge of the searched ${config.spectralFitMinFrequencyHz.toFixed(1)}–${config.spectralFitMaxFrequencyHz.toFixed(1)} Hz range — the true cadence may fall outside it.`,
    )
  }

  return {
    metric: 'cadence',
    value,
    unit: 'stepsPerMinute',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction: hipBounce.interpolatedFraction,
    frameCoverage: hipBounce.frameCoverage,
    sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
  }
}
