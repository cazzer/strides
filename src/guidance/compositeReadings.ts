import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import type { FocusAreaId } from './focusAreas'
import type { MetricTier } from './types'

/**
 * Composite readings: metrics in one focus area that describe the same quantity, presented as ONE
 * reading (compose-bounce-reading design.md D1).
 *
 * Presentation only. `FOCUS_AREAS`, `focusAreaView`'s headline, `feedbackFor` and `selectOneThing`
 * never read this module, so a composite cannot move an area's headline, its feedback or the one
 * thing. Like `feedbackPoints.ts`, nothing here imports from `src/results` or `src/runner`.
 *
 * ## Bounce, and what its derivation may cite
 *
 * The three bounce metrics are one fitted hip bounce over three denominators:
 *
 * - `verticalRatio` = `fit.peakToPeakAmplitude / stride.strideLengthPx` (`verticalRatio.ts`): the hip
 *   bounce in pixels over the median same-side stride in pixels. It does NOT read
 *   `verticalOscillationCm`, which is a separate centimetre fit of the same hip bounce (the scale
 *   pass), so a derivation cites the centimetre figure as "the same bounce, in cm", not as an operand.
 * - `verticalOscillation` = the same fit's amplitude over the median torso length in pixels, under the
 *   default `verticalOscillationSignal: 'hipMid'`. Same fit, same frames, so
 *   `verticalOscillation / verticalRatio` = `strideLengthPx / torsoLengthPx` EXACTLY: the stride in
 *   torso lengths, which no metric exposes on its own. `compositeReadings.test.ts` pins the identity.
 * - Stride in metres (`verticalOscillationCm / verticalRatio`) is computed from the ratio itself, so
 *   citing it as an input would be circular; it is never derived here.
 *
 * Fusion picks each metric's clip independently (`fuseHeuristics.ts`), so every cross-metric figure
 * is taken only when both metrics come from the same clip (design.md D4).
 */

export type CompositeId = 'bounce'

export interface CompositeSpec {
  id: CompositeId
  label: string
  area: FocusAreaId
  /** Members in headline-preference order: the first measured one headlines the reading. */
  metricIds: readonly MetricId[]
}

export const COMPOSITE_READINGS: Readonly<Record<CompositeId, CompositeSpec>> = {
  bounce: {
    id: 'bounce',
    label: 'Bounce',
    area: 'rhythm',
    // Vertical ratio first: the reading runners know (the user's call, strides-xki9). Then the
    // centimetre bounce, which has a cited band and cue, before the relative one, which has neither.
    metricIds: ['verticalRatio', 'verticalOscillationCm', 'verticalOscillation'],
  },
}

export function compositeOf(metric: MetricId): CompositeSpec | null {
  return (
    Object.values(COMPOSITE_READINGS).find((spec) => spec.metricIds.includes(metric)) ?? null
  )
}

export type AreaReading<T> =
  | { kind: 'single'; item: T }
  /** `members`: the composite's OTHER measured items, in composite order. */
  | { kind: 'composite'; id: CompositeId; headline: T; members: T[] }

/** The item that speaks for a reading: a single's item, a composite's headline. */
export function readingHeadline<T>(reading: AreaReading<T>): T {
  return reading.kind === 'single' ? reading.item : reading.headline
}

/**
 * Groups an area's measured items (in the area's own order) into readings. A metric outside any
 * composite is a reading of its own; a composite's items form one reading, placed where the first
 * of them sat, headlined by the first in composite order.
 */
export function areaReadings<T>(
  items: readonly T[],
  metricOf: (item: T) => MetricId,
): AreaReading<T>[] {
  const readings: AreaReading<T>[] = []
  const placed = new Set<CompositeId>()
  for (const item of items) {
    const spec = compositeOf(metricOf(item))
    if (spec === null) {
      readings.push({ kind: 'single', item })
      continue
    }
    if (placed.has(spec.id)) continue
    placed.add(spec.id)
    const [headline, ...members] = spec.metricIds.flatMap((id) =>
      items.filter((candidate) => metricOf(candidate) === id),
    )
    readings.push({ kind: 'composite', id: spec.id, headline, members })
  }
  return readings
}

/** What vertical ratio was derived from, as far as this result can say it (design.md D3). */
export interface BounceDerivation {
  /** The bounce, in cm when measured on vertical ratio's clip, else relative to torso length. */
  bounce: {
    metric: 'verticalOscillationCm' | 'verticalOscillation'
    value: number
    unit: 'centimeters' | 'ratio'
  } | null
  /** `verticalOscillation / verticalRatio` = median stride / median torso length, same clip only. */
  strideTorsoLengths: number | null
  /** Vertical ratio's `sampleSize`: the same-side stride pairs its stride length is the median of. */
  strideCount: number
}

/** Null unless vertical ratio is measured (not excluded). `sourceIndices` null means one clip. */
export function bounceDerivation(
  fused: FormHeuristicsResult,
  tiers: Readonly<Record<MetricId, MetricTier>>,
  sourceIndices: Readonly<Record<MetricId, number>> | null,
): BounceDerivation | null {
  const ratio = fused.verticalRatio
  if (tiers.verticalRatio === 'excluded' || ratio.value === null || ratio.value === 0) return null
  const usable = (metric: 'verticalOscillationCm' | 'verticalOscillation'): number | null => {
    const value = fused[metric].value
    const sameClip =
      sourceIndices === null || sourceIndices[metric] === sourceIndices.verticalRatio
    return tiers[metric] !== 'excluded' && sameClip ? value : null
  }
  const centimetres = usable('verticalOscillationCm')
  const relative = usable('verticalOscillation')
  return {
    bounce:
      centimetres !== null
        ? { metric: 'verticalOscillationCm', value: centimetres, unit: 'centimeters' }
        : relative !== null
          ? { metric: 'verticalOscillation', value: relative, unit: 'ratio' }
          : null,
    strideTorsoLengths: relative !== null ? relative / ratio.value : null,
    strideCount: ratio.sampleSize,
  }
}
