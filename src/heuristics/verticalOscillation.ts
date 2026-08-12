import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type {
  HeuristicsConfig,
  MetricResult,
  TimeseriesPoint,
  VerticalOscillationFit,
  VerticalOscillationResult,
  View,
} from './types'
import { estimateBodyScale } from './bodyScale'
import { analyzeHipBounce } from './hipBounce'
import type { SpectralFitFailureReason } from './spectralFit'
import { computeMetricConfidence } from './confidence'
import { clamp01 } from './mathUtils'

/**
 * Sinusoid partial R² at or above which the fit is treated as fully trustworthy — the top of the
 * ramp `verticalOscillationMinFitR2` starts. A clean, well-tracked clip scores essentially 1 here;
 * real footage lands in between and gets a proportionally reduced confidence rather than a cliff.
 * A module constant rather than config: unlike the minimum, which is a "publish this or not"
 * policy worth tuning per deployment, this is just the shape of the ramp between the gate and
 * "perfect", and moving it independently of the gate only makes the two numbers disagree.
 */
const FIT_QUALITY_SATURATION_R2 = 0.8

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  series: TimeseriesPoint[] = [],
): VerticalOscillationResult {
  return {
    metric: 'verticalOscillation',
    value: null,
    unit: 'ratio',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
    series,
    fit: null,
  }
}

function caveatForFailure(reason: SpectralFitFailureReason, sampleCount: number): string {
  switch (reason) {
    case 'too-few-samples':
      return `Hip position resolved in only ${sampleCount} frame(s) — too few to fit a bounce rhythm.`
    case 'insufficient-cycles':
      return 'Hip position was tracked, but the clip is too short to contain a complete bounce cycle.'
    case 'degenerate-signal':
      return 'Hip position was tracked, but showed no oscillating vertical motion to measure.'
  }
}

/**
 * Vertical oscillation: how much the pelvis (center-of-mass proxy) bounces up and down per gait
 * cycle, as a fraction of torso length.
 *
 * ## Method
 *
 * The hip-mid image-y trace is handed to `fitSpectralSinusoid` (see that module for the model and
 * why least squares over irregular samples rather than resample-then-FFT), and the reported value
 * is the fitted PEAK-TO-PEAK amplitude divided by the clip-median torso length. This replaced an
 * extrema-pairing estimator that measured each trough-to-peak excursion individually and took
 * their median. Two reasons, both measured on real clips:
 *
 *  - **Stability.** Which extrema clear a prominence threshold changes run to run on the same clip
 *    (MoveNet is not bit-reproducible), and on a short clip a couple of extrema either way moves
 *    the median a lot. Cross-trial spread on the park clip fell from 18.2% to 4.2% — a 4.3x
 *    improvement — with the track clip unchanged.
 *  - **Drift immunity.** The fit's `c + d·t + e·t²` terms absorb slow whole-body translation, so a
 *    runner approaching the camera no longer has their approach charged to their bounce. An
 *    extremum-difference estimator has no way to separate the two.
 *
 * The tradeoff is a known, accepted bias: a real bounce waveform is peakier than a sine, and a
 * single sinusoid underfits its peaks, so this reads roughly 3-7% LOW versus the old estimator on
 * the same footage. That direction was chosen deliberately over an unstable estimator — a
 * consistent small underestimate is usable; run-to-run swings of tens of percent are not.
 *
 * There is no fallback to the old path. A quality-gated fallback would swap estimators between
 * runs on exactly the marginal clips where the two disagree most, converting a stable bias into
 * discontinuous variance — worse than either estimator alone. Below
 * `verticalOscillationMinFitR2`, or when the fit is not well posed at all, the metric reports
 * `null` with a caveat naming why. The chart `series` is populated regardless, so a clip with no
 * reportable number still shows its hip trace.
 *
 * `sampleSize` is the count of complete BOUNCE cycles observed (`floor(spanSeconds ×
 * frequencyHz)`) — one bounce per STEP, i.e. HALF a full gait cycle, not a full gait cycle itself
 * — not the half-bounce-cycle count the extrema estimator reported — the fit consumes the whole
 * waveform, so the cycle is its natural sample unit. Confidence uses the UNROUNDED cycle count;
 * only the reported field and the caveat text are floored.
 *
 * ## View tolerance
 *
 * View-tolerant by design — unlike trunk lean and overstriding, vertical bounce projects onto
 * image-y similarly regardless of which way the runner is facing the camera, as long as the camera
 * itself is level (an explicit out-of-scope assumption: no roll correction here).
 * `viewFitTable.verticalOscillation` still applies a conservative discount for front view (0.85) to
 * account for pelvic-drop noise that's more visible face-on than from the side — a documented
 * judgment call, not a measured effect.
 */
