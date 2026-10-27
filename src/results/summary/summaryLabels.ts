import type { MetricId } from '../../heuristics/types'
import { referenceBandEnvelope } from '../../guidance/types'
import type { GuidedEntry } from '../guidedGroups'
import { METRIC_LABELS } from '../metricConfidence'

/**
 * The short name a collapsed summary row puts before its headline value, so the row says WHICH
 * measurement it is quoting ("Overstriding 51.2% of torso length"). Foot strike is absent: its
 * value already names itself ("Heel strike (proxy)").
 */
export const SHORT_METRIC_LABELS: Readonly<Partial<Record<MetricId, string>>> = {
  cadence: 'Cadence',
  verticalOscillationCm: 'Bounce',
  verticalRatio: 'Vertical ratio',
  verticalOscillation: 'Bounce',
  armSwingAmplitude: 'Arm swing',
  trunkLean: 'Trunk lean',
  kneeFlexion: 'Knee flexion',
  kneeDrive: 'Knee drive',
  overstriding: 'Overstriding',
  stepWidthCm: 'Step width',
  stepWidth: 'Step width',
  swingFootLateralExcursion: 'Swing-foot path',
}

/** The three bounce measures, each by the unit that tells it apart, in the order they are listed. */
const BOUNCE_UNITS: ReadonlyArray<[MetricId, string]> = [
  ['verticalOscillationCm', 'cm'],
  ['verticalRatio', 'ratio'],
  ['verticalOscillation', '% torso'],
]

/**
 * The names a row's "Also:" line lists. Two or more bounce measures collapse into one
 * "bounce (cm, ratio, % torso)" entry naming only those present, where the first of them sat —
 * listed apart, "Vertical oscillation" and "Vertical oscillation (cm)" read as the same thing twice.
 */
export function alsoMeasuredNames(metrics: readonly MetricId[]): string[] {
  const bounce = BOUNCE_UNITS.filter(([id]) => metrics.includes(id))
  const collapse = bounce.length >= 2
  const names: string[] = []
  for (const metric of metrics) {
    const isBounce = BOUNCE_UNITS.some(([id]) => id === metric)
    if (!collapse || !isBounce) names.push(METRIC_LABELS[metric])
    else if (metric === bounce[0][0]) names.push(`bounce (${bounce.map(([, unit]) => unit).join(', ')})`)
  }
  return names
}

/**
 * Whether a row's headline gets a compact band bar: a band with a drawable extent, and a value.
 * The legend renders only when some row has one, so the two share this one test.
 */
export function hasCompactBar(entry: GuidedEntry): boolean {
  return entry.band !== null && entry.metric.value !== null && referenceBandEnvelope(entry.band) !== null
}
