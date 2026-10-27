import type {
  FormHeuristicsResult,
  MetricId,
  MetricResult,
} from '../heuristics/types'
import type { MetricTier } from '../results/metricConfidence'

/**
 * The thirteen metrics grouped by the part of the body a runner would look at, in tour order
 * (add-runner-tour design.md D1).
 *
 * Pure data and one pure helper: no copy beyond the area labels, no UI, nothing from the runner.
 * The order of areas is fixed and never depends on a reading — ranking by the runner's own numbers
 * would make the page's structure a judgement about the runner.
 */

export type FocusAreaId =
  'rhythm' | 'arms' | 'posture' | 'knees' | 'landing' | 'footPath'

/** A tour stop: one per focus area, then the closing one-thing stop, which is not an area. */
export type TourStopId = FocusAreaId | 'oneThing'

export const FOCUS_AREA_ORDER: readonly FocusAreaId[] = [
  'rhythm',
  'arms',
  'posture',
  'knees',
  'landing',
  'footPath',
]

/**
 * Each area's label (one or two words) and its metrics, **in headline-preference order**: the
 * first metric that is not excluded speaks for the area. Within `rhythm` and `footPath` the
 * centimetre and step-rate readings come before their relative-unit siblings because those are the
 * units the cited sources report in.
 */
export const FOCUS_AREAS: Record<
  FocusAreaId,
  { label: string; metricIds: readonly MetricId[] }
> = {
  rhythm: {
    label: 'Rhythm',
    metricIds: [
      'cadence',
      'verticalOscillationCm',
      'verticalRatio',
      'verticalOscillation',
    ],
  },
  arms: { label: 'Arms', metricIds: ['armSwingAmplitude'] },
  posture: { label: 'Posture', metricIds: ['trunkLean'] },
  knees: { label: 'Knees', metricIds: ['kneeFlexion', 'kneeDrive'] },
  landing: {
    label: 'Landing',
    metricIds: ['overstriding', 'footStrikePattern'],
  },
  footPath: {
    label: 'Foot path',
    metricIds: ['stepWidthCm', 'stepWidth', 'swingFootLateralExcursion'],
  },
}

export interface FocusMetric {
  metric: MetricResult
  tier: MetricTier
}

export interface FocusAreaView {
  area: FocusAreaId
  label: string
  /** The first non-excluded metric in preference order, or `null` when none was measured. */
  headline: FocusMetric | null
  /** The area's other non-excluded metrics, in preference order. */
  supporting: FocusMetric[]
  /** False exactly when every metric in the area is excluded. */
  measured: boolean
}

export function focusAreaView(
  area: FocusAreaId,
  fused: FormHeuristicsResult,
  tiers: Readonly<Record<MetricId, MetricTier>>,
): FocusAreaView {
  const { label, metricIds } = FOCUS_AREAS[area]
  const measured: FocusMetric[] = metricIds
    .filter((id) => tiers[id] !== 'excluded')
    .map((id) => ({ metric: fused[id] as MetricResult, tier: tiers[id] }))
  const [headline = null, ...supporting] = measured
  return {
    area,
    label,
    headline,
    supporting,
    measured: headline !== null,
  }
}
