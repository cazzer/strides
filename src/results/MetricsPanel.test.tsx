import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricsPanel } from './MetricsPanel'
import type {
  FormHeuristicsResult,
  MetricResult,
  TimeseriesPoint,
  VerticalOscillationResult,
} from '../heuristics/types'

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 20,
    caveat: null,
    ...overrides,
  }
}

function makeVerticalOscillation(
  overrides: Partial<VerticalOscillationResult> = {},
  series: TimeseriesPoint[] = [],
): VerticalOscillationResult {
  return {
    metric: 'verticalOscillation',
    value: 0.1,
    unit: 'ratio',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 20,
    caveat: null,
    series,
    ...overrides,
  }
}

function makeHighConfidenceResult(): FormHeuristicsResult {
  return {
    view: {
      view: 'side',
      confidence: 0.95,
      diagnostics: {
        bilateralSpreadRatio: 0.2,
        sagittalExcursionRatio: 0.9,
        frameCoverage: 1,
      },
    },
    verticalOscillation: makeVerticalOscillation({ value: 0.12, confidence: 0.9 }, [
      { timestamp: 0, value: 0.05 },
      { timestamp: 1, value: -0.05 },
    ]),
    trunkLean: makeMetric({ metric: 'trunkLean', value: 6, confidence: 0.85 }),
    overstriding: makeMetric({
      metric: 'overstriding',
      value: 0.08,
      unit: 'ratio',
      confidence: 0.8,
    }),
  }
}

function makeLowConfidenceResult(): FormHeuristicsResult {
  return {
    view: {
      view: 'front',
      confidence: 0.5,
      diagnostics: {
        bilateralSpreadRatio: 0.6,
        sagittalExcursionRatio: 0.2,
        frameCoverage: 0.5,
      },
    },
    verticalOscillation: makeVerticalOscillation(
      { value: 0.1, confidence: 0.5, viewFit: 'tolerated' },
      [{ timestamp: 0, value: 0.05 }],
    ),
    trunkLean: makeMetric({
      metric: 'trunkLean',
      value: null,
      confidence: 0,
      viewFit: 'unsuitable',
      caveat: 'Trunk lean is a sagittal-plane measurement and is not reliable from a front view.',
    }),
    overstriding: makeMetric({
      metric: 'overstriding',
      value: null,
      unit: 'ratio',
      confidence: 0,
      viewFit: 'unsuitable',
      caveat: 'No resolvable body-scale reference (shoulders/hips) in this clip.',
    }),
  }
}

describe('MetricsPanel', () => {
  it('renders all three metrics with their plain-language labels', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByText('Vertical oscillation')).toBeInTheDocument()
    expect(screen.getByText('Trunk lean')).toBeInTheDocument()
    expect(screen.getByText('Overstriding')).toBeInTheDocument()
  })

  it('renders formatted values and high-confidence labels for a clean result', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByText('6.0°')).toBeInTheDocument()
    expect(screen.getAllByText(/high confidence/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/not reliable from this camera angle/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('renders the vertical oscillation chart inside its card', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByRole('img', { name: /vertical oscillation/i })).toBeInTheDocument()
  })

  it('visibly flags a low-confidence/unsuitable-view metric with distinct text, not color alone', () => {
    render(<MetricsPanel heuristics={makeLowConfidenceResult()} />)

    expect(screen.getAllByText('Not available').length).toBe(2)
    expect(screen.getAllByText(/not reliable from this camera angle/i).length).toBe(2)
    expect(screen.getAllByText('Not measurable').length).toBe(2)

    const notes = screen.getAllByRole('note')
    expect(notes.length).toBe(2)
    expect(notes[0].textContent).toMatch(/sagittal-plane measurement/i)
  })

  it('marks flagged cards with data-flagged for styling, unflagged cards without it', () => {
    const { container } = render(<MetricsPanel heuristics={makeLowConfidenceResult()} />)
    const cards = container.querySelectorAll('.metrics-panel__card')
    const flaggedCount = Array.from(cards).filter(
      (card) => card.getAttribute('data-flagged') === 'true',
    ).length
    // trunkLean and overstriding are unsuitable/null; verticalOscillation is merely tolerated
    // with confidence 0.5 (above the low-confidence threshold), so 2 of 3 are flagged.
    expect(flaggedCount).toBe(2)
  })
})
