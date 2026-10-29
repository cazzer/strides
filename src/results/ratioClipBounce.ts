import type { RatioClipBounce } from '../guidance/compositeReadings'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { metricTier } from './metricConfidence'

/**
 * The relative hip bounce measured on vertical ratio's OWN clip, read off that clip's per-clip
 * result: what vertical ratio's derivation (the "From …" line) and the runner's stride divide by.
 *
 * Fusion picks each metric's clip independently, so in a mixed-clip session the fused relative
 * bounce can come from another clip than vertical ratio (the 3-clip demo: vertical ratio from clip
 * 1, the relative bounce from clip 2), and the two would not share a fit. Vertical ratio's own clip
 * measured both from one hip fit, so its bounce is the one vertical ratio was computed with.
 *
 * Presentation only: reads `clipResults` and `sourceIndices` (both already computed by fusion) and
 * changes neither. Null until fused (`sourceIndices` null) or when that clip has no result.
 */
export function ratioClipBounceFor(
  clipResults: readonly (FormHeuristicsResult | null)[],
  sourceIndices: Readonly<Record<MetricId, number>> | null,
): RatioClipBounce | null {
  if (sourceIndices === null) return null
  const bounce = clipResults[sourceIndices.verticalRatio]?.verticalOscillation
  if (bounce === undefined) return null
  return { value: bounce.value, tier: metricTier(bounce) }
}
