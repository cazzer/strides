import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import type { FormHeuristicsResult, MetricId, VerticalOscillationSignal } from '../heuristics/types'
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
 * - `verticalRatio` = `fit.peakToPeakAmplitude / stride.strideLengthPx` (`verticalRatio.ts`): the
 *   MoveNet hip bounce in pixels over the median same-side stride in pixels. It does NOT read
 *   `verticalOscillationCm`, a separate MediaPipe fit (the scale pass) that may even track another
 *   person, so the derivation never cites the centimetre bounce.
 * - `verticalOscillation` = the same fit's amplitude over the median torso length in pixels, under the
 *   default `verticalOscillationSignal: 'hipMid'`. Same fit, same frames, so
 *   `verticalOscillation / verticalRatio` = `strideLengthPx / torsoLengthPx` EXACTLY: the stride in
 *   torso lengths, which no metric exposes on its own. `compositeReadings.test.ts` pins the identity.
 * - Stride in metres (`verticalOscillationCm / verticalRatio`) would mix that separate fit with the
 *   ratio and be circular besides; it is never derived here.
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

/**
 * What vertical ratio was derived from, as far as this result can say it (design.md D3): its own
 * two inputs, in the one unit that makes the arithmetic check (torso lengths), and the stride count.
 *
 * Never the centimetre bounce: `verticalOscillationCm` is a separate MediaPipe fit (the scale pass),
 * possibly of a different subject, and vertical ratio does not read it.
 */
export interface BounceDerivation {
  /**
   * The hip bounce and the stride, both in torso lengths, so `bounce / stride` IS vertical ratio:
   * `verticalOscillation` (the same hip fit's amplitude over the torso) and
   * `verticalOscillation / verticalRatio` (the stride over the torso). Null unless the relative bounce
   * is measured on vertical ratio's own clip and reads the same fit.
   */
  figures: { bounceTorsoLengths: number; strideTorsoLengths: number } | null
  /** Vertical ratio's `sampleSize`: the same-side stride pairs its stride length is the median of. */
  strideCount: number
}

/**
 * The relative hip bounce (`verticalOscillation`) as measured on vertical ratio's OWN clip, with its
 * tier: what a multi-clip session reads off that clip's per-clip result. Fusion picks each metric's
 * clip independently, so the fused relative bounce may come from another clip than vertical ratio;
 * this one is the same clip and the same hip fit by construction. Presentation only: it is read,
 * never fused, and moves no fused value or clip choice.
 */
export interface RatioClipBounce {
  value: number | null
  tier: MetricTier
}

/**
 * Null unless vertical ratio is measured (not excluded). `sourceIndices` null means one clip.
 *
 * The bounce is `ratioClipBounce` when given (vertical ratio's own clip's relative bounce), else the
 * fused relative bounce, and then only when it was fused from vertical ratio's clip.
 *
 * `voSignal` is the signal `verticalOscillation` was computed from. Production computes every clip
 * with `DEFAULT_HEURISTICS_CONFIG` (`runClipAnalysisPipeline.ts`), and the result does not record
 * the signal, so this guards the default: an `earMid` vertical oscillation fits a different series
 * from vertical ratio's hip fit, and its quotient would not be the stride (strides-xki9 design D3).
 */
export function bounceDerivation(
  fused: Pick<FormHeuristicsResult, 'verticalRatio' | 'verticalOscillation'>,
  tiers: Readonly<Pick<Record<MetricId, MetricTier>, 'verticalRatio' | 'verticalOscillation'>>,
  sourceIndices: Readonly<Record<MetricId, number>> | null,
  voSignal: VerticalOscillationSignal = DEFAULT_HEURISTICS_CONFIG.verticalOscillationSignal,
  ratioClipBounce: RatioClipBounce | null = null,
): BounceDerivation | null {
  const ratio = fused.verticalRatio
  if (tiers.verticalRatio === 'excluded' || ratio.value === null || ratio.value === 0) return null
  const bounce = ratioClipBounce ?? {
    value: fused.verticalOscillation.value,
    tier: tiers.verticalOscillation,
  }
  const relative = bounce.value
  const sameClip =
    ratioClipBounce !== null ||
    sourceIndices === null ||
    sourceIndices.verticalOscillation === sourceIndices.verticalRatio
  const usable =
    voSignal === 'hipMid' &&
    relative !== null &&
    Number.isFinite(relative) &&
    bounce.tier !== 'excluded' &&
    sameClip
  return {
    figures: usable ? { bounceTorsoLengths: relative, strideTorsoLengths: relative / ratio.value } : null,
    strideCount: ratio.sampleSize,
  }
}
