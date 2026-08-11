import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerticalOscillationChart } from './VerticalOscillationChart'
import type { TimeseriesPoint } from '../heuristics/types'

describe('VerticalOscillationChart', () => {
  it('renders one polyline for a fully-resolved series', () => {
    const series: TimeseriesPoint[] = [
      { timestamp: 0, value: 0 },
      { timestamp: 1, value: 0.1 },
      { timestamp: 2, value: -0.1 },
    ]

    const { container } = render(<VerticalOscillationChart series={series} />)
    const polylines = container.querySelectorAll('polyline')
    expect(polylines).toHaveLength(1)
  })

  it('breaks the polyline into separate segments at null gaps, never bridging them', () => {
    const series: TimeseriesPoint[] = [
      { timestamp: 0, value: 0 },
      { timestamp: 1, value: 0.1 },
      { timestamp: 2, value: null },
      { timestamp: 3, value: null },
      { timestamp: 4, value: -0.1 },
      { timestamp: 5, value: 0 },
    ]

    const { container } = render(<VerticalOscillationChart series={series} />)
    const polylines = container.querySelectorAll('polyline')
    expect(polylines).toHaveLength(2)

    // First segment has 2 points, second has 2 points — neither includes a point derived from
    // the null gap.
    const firstPoints = polylines[0].getAttribute('points')?.trim().split(' ')
    const secondPoints = polylines[1].getAttribute('points')?.trim().split(' ')
    expect(firstPoints).toHaveLength(2)
    expect(secondPoints).toHaveLength(2)
  })

  it('mentions the gap in the caption when segments are broken up', () => {
    const series: TimeseriesPoint[] = [
      { timestamp: 0, value: 0 },
      { timestamp: 1, value: null },
      { timestamp: 2, value: 0.1 },
    ]

    render(<VerticalOscillationChart series={series} />)
    expect(screen.getByText(/gaps in the line/i)).toBeInTheDocument()
  })

  it('does not mention gaps when the series has none', () => {
    const series: TimeseriesPoint[] = [
      { timestamp: 0, value: 0 },
      { timestamp: 1, value: 0.1 },
    ]

    render(<VerticalOscillationChart series={series} />)
    expect(screen.queryByText(/gaps in the line/i)).not.toBeInTheDocument()
  })

  it('renders a fallback message for an empty series', () => {
    render(<VerticalOscillationChart series={[]} />)
    expect(screen.getByText(/no vertical oscillation waveform/i)).toBeInTheDocument()
  })

  it('renders a fallback message when every point is null', () => {
    const series: TimeseriesPoint[] = [
      { timestamp: 0, value: null },
      { timestamp: 1, value: null },
    ]
    render(<VerticalOscillationChart series={series} />)
    expect(screen.getByText(/no vertical oscillation waveform/i)).toBeInTheDocument()
  })

  it('exposes an accessible name via role="img" and a title', () => {
    const series: TimeseriesPoint[] = [
      { timestamp: 0, value: 0 },
      { timestamp: 1, value: 0.1 },
    ]
    render(<VerticalOscillationChart series={series} />)
    expect(
      screen.getByRole('img', { name: /vertical oscillation over the course of the run/i }),
    ).toBeInTheDocument()
  })
})
