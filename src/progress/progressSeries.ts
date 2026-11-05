import type { MetricId, MetricResult } from '../heuristics/types'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '../guidance/focusAreas'
import type { MetricTier } from '../guidance/types'
import type { IndexEntry } from '../storage/assessmentRecord'
import { knownDefinitionVersion } from '../storage/methodology'

/**
 * Turns the saved index into one series per metric for the progress page (design D6). Pure.
 *
 * The rule this module exists for: **readings under different definition versions are never
 * joined.** A metric's measured readings are grouped by `definitionVersion`; each group is a run,
 * drawn as its own line, with a labelled break between runs. A version newer than this build knows
 * was saved by a newer Strides and is listed, not plotted. Excluded readings are listed as not
 * measured and never plotted (never as zero). No verdicts: nothing here says better or worse.
 */

export interface ProgressPoint {
  id: string
  savedAt: string
  localDate: string
  value: number
  tier: Exclude<MetricTier, 'excluded'>
}

export interface MetricRun {
  definitionVersion: number
  points: ProgressPoint[]
}

export interface MetricSeries {
  metric: MetricId
  unit: MetricResult['unit']
  /** Ordered by definition version, oldest first; points within a run oldest first. */
  runs: MetricRun[]
  notMeasured: { id: string; localDate: string; savedAt: string }[]
  newer: { id: string; localDate: string; savedAt: string; definitionVersion: number }[]
}

/** Every metric in focus-area order, headline-preference order within an area. */
export const PROGRESS_METRIC_ORDER: readonly MetricId[] = FOCUS_AREA_ORDER.flatMap(
  (area) => FOCUS_AREAS[area].metricIds,
)

export function progressSeries(
  entries: readonly IndexEntry[],
  knownVersion: (metric: MetricId) => number = knownDefinitionVersion,
): MetricSeries[] {
  const chronological = [...entries].sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0))
  const out: MetricSeries[] = []
  for (const metric of PROGRESS_METRIC_ORDER) {
    const known = knownVersion(metric)
    const runs = new Map<number, ProgressPoint[]>()
    const notMeasured: MetricSeries['notMeasured'] = []
    const newer: MetricSeries['newer'] = []
    let unit: MetricResult['unit'] | null = null
    for (const entry of chronological) {
      const reading = entry.metrics[metric]
      if (!reading) continue
      if (reading.definitionVersion > known) {
        newer.push({ id: entry.id, localDate: entry.localDate, savedAt: entry.savedAt, definitionVersion: reading.definitionVersion })
        continue
      }
      if (reading.tier === 'excluded' || reading.value === null) {
        notMeasured.push({ id: entry.id, localDate: entry.localDate, savedAt: entry.savedAt })
        continue
      }
      const points = runs.get(reading.definitionVersion) ?? []
      points.push({
        id: entry.id,
        savedAt: entry.savedAt,
        localDate: entry.localDate,
        value: reading.value,
        tier: reading.tier,
      })
      runs.set(reading.definitionVersion, points)
      unit = reading.unit
    }
    if (runs.size === 0 && newer.length === 0) continue
    out.push({
      metric,
      unit: unit ?? entries.find((e) => e.metrics[metric])?.metrics[metric].unit ?? 'ratio',
      runs: [...runs.entries()].sort(([a], [b]) => a - b).map(([definitionVersion, points]) => ({ definitionVersion, points })),
      notMeasured,
      newer,
    })
  }
  return out
}

/** A value in the unit a chart axis shows it in. Ratios and percents read as percentages. */
export function axisValue(unit: MetricResult['unit'], value: number): number {
  return unit === 'ratio' || unit === 'percent' ? value * 100 : value
}

export function axisUnitLabel(unit: MetricResult['unit']): string {
  switch (unit) {
    case 'ratio':
      return '% of torso length'
    case 'percent':
      return '%'
    case 'degrees':
      return 'degrees'
    case 'stepsPerMinute':
      return 'steps/min'
    case 'centimeters':
      return 'cm'
  }
}

/** `14.32`, the save's local time — shown beside dates only where two saves share a day. */
export function localTimeOf(savedAt: string): string {
  const d = new Date(savedAt)
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`
}

/** A label per saved assessment: its date, plus its time when another save shares that date. */
export function dateLabels(entries: readonly { id: string; localDate: string; savedAt: string }[]): Map<string, string> {
  const perDay = new Map<string, number>()
  for (const e of entries) perDay.set(e.localDate, (perDay.get(e.localDate) ?? 0) + 1)
  return new Map(
    entries.map((e) => [e.id, (perDay.get(e.localDate) ?? 0) > 1 ? `${e.localDate} ${localTimeOf(e.savedAt)}` : e.localDate]),
  )
}
