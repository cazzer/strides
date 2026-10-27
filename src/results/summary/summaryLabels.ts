import type { MetricId } from '../../heuristics/types'
import { readingHeadline } from '../../guidance/compositeReadings'
import type { AreaReading, BounceDerivation } from '../../guidance/compositeReadings'
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

/**
 * The names a row's "Also:" line lists: each later reading once, by its headline metric's full
 * name. A composite is named once ("Vertical ratio", or "Vertical oscillation (cm)" when vertical
 * ratio is excluded), never by each of its members, which read as the same thing listed twice.
 */
export function alsoMeasuredNames(readings: readonly AreaReading<GuidedEntry>[]): string[] {
  return readings.map((reading) => METRIC_LABELS[readingHeadline(reading).metric.metric])
}

function medianOf(count: number): string {
  return count === 1 ? 'one measurement' : `median of ${count}`
}

/**
 * What vertical ratio was derived from: its own two inputs, in torso lengths so the division checks
 * (`15.3% ÷ 6.3 = 2.4%`), `From hip bounce 15.3% of torso ÷ stride length 6.3 torsos (median of 3)`.
 * Without same-clip figures it names the inputs alone: `From hip bounce ÷ stride length (median of 3)`.
 * "Stride" is only ever the length here; the count is "median of N".
 */
export function formatBounceDerivation(derivation: BounceDerivation): string {
  const { figures, strideCount } = derivation
  const count = `(${medianOf(strideCount)})`
  return figures === null
    ? `From hip bounce ÷ stride length ${count}`
    : `From hip bounce ${(figures.bounceTorsoLengths * 100).toFixed(1)}% of torso ÷ stride length ${figures.strideTorsoLengths.toFixed(1)} torsos ${count}`
}

/**
 * A reading's "From …" line: only for a composite headlined by vertical ratio, the one metric the
 * others' figures were inputs to. A fallback headline (vertical ratio excluded) cites nothing.
 */
export function readingDerivation(
  reading: AreaReading<GuidedEntry>,
  bounce: BounceDerivation | null,
): string | undefined {
  return reading.kind === 'composite' && reading.headline.metric.metric === 'verticalRatio' && bounce !== null
    ? formatBounceDerivation(bounce)
    : undefined
}

/**
 * Whether a row's headline gets a compact band bar: a band with a drawable extent, and a value.
 * The legend renders only when some row has one, so the two share this one test.
 */
export function hasCompactBar(entry: GuidedEntry): boolean {
  return entry.band !== null && entry.metric.value !== null && referenceBandEnvelope(entry.band) !== null
}
