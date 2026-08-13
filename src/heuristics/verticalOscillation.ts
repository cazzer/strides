import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type {
  HeuristicsConfig,
  MetricResult,
  TimeseriesPoint,
  VerticalOscillationFit,
  VerticalOscillationResult,
  VerticalOscillationSignal,
  View,
} from './types'
import { estimateBodyScale } from './bodyScale'
import { analyzeBounceSignal } from './hipBounce'
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

/**
 * The bilateral pair each `VerticalOscillationSignal` resolves. See that type's doc (`types.ts`)
 * for the full semantic tradeoff between the two options — this is purely the name-to-pair
 * lookup `analyzeBounceSignal` needs.
 */
const SIGNAL_KEYPOINTS: Record<VerticalOscillationSignal, [KeypointName, KeypointName]> = {
  hipMid: ['left_hip', 'right_hip'],
  earMid: ['left_ear', 'right_ear'],
}

/** Caveat text names which signal was tracked, so a degraded-result message reads correctly
 * regardless of `verticalOscillationSignal`. */
const SIGNAL_LABEL: Record<VerticalOscillationSignal, string> = {
  hipMid: 'Hip position',
  earMid: 'Head (ear-midpoint) position',
}

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

function caveatForFailure(
  reason: SpectralFitFailureReason,
  sampleCount: number,
  signalLabel: string,
): string {
  switch (reason) {
    case 'too-few-samples':
      return `${signalLabel} resolved in only ${sampleCount} frame(s) — too few to fit a bounce rhythm.`
    case 'insufficient-cycles':
      return `${signalLabel} was tracked, but the clip is too short to contain a complete bounce cycle.`
    case 'degenerate-signal':
      return `${signalLabel} was tracked, but showed no oscillating vertical motion to measure.`
  }
}

/**
 * Vertical oscillation: how much the runner bounces up and down per gait cycle, as a fraction of
 * torso length.
 *
 * ## Input signal
 *
 * Which bilateral pair's midpoint feeds the fit is configurable via
 * `config.verticalOscillationSignal` (`VerticalOscillationSignal`, `types.ts`) — `'hipMid'`
 * (default, the pelvis, a genuine center-of-mass proxy) or `'earMid'` (the head, measured more
 * stable run-to-run but a physically different, damped quantity — see that type's doc for the
 * full tradeoff and epic #27's design.md for the A/B that decided the default). Selection is
 * per-run, resolved once via `SIGNAL_KEYPOINTS[config.verticalOscillationSignal]` and handed to
 * `analyzeBounceSignal` — NEVER per-frame: if the configured signal's pair is unresolvable on a
 * given frame, that frame contributes nothing (`null` in `series`, absent from the fit), and this
 * function does NOT fall back to the other signal, even though it would often be resolvable.
 * Splicing between two different bilateral pairs frame-to-frame would inject step-and-amplitude
 * discontinuities that corrupt `sinusoidR2` (the publish gate below) in a way that depends on
 * exactly which frames happened to drop out — nondeterministic in effect, even though the
 * fallback logic itself would be deterministic. This is distinct from, and does not disable,
 * `resolveMidpoint`'s own tolerant single-side fallback WITHIN the chosen pair (one ear, or one
 * hip, standing in for its sibling when only one side resolves) — that stays exactly as it is for
 * every other bilateral signal in this package, flagged interpolated as usual.
 *
 * `torsoLengthPx` normalization and `verticalOscillationCm`'s calibrated centimetre figure are
 * unaffected by this setting either way — both stay anchored to the hip/shoulder torso segment
 * regardless of which pair `verticalOscillationSignal` selects (see those functions' own docs).
 *
 * ## Method
 *
 * The selected signal's image-y trace is handed to `fitSpectralSinusoid` (see that module for the
 * model and why least squares over irregular samples rather than resample-then-FFT), and the
 * reported value is the fitted PEAK-TO-PEAK amplitude divided by the clip-median torso length.
 * This replaced an extrema-pairing estimator that measured each trough-to-peak excursion
 * individually and took their median. Two reasons, both measured on real clips (against the
 * `hipMid` signal specifically; see the input-signal section above for `earMid`'s independent
 * stability comparison):
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
 * reportable number still shows the selected signal's trace.
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

  const signal = config.verticalOscillationSignal
  const signalLabel = SIGNAL_LABEL[signal]

  // Traversal, interpolation accounting, and the fit itself are all owned by the shared
  // bounce-signal module — see `hipBounce.ts` for why this is a signal extractor, not a metric,
  // and why cadence independently re-derives the identical fit (always against the hip pair,
  // never this signal selection) rather than this metric threading a shared result through the
  // orchestrator.
  const bounceSignal = analyzeBounceSignal(frames, config, SIGNAL_KEYPOINTS[signal])
  const rawSignalY = bounceSignal.hipY

  if (bounceSignal.resolvedCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      `No resolvable ${signalLabel.toLowerCase()} in this clip.`,
      frames.map((frame) => ({ timestamp: frame.timestamp, value: null })),
    )
  }

  const frameCoverage = bounceSignal.frameCoverage
  const interpolatedFraction = bounceSignal.interpolatedFraction

  // The run mean is the charting baseline, not a physical quantity — it just centers the
  // waveform around 0 so the chart reads as "bounce above/below typical", independent of where
  // in the frame the runner happened to be positioned. Computed here (chart-only concern), not in
  // `hipBounce.ts`, from the shared signal trace.
  let signalYSum = 0
  for (const y of rawSignalY) {
    if (y !== null) signalYSum += y
  }
  const runMeanSignalY = signalYSum / bounceSignal.resolvedCount
  const series: TimeseriesPoint[] = frames.map((frame, i) => {
    const y = rawSignalY[i]
    return {
      timestamp: frame.timestamp,
      // Sign-flipped: image-y grows downward, so a smaller y (higher on screen) should read as
      // a positive bounce.
      value: y === null ? null : (runMeanSignalY - y) / torsoLengthPx,
    }
  })

  const spectralFit = bounceSignal.fit

  if (!spectralFit.ok) {
    return nullResult(
      viewFitEntry.fit,
      caveatForFailure(spectralFit.reason, spectralFit.sampleCount, signalLabel),
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
      `${signalLabel} was tracked, but the bounce rhythm was too irregular to measure.`,
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
      "The bounce rhythm in this clip wasn't perfectly steady — confidence reduced accordingly.",
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
