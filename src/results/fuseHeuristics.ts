import { classifyFootStrike } from '../heuristics/footStrikePattern'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'
import type { FootStrikeClass } from '../heuristics/footStrikePattern'
import { metricTier } from './metricConfidence'

/**
 * Appended to a fused metric's caveat naming which of the N input clips it came from —
 * generalizes `scalePassGraft.ts`'s `SCALE_PASS_PROVENANCE_CAVEAT` from a fixed 2-input, 1-field
 * graft to N inputs and every metric. `sourceIndex` is 0-based internally; the message is
 * 1-based, matching how clips are numbered everywhere a user sees them.
 */
export function fusionProvenanceCaveat(sourceIndex: number, totalClips: number): string {
  return `Combined from clip ${sourceIndex + 1} of ${totalClips}.`
}

const FOOT_STRIKE_READINGS: Record<FootStrikeClass, string> = {
  heel: 'a heel strike',
  midfoot: 'a midfoot strike',
  forefoot: 'a forefoot strike',
}

/**
 * What a reader would take away from this clip's number, as a CATEGORY — or `null` where the
 * metric owns no category to be read in.
 *
 * This is the whole basis of the disagreement check below, and the reason it is stated in
 * categories rather than in magnitudes. Fusion picks one clip's number and shows it alone; the
 * question "do the clips disagree enough that hiding the loser misleads the reader" needs an
 * answer, and the obvious answer — a per-metric "materially differs by X" number — would be
 * eleven unjustifiable constants in eleven different units. This repo has a worked example of
 * where that ends (CLAUDE.md, "The 4K area floor cannot be re-derived": a threshold measured,
 * found to sit inside a factor-of-2.9 squeeze, and the direction abandoned rather than tuned).
 * So the rule is threshold-free: surface only where the losing clip would have put a DIFFERENT
 * WORD on the card, decided by a band the metric ALREADY owns and already ships.
 *
 * Today exactly one metric owns such a band. `footStrikePattern` classifies its signed
 * ankle-relative-to-knee ratio into `heel | midfoot | forefoot` through `classifyFootStrike` and
 * a symmetric dead zone (`footStrikeMidfootBandRatio`), and `MetricsPanel.formatValue` renders
 * that word — not the number — as the card's value. Two clips landing either side of that band
 * genuinely tell the reader two different things.
 *
 * Every other `MetricId` was surveyed and yields `null` — three of them (`stepWidth`,
 * `stepWidthCm`, `cadence`) after being weighed and declined rather than for want of anything to
 * compare:
 *
 * - **`stepWidth` / `stepWidthCm`** do own an interpretive boundary — `value < 0` emits their
 *   "crossover gait" caveat — but it is a bare zero-crossing with no dead zone. A value
 *   indistinguishable from zero would flip the reading on noise, while two same-signed values a
 *   torso-length apart would never fire at all. A boundary with no band is not a band. (Their
 *   card value also stays a number; the phrase is an annotation on it, not the reading itself.)
 *   `overstriding`, `trunkLean` and `kneeDrive` are signed with no boundary at all, so the same
 *   objection applies a fortiori.
 * - **`cadence`** owns `isNearGridEdge`, but that is a claim about the MEASURABLE RANGE, not a
 *   category the value is read in: two clips 60 steps/min apart can share its verdict, and two
 *   clips a grid step apart can differ on it. It answers a different question.
 *
 * The remaining five — `verticalOscillation`, `verticalRatio`, `verticalOscillationCm`,
 * `kneeFlexion`, `armSwingAmplitude` — carry no value-keyed branch of any kind. (`overstriding`,
 * `trunkLean` and `kneeDrive` are counted with the declines above, since the zero-crossing
 * objection is what rules them out.) A metric gains coverage here by growing a real classifier,
 * not by having this file invent one.
 *
 * ⚠️ **This never reads `confidence`, and that is deliberate but not free.** Fusion has already
 * used confidence to choose, and the loser being EQUALLY confident is the whole reason this
 * exists. But `metricTier` excludes only on a null value or an unsuitable `viewFit`, so a
 * view-suitable clip whose own card would read "Low confidence" is quoted at equal billing —
 * reachable here, since `MIN_FOOT_STRIKE_SAMPLE_SIZE` is 4 and a median can rest on 1-3 strikes.
 * The copy is written to stay true in that case: it says nothing here settles which clip is
 * right, which is a claim about this analysis, not about what is knowable from the footage.
 *
 * Reads `DEFAULT_HEURISTICS_CONFIG` for the band rather than threading the config that computed
 * the result, matching what `MetricsPanel.formatValue` already does to render the same word — so
 * the caveat can never name a category the card contradicts.
 */
