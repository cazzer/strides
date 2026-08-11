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
    (travelDirectionKnown ? 1 : 0.5)

  return clamp01(confidence)
}
