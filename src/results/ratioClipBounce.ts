import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'

/**
 * The relative hip bounce (`verticalOscillation`) measured on vertical ratio's OWN clip, read off
 * that clip's per-clip result: what vertical ratio's derivation (the "From …" line) and the runner's
 * stride divide by.
 *
 * Fusion picks each metric's clip independently, so in a mixed-clip session the fused relative
 * bounce can come from another clip than vertical ratio (the 3-clip demo: vertical ratio from clip
 * 1, the relative bounce from clip 2), and the two would not share a fit. Vertical ratio's own clip
 * measured both from one hip fit, so its bounce is the one vertical ratio was computed with.
 *
 * The plain `MetricResult` (no series, fit or exemplars: small enough to memoise on its content);
 * each reader tiers it with its own tier function, as it tiers the fused metrics.
 *
 * Presentation only: reads `clipResults` and `sourceIndices` (both already computed by fusion) and
 * changes neither. Null until fused (`sourceIndices` null) or when that clip has no result.
 */
export function ratioClipBounceFor(
  clipResults: readonly (FormHeuristicsResult | null)[],
  sourceIndices: Readonly<Record<MetricId, number>> | null,
): MetricResult | null {
  if (sourceIndices === null) return null
  const bounce = clipResults[sourceIndices.verticalRatio]?.verticalOscillation
  if (bounce === undefined) return null
  const { metric, value, unit, confidence, viewFit, interpolatedFraction, frameCoverage, sampleSize, caveat } =
    bounce
  return { metric, value, unit, confidence, viewFit, interpolatedFraction, frameCoverage, sampleSize, caveat }
}
