import { clamp01 } from './mathUtils'

export interface MetricConfidenceParams {
  viewFitMultiplier: number
  frameCoverage: number
  interpolatedFraction: number
  sampleSize: number
  minRequiredSampleSize: number
  /** Only relevant for trunkLean/overstriding, which need travel direction to sign their result.
   * Defaults to true (irrelevant) for metrics that don't depend on it. */
  travelDirectionKnown?: boolean
  /** Only relevant for metrics whose value comes from fitting a model to the signal rather than
   * reading it directly — currently just vertical oscillation's spectral sinusoid fit. Already
   * mapped to [0, 1] by the producing metric, since what counts as a good fit is that metric's
   * policy, not this function's. Defaults to 1 (irrelevant) for metrics that don't fit anything. */
  fitQuality?: number
  interpolationConfidencePenalty: number
}

/**
 * `confidence` is a heuristic product of independent [0, 1] penalty factors — a way to combine
 * several "how much should I trust this" signals into one number for display — NOT a statistical
 * error bar or a calibrated probability. Each factor answers a different question:
 *   - viewFitMultiplier: is this metric even meaningful from the detected camera angle?
 *   - frameCoverage: how much of the clip actually had resolvable input?
 *   - (1 - penalty * interpolatedFraction): how much of that input was guessed (interpolated)
 *     rather than directly detected?
 *   - min(1, sampleSize / minRequiredSampleSize): was there enough of a sample (cycles, strikes,
 *     frames) for the aggregate (median, etc.) to be stable, capped at 1 so a huge sample can't
 *     push confidence above what the other factors allow?
 *   - travelDirectionKnown: could the sign of a directional quantity even be resolved?
 *   - fitQuality: for a metric that fits a model to the signal, how well did the model actually
 *     describe it? (An estimator can have abundant, fully-detected, well-viewed input and still be
 *     describing something that isn't there — a separate concern from every factor above.)
 * Multiplying independent penalties means several moderate concerns compound into a low overall
 * number faster than any single one would alone — a deliberate, conservative design choice.
 */
export function computeMetricConfidence(params: MetricConfidenceParams): number {
  const {
    viewFitMultiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize,
    minRequiredSampleSize,
    travelDirectionKnown = true,
    fitQuality = 1,
    interpolationConfidencePenalty,
  } = params

  const sampleSizeFactor =
    minRequiredSampleSize > 0
      ? Math.min(1, sampleSize / minRequiredSampleSize)
      : 1

  const confidence =
    viewFitMultiplier *
    frameCoverage *
    (1 - interpolationConfidencePenalty * interpolatedFraction) *
    sampleSizeFactor *
    (travelDirectionKnown ? 1 : 0.5) *
    fitQuality

  return clamp01(confidence)
}
