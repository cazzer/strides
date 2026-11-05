import { useId } from 'react'
import { METRIC_LABELS } from '../results/metricConfidence'
import { formatGuidedValue } from '../results/formatGuidedValue'
import { axisUnitLabel, axisValue, dateLabels, type MetricSeries, type ProgressPoint } from './progressSeries'

const WIDTH = 320
const HEIGHT = 140
const PAD = { left: 44, right: 12, top: 12, bottom: 26 }

function formatAxis(value: number): string {
  const abs = Math.abs(value)
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2)
}

/**
 * One metric across saved assessments (design D6), inline SVG. Each definition-version run is its
 * own line — never joined to another — with a dashed, labelled break between runs; only the latest
 * run is drawn at full strength. Caveated readings are hollow. No trend line, no colour for
 * direction, no verdict. The table in the disclosure is the same numbers, and the text alternative.
 */
export function MetricProgressChart({ series }: { series: MetricSeries }) {
  const titleId = useId()
  const label = METRIC_LABELS[series.metric]
  const all = series.runs.flatMap((run) => run.points)
  const times = all.map((p) => Date.parse(p.savedAt))
  const values = all.map((p) => axisValue(series.unit, p.value))

  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  let vMin = Math.min(...values)
  let vMax = Math.max(...values)
  const nonNegative = vMin >= 0
  if (vMin === vMax) {
    const pad = Math.abs(vMin) * 0.05 || 1
    vMin -= pad
    vMax += pad
  } else {
    const pad = (vMax - vMin) * 0.12
    vMin -= pad
    vMax += pad
  }
  // No unit here reads below zero when every reading is at or above it; don't draw a negative axis.
  if (nonNegative) vMin = Math.max(0, vMin)
  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (p: ProgressPoint) =>
    tMax === tMin ? PAD.left + plotW / 2 : PAD.left + ((Date.parse(p.savedAt) - tMin) / (tMax - tMin)) * plotW
  const y = (p: ProgressPoint) => PAD.top + (1 - (axisValue(series.unit, p.value) - vMin) / (vMax - vMin)) * plotH

  const labels = dateLabels([
    ...all,
    ...series.notMeasured,
    ...series.newer,
  ])
  const dateOf = (item: { id: string; localDate: string }) => labels.get(item.id) ?? item.localDate
  const lastRun = series.runs.length - 1
  const breaks = series.runs.slice(1).map((run, i) => {
    const before = series.runs[i].points
    const after = run.points
    const bx = (Math.max(...before.map(x)) + Math.min(...after.map(x))) / 2
    return { x: bx, from: series.runs[i].definitionVersion, to: run.definitionVersion }
  })

  const first = all.length > 0 ? all.reduce((a, b) => (a.savedAt <= b.savedAt ? a : b)) : null
  const last = all.length > 0 ? all.reduce((a, b) => (a.savedAt >= b.savedAt ? a : b)) : null
  const fmt = (p: ProgressPoint) => formatGuidedValue({ metric: series.metric, value: p.value, unit: series.unit })
  const summary =
    all.length === 0
      ? `${label}: no readings this version of Strides can show.`
      : all.length === 1 || !first || !last
        ? `${label}: one reading, ${fmt(all[0])} on ${dateOf(all[0])}.`
        : `${label} across ${all.length} readings: ${fmt(first)} on ${dateOf(first)}, ${fmt(last)} on ${dateOf(last)}.`

  type Row = { key: string; date: string; reading: string; note: string; savedAt: string }
  const rows: Row[] = [
    ...series.runs.flatMap((run) =>
      run.points.map((p) => ({
        key: p.id,
        date: dateOf(p),
        savedAt: p.savedAt,
        reading: fmt(p),
        note: `Definition ${run.definitionVersion}${p.tier === 'caveated' ? ', lower confidence' : ''}`,
      })),
    ),
    ...series.notMeasured.map((n) => ({ key: n.id, date: dateOf(n), savedAt: n.savedAt, reading: 'Not measured', note: '' })),
    ...series.newer.map((n) => ({
      key: n.id,
      date: dateOf(n),
      savedAt: n.savedAt,
      reading: 'Not shown',
      note: `Saved by a newer Strides (definition ${n.definitionVersion})`,
    })),
  ].sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0))

  return (
    <figure className="metric-progress space-y-2 border-t-2 border-black pt-3 dark:border-white" data-metric={series.metric}>
      <figcaption id={titleId} className="font-sans text-sm font-semibold">
        {label} <span className="font-normal text-neutral-600 dark:text-neutral-400">({axisUnitLabel(series.unit)})</span>
      </figcaption>
      {all.length > 0 && (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="metric-progress__chart block w-full max-w-md text-black dark:text-white"
          role="img"
          aria-labelledby={titleId}
          aria-description={summary}
        >
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="currentColor" strokeOpacity={0.4} />
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} stroke="currentColor" strokeOpacity={0.4} />
          <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" fontSize={10} fill="currentColor">
            {formatAxis(vMax)}
          </text>
          <text x={PAD.left - 6} y={HEIGHT - PAD.bottom} textAnchor="end" fontSize={10} fill="currentColor">
            {formatAxis(vMin)}
          </text>
          {first && (
            <text x={PAD.left} y={HEIGHT - 8} textAnchor="start" fontSize={10} fill="currentColor">
              {dateOf(first)}
            </text>
          )}
          {last && last !== first && (
            <text x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end" fontSize={10} fill="currentColor">
              {dateOf(last)}
            </text>
          )}
          {breaks.map((b) => (
            <g key={`${b.from}-${b.to}`} data-definition-break>
              <line x1={b.x} x2={b.x} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="currentColor" strokeDasharray="3 3" strokeOpacity={0.7} />
              <text x={b.x + 3} y={PAD.top + 8} fontSize={9} fill="currentColor">
                v{b.from}→v{b.to}
              </text>
            </g>
          ))}
          {series.runs.map((run, i) => (
            <g key={run.definitionVersion} data-run={run.definitionVersion} opacity={i === lastRun ? 1 : 0.45}>
              {run.points.length > 1 && (
                <polyline
                  points={run.points.map((p) => `${x(p)},${y(p)}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                />
              )}
              {run.points.map((p) => (
                <circle
                  key={p.id}
                  cx={x(p)}
                  cy={y(p)}
                  r={4}
                  strokeWidth={2}
                  stroke="currentColor"
                  // Hollow = no fill at all, so it reads hollow on any page background.
                  fill={p.tier === 'caveated' ? 'none' : 'currentColor'}
                  data-tier={p.tier}
                />
              ))}
            </g>
          ))}
        </svg>
      )}
      {breaks.map((b) => (
        <p key={`${b.from}-${b.to}`} className="font-sans text-xs text-neutral-700 dark:text-neutral-300">
          Definition changed (v{b.from} → v{b.to}): earlier readings are not comparable with later ones.
        </p>
      ))}
      {series.notMeasured.length > 0 && (
        <p className="font-sans text-xs text-neutral-700 dark:text-neutral-300">
          Not measured on {series.notMeasured.map(dateOf).join(', ')}.
        </p>
      )}
      {series.newer.length > 0 && (
        <p className="font-sans text-xs text-neutral-700 dark:text-neutral-300">
          {series.newer.length === 1 ? 'One reading was' : `${series.newer.length} readings were`} saved by a newer
          Strides and {series.newer.length === 1 ? 'is' : 'are'} not shown here.
        </p>
      )}
      <details className="font-sans text-sm">
        <summary className="w-fit cursor-pointer underline underline-offset-2">Show as table</summary>
        <table className="mt-2 w-full max-w-md text-left text-sm">
          <caption className="sr-only">{label} by assessment date</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 font-semibold">Date</th>
              <th scope="col" className="pr-3 font-semibold">Reading</th>
              <th scope="col" className="font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="pr-3">{row.date}</td>
                <td className="pr-3">{row.reading}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