export function computeVerticalOscillation(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): VerticalOscillationResult {
  const viewFitEntry = config.viewFitTable.verticalOscillation[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const { torsoLengthPx } = bodyScale

  // Traversal, interpolation accounting, and the fit itself are all owned by the shared
  // hip-bounce signal module — see `hipBounce.ts` for why this is a signal extractor, not a
  // metric, and why cadence independently re-derives the identical fit rather than this metric
  // threading a shared result through the orchestrator.
  const hipBounce = analyzeHipBounce(frames, config)
  const rawHipY = hipBounce.hipY

  if (hipBounce.resolvedCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable hip position in this clip.',
      frames.map((frame) => ({ timestamp: frame.timestamp, value: null })),
    )
  }

  const frameCoverage = hipBounce.frameCoverage
  const interpolatedFraction = hipBounce.interpolatedFraction

  // The run mean is the charting baseline, not a physical quantity — it just centers the
  // waveform around 0 so the chart reads as "bounce above/below typical", independent of where
  // in the frame the runner happened to be positioned. Computed here (chart-only concern), not in
  // `hipBounce.ts`, from the shared `hipY` trace.
  let hipYSum = 0
  for (const y of rawHipY) {
    if (y !== null) hipYSum += y
  }
  const runMeanHipY = hipYSum / hipBounce.resolvedCount
  const series: TimeseriesPoint[] = frames.map((frame, i) => {
    const y = rawHipY[i]
    return {
      timestamp: frame.timestamp,
      // Sign-flipped: image-y grows downward, so a smaller y (higher on screen) should read as
      // a positive bounce.
      value: y === null ? null : (runMeanHipY - y) / torsoLengthPx,
    }
  })

  const spectralFit = hipBounce.fit

  if (!spectralFit.ok) {
    return nullResult(
      viewFitEntry.fit,
      caveatForFailure(spectralFit.reason, spectralFit.sampleCount),
      series,
    )
  }

  const minFitR2 = config.verticalOscillationMinFitR2
  if (spectralFit.sinusoidR2 < minFitR2) {
    // Reported as no-value rather than a low-confidence value on purpose: below the gate the
    // fitted amplitude describes noise, and there is no confidence discount honest enough to make
    // a meaningless number worth showing.
    return nullResult(
      viewFitEntry.fit,
      `Hip position was tracked, but no consistent bounce rhythm could be fit (fit quality ${spectralFit.sinusoidR2.toFixed(2)}, below the ${minFitR2.toFixed(2)} minimum).`,
      series,
    )
  }

  const fit: VerticalOscillationFit = {
    frequencyHz: spectralFit.frequencyHz,
    peakToPeakAmplitudePx: spectralFit.peakToPeakAmplitude,
    sinusoidR2: spectralFit.sinusoidR2,
    totalR2: spectralFit.totalR2,
    secondPeakRatio: spectralFit.secondPeakRatio,
    sampleCount: spectralFit.sampleCount,
    spanSeconds: spectralFit.spanSeconds,
    observedCycles: spectralFit.observedCycles,
  }

  const value = fit.peakToPeakAmplitudePx / torsoLengthPx
  // Reported as a whole count, because "2.87 cycles" is not a thing a reader can act on. Confidence
  // below deliberately uses the FRACTIONAL count instead: flooring there would turn a difference
  // smaller than the fit's own frequency resolution into a confidence cliff (2.99 cycles and 2.01
  // cycles would score identically, and both far below 3.01).
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
    frameCoverage,
    interpolatedFraction,
    // Fractional, not `sampleSize` — see the comment on `sampleSize` above.
    sampleSize: fit.observedCycles,
    minRequiredSampleSize: config.verticalOscillationMinCycles,
    fitQuality,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  // Both shortfalls can apply at once (a short clip is also a harder clip to fit), and each one
  // independently costs confidence, so each one that applies is named rather than picking a winner.
  const caveats: string[] = []
  if (sampleSize < config.verticalOscillationMinCycles) {
    caveats.push(
      `Only ${sampleSize} complete bounce cycle(s) observed (recommend at least ${config.verticalOscillationMinCycles}) — confidence reduced accordingly.`,
    )
  }
  if (fit.sinusoidR2 < FIT_QUALITY_SATURATION_R2) {
    caveats.push(
      `Bounce rhythm fit quality is ${fit.sinusoidR2.toFixed(2)} (a clean rhythm scores ${FIT_QUALITY_SATURATION_R2.toFixed(2)} or above) — confidence reduced accordingly.`,
    )
  }

  return {
    metric: 'verticalOscillation',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    series,
    fit,
  }
}