function metricReading(result: MetricResult): string | null {
  if (result.value === null) return null
  if (result.metric === 'footStrikePattern') {
    return FOOT_STRIKE_READINGS[
      classifyFootStrike(result.value, DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio)
    ]
  }
  return null
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Appended after the provenance sentence when a losing clip's own number would have been read as
 * a different category from the one now on the card. It names WHICH clip and WHAT it read,
 * because a reader who cannot see the other number cannot act on being told a disagreement
 * exists — and it names no winner, because which clip is closer to the truth is not established
 * (`strides-5hj`: the two side clips' footstrikes come from two different detectors, one of them
 * the fallback, and there is no ground truth for this footage either way).
 *
 * Clip numbers are bare ("clip 2") rather than "clip 2 of 3": the provenance sentence
 * immediately before this one has already said "of N".
 */
export function fusionDisagreementCaveat(
  entries: readonly { clipNumber: number; reading: string }[],
): string {
  const clause = joinWithAnd(
    entries.map((entry) => `clip ${entry.clipNumber} read ${entry.reading}`),
  )
  return `The clips disagree: ${clause}. Nothing here settles which clip is right.`
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
 * The disagreement sentence for one metric across N clips, or `null` where there is nothing to
 * report. Pure, and it never looks at `confidence`: fusion has already used that to choose, and
 * the loser being equally confident is the whole reason this exists (`strides-5hj` — the tie
 * breaks to the lowest clip index and 1.0 is the ceiling, so an equally-confident later clip can
 * never displace clip 1).
 *
 * A clip is eligible to contest only if `metricTier` would render it as a CARD — which is the
 * app's own existing display gate, reused rather than reinvented. That excludes a clip whose
 * value is null (nothing to disagree with) and one the camera geometry cannot support
 * (`viewFit: 'unsuitable'`), and quoting either at the reader as a contradiction would be worse
 * than silence: they are readings the panel itself declines to show on their own. The winner has
 * to clear the same bar, since an excluded winner puts no number on screen to be contested.
 */
function disagreementCaveat(
  candidates: readonly MetricResult[],
  winnerIndex: number,
): string | null {
  const winner = candidates[winnerIndex]
  if (metricTier(winner) === 'excluded') return null
  const winnerReading = metricReading(winner)
  if (winnerReading === null) return null

  const entries: { clipNumber: number; reading: string }[] = []
  for (let i = 0; i < candidates.length; i += 1) {
    if (i === winnerIndex) continue
    const candidate = candidates[i]
    if (metricTier(candidate) === 'excluded') continue
    const reading = metricReading(candidate)
    if (reading === null || reading === winnerReading) continue
    entries.push({ clipNumber: i + 1, reading })
  }

  return entries.length === 0 ? null : fusionDisagreementCaveat(entries)
}

/**
 * Merges one `FormHeuristicsResult` per analyzed clip into a single result, by picking — per
 * metric key — the whole winning `MetricResult` object from whichever clip reports the highest
 * `confidence` for that metric. Never a scalar-field franken-merge: `verticalOscillation`'s
 * `series`/`fit` and `verticalOscillationCm`'s `calibration` travel with the winning object for
 * free, because the whole object is spread and only `caveat` is touched — the provenance sentence,
 * plus `disagreementCaveat`'s account of any losing clip the reader would have read differently.
 * No computed field moves: a metric the fuse can see a disagreement on still reports the winner's
 * `value`, `confidence`, `viewFit` and `sampleSize` exactly as it did before. Explicit per-field
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
      caveat: [
        value.caveat,
        fusionProvenanceCaveat(index, results.length),
        disagreementCaveat(candidates, index),
      ]
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
    footStrikePattern: pickMetric('footStrikePattern'),
    stepWidth: pickMetric('stepWidth'),
    stepWidthCm: pickMetric('stepWidthCm'),
    kneeDrive: pickMetric('kneeDrive'),
    armSwingAmplitude: pickMetric('armSwingAmplitude'),
  }
}

/**
 * Which of the N input clips each metric was selected FROM — the same decision
 * `fuseFormHeuristicsResults` makes, as data rather than dissolved into `fusionProvenanceCaveat`'s
 * English sentence. The whole winning `MetricResult` is spread by the fuse above, so a metric's
 * `exemplars` (the instants it is evidenced by) travel across clips for free and land in a result
 * whose consumer may be holding a *different* clip's frames and blob. Resolving them needs the
 * index, and recovering it by regexing a prose caveat would be neither stable nor honest.
 *
 * A SIBLING function rather than a wider return type on `fuseFormHeuristicsResults`: that
 * function's single-clip reference identity (above) is load-bearing as a regression proof, and any
 * richer return shape forces it to construct something new. The two share `pickBestWithIndex` —
 * one comparator, so they cannot disagree about who won, ties included — and a test asserts they
 * agree metric by metric on a multi-clip fixture.
 *
 * A single clip maps every metric to `0` by construction, not by a special case: the comparator
 * over a one-element array is already `0`.
 *
 * Explicit per-metric entries, matching the fuse's own style — `Record<MetricId, number>` makes a
 * future new `MetricId` a compile error here as well as there, which a loop over `Object.keys`
 * would silently absorb.
 */
export function fusionSourceIndices(
  results: FormHeuristicsResult[],
): Record<MetricId, number> {
  if (results.length === 0) {
    throw new Error('fusionSourceIndices requires at least one result')
  }

  const sourceIndex = (key: Exclude<keyof FormHeuristicsResult, 'view'>): number =>
    pickBestWithIndex(results.map((r) => r[key] as MetricResult)).index

  return {
    verticalOscillation: sourceIndex('verticalOscillation'),
    verticalRatio: sourceIndex('verticalRatio'),
    verticalOscillationCm: sourceIndex('verticalOscillationCm'),
    trunkLean: sourceIndex('trunkLean'),
    overstriding: sourceIndex('overstriding'),
    cadence: sourceIndex('cadence'),
    kneeFlexion: sourceIndex('kneeFlexion'),
    footStrikePattern: sourceIndex('footStrikePattern'),
    stepWidth: sourceIndex('stepWidth'),
    stepWidthCm: sourceIndex('stepWidthCm'),
    kneeDrive: sourceIndex('kneeDrive'),
    armSwingAmplitude: sourceIndex('armSwingAmplitude'),
  }
}
