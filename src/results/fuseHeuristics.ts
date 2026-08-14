import type { FormHeuristicsResult, MetricResult } from '../heuristics/types'

/**
 * Appended to a fused metric's caveat naming which of the N input clips it came from —
 * generalizes `scalePassGraft.ts`'s `SCALE_PASS_PROVENANCE_CAVEAT` from a fixed 2-input, 1-field
 * graft to N inputs and every metric. `sourceIndex` is 0-based internally; the message is
 * 1-based, matching how clips are numbered everywhere a user sees them.
 */
export function fusionProvenanceCaveat(sourceIndex: number, totalClips: number): string {
  return `Combined from clip ${sourceIndex + 1} of ${totalClips}.`
}

function pickBestWithIndex<T extends { confidence: number }>(
  candidates: readonly T[],
): { value: T; index: number } {
  let bestIndex = 0
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].confidence > candidates[bestIndex].confidence) bestIndex = i
  }
  return { value: candidates[bestIndex], index: bestIndex }
}

/**
 * Merges one `FormHeuristicsResult` per analyzed clip into a single result, by picking — per
 * metric key — the whole winning `MetricResult` object from whichever clip reports the highest
 * `confidence` for that metric. Never a scalar-field franken-merge: `verticalOscillation`'s
 * `series`/`fit` and `verticalOscillationCm`'s `calibration` travel with the winning object for
 * free, because the whole object is spread and only `caveat` is touched. Explicit per-field
 * picks, not a dynamic loop over `Object.keys` — matches this codebase's style of concretely-
 * typed code over generic patterns needing casts (see `FormHeuristicsResult`'s own field list,
 * `scalePassGraft.ts`'s explicit metric name) and makes a future new `MetricId` (e.g. #45/#46's
 * stepWidth/stepWidthCm) a visible one-line addition here rather than something a generic loop
 * would silently absorb.
 *
 * `view: ViewDetectionResult` is not a `MetricId` and carries no `caveat` field, so it gets its
 * own rule: highest-confidence source's `view`, by reference, with no provenance suffix.
 *
 * Composed OUTSIDE `src/heuristics/`, for the same layering reason `scalePassGraft.ts`'s module
 * doc gives: the heuristics layer computes one result from one set of frames and knows nothing
 * about multiple clips; combining several clips' results is results-layer policy.
 */
export function fuseFormHeuristicsResults(
  results: FormHeuristicsResult[],
): FormHeuristicsResult {
  if (results.length === 0) {
    throw new Error('fuseFormHeuristicsResults requires at least one result')
  }
  // Reference identity — load-bearing for the single-clip regression proof, not an optimization:
  // a single-clip session's fused result must be the exact object computeFormHeuristics produced.
  if (results.length === 1) return results[0]

  const pickMetric = <K extends Exclude<keyof FormHeuristicsResult, 'view'>>(
    key: K,
  ): FormHeuristicsResult[K] => {
    const candidates = results.map((r) => r[key] as MetricResult)
    const { value, index } = pickBestWithIndex(candidates)
    return {
      ...value,
      caveat: [value.caveat, fusionProvenanceCaveat(index, results.length)]
        .filter(Boolean)
        .join(' '),
    } as FormHeuristicsResult[K]
  }

  const bestView = pickBestWithIndex(results.map((r) => r.view))

  return {
    view: bestView.value,
    verticalOscillation: pickMetric('verticalOscillation'),
    verticalRatio: pickMetric('verticalRatio'),
    verticalOscillationCm: pickMetric('verticalOscillationCm'),
    trunkLean: pickMetric('trunkLean'),
    overstriding: pickMetric('overstriding'),
    cadence: pickMetric('cadence'),
    kneeFlexion: pickMetric('kneeFlexion'),
    armSwingSymmetry: pickMetric('armSwingSymmetry'),
    footStrikePattern: pickMetric('footStrikePattern'),
  }
}
