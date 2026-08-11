import type { TimeseriesPoint } from '../heuristics/types'

export interface VerticalOscillationChartProps {
  series: TimeseriesPoint[]
}

const WIDTH = 400
const HEIGHT = 120
const PADDING = 12

/**
 * Splits `series` into runs of consecutive non-null points, breaking at every `null` — a real
 * gap the analysis flagged (hip position unresolvable that frame), not something to visually
 * interpolate across with a straight line.
 */
function buildSegments(series: TimeseriesPoint[]): TimeseriesPoint[][] {
  const segments: TimeseriesPoint[][] = []
  let current: TimeseriesPoint[] = []
  for (const point of series) {
    if (point.value === null) {
      if (current.length > 0) segments.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/**
 * Hand-rolled inline SVG waveform — no charting library exists in this repo's dependencies
 * today, and adding one for a single polyline isn't justified. A single series needs no legend
 * (the title/caption name it); `role="img"` plus a visible `<figcaption>` text description
 * covers accessibility without needing a full interactive chart.
 */
export function VerticalOscillationChart({ series }: VerticalOscillationChartProps) {
  const resolvedValues = series
    .map((p) => p.value)
    .filter((v): v is number => v !== null)

  if (series.length === 0 || resolvedValues.length === 0) {
    return (
      <p className="vertical-oscillation-chart__empty">
        No vertical oscillation waveform available for this clip.
      </p>
    )
  }

  const timestamps = series.map((p) => p.timestamp)
  const minT = Math.min(...timestamps)
  const maxT = Math.max(...timestamps)
  const minV = Math.min(...resolvedValues)
  const maxV = Math.max(...resolvedValues)
  const spanT = maxT - minT || 1
  const spanV = maxV - minV || 1

  const x = (t: number) => PADDING + ((t - minT) / spanT) * (WIDTH - PADDING * 2)
  const y = (v: number) =>
    HEIGHT - PADDING - ((v - minV) / spanV) * (HEIGHT - PADDING * 2)

  const segments = buildSegments(series)
  const hasGaps = segments.length > 1

  return (
    <figure className="vertical-oscillation-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby="vertical-oscillation-chart-title"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="vertical-oscillation-chart-title">
          Vertical oscillation over the course of the run
        </title>
        <line
          x1={PADDING}
          y1={y(0)}
          x2={WIDTH - PADDING}
          y2={y(0)}
          stroke="currentColor"
          strokeOpacity={0.25}
        />
        {segments.map((segment, i) => (
          <polyline
            key={i}
            points={segment
              .map((p) => `${x(p.timestamp)},${y(p.value as number)}`)
              .join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <text x={PADDING} y={HEIGHT - 2} fontSize={8} fill="currentColor">
          {minT.toFixed(1)}s
        </text>
        <text
          x={WIDTH - PADDING}
          y={HEIGHT - 2}
          fontSize={8}
          textAnchor="end"
          fill="currentColor"
        >
          {maxT.toFixed(1)}s
        </text>
      </svg>
      <figcaption>
        Hip bounce relative to torso length, sampled across the {maxT.toFixed(1)}s clip.
        {hasGaps &&
          ' Gaps in the line mark stretches where hip position could not be tracked.'}
      </figcaption>
    </figure>
  )
}
