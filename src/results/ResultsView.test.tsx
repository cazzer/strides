import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultsView } from './ResultsView'
import type { VideoAnalysisState } from './types'
import type { FormHeuristicsResult } from '../heuristics/types'

function makeHeuristics(): FormHeuristicsResult {
  const base = {
    unit: 'ratio' as const,
    confidence: 0.9,
    viewFit: 'primary' as const,
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 10,
    caveat: null,
  }
  return {
    view: {
      view: 'side',
      confidence: 0.9,
      diagnostics: { bilateralSpreadRatio: 0.2, sagittalExcursionRatio: 0.9, frameCoverage: 1 },
    },
    verticalOscillation: {
      ...base,
      metric: 'verticalOscillation',
      value: 0.1,
      series: [{ timestamp: 0, value: 0.1 }],
    },
    trunkLean: { ...base, metric: 'trunkLean', value: 5, unit: 'degrees' },
    overstriding: { ...base, metric: 'overstriding', value: 0.1 },
  }
}

function makeAnalysis(overrides: Partial<VideoAnalysisState> = {}): VideoAnalysisState {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

describe('ResultsView', () => {
  it('enables the Analyze button when idle and quality gate is not assessing', () => {
    render(<ResultsView analysis={makeAnalysis()} qualityAssessing={false} />)
    expect(screen.getByRole('button', { name: /analyze/i })).toBeEnabled()
  })

  it('disables the Analyze button while the quality gate is assessing', () => {
    render(<ResultsView analysis={makeAnalysis()} qualityAssessing={true} />)
    expect(screen.getByRole('button', { name: /analyze/i })).toBeDisabled()
  })

  it('disables the Analyze button once a run has started', () => {
    render(
      <ResultsView
        analysis={makeAnalysis({ phase: 'sampling' })}
        qualityAssessing={false}
      />,
    )
    expect(screen.getByRole('button', { name: /analyze/i })).toBeDisabled()
  })

  it('calls start() when the Analyze button is clicked', () => {
    const analysis = makeAnalysis()
    render(<ResultsView analysis={analysis} qualityAssessing={false} />)
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }))
    expect(analysis.start).toHaveBeenCalledTimes(1)
  })

  it('shows a progress readout with percentage while sampling', () => {
    render(
      <ResultsView
        analysis={makeAnalysis({ phase: 'sampling', progress: 0.42 })}
        qualityAssessing={false}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/42%/)
  })

  it('shows a processing readout while processing', () => {
    render(
      <ResultsView
        analysis={makeAnalysis({ phase: 'processing', progress: 1 })}
        qualityAssessing={false}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/processing/i)
  })

  it('mentions the pause when analysis is paused mid-sampling', () => {
    render(
      <ResultsView
        analysis={makeAnalysis({
          phase: 'sampling',
          progress: 0.2,
          isPausedMidAnalysis: true,
        })}
        qualityAssessing={false}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/paused/i)
  })

  it('shows an error alert with a working try-again button', () => {
    const analysis = makeAnalysis({
      phase: 'error',
      error: { kind: 'detector-unavailable', message: 'Detector not ready.' },
    })
    render(<ResultsView analysis={analysis} qualityAssessing={false} />)

    expect(screen.getByRole('alert').textContent).toMatch(/detector not ready/i)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(analysis.reset).toHaveBeenCalledTimes(1)
  })

  it('renders the metrics panel once phase is ready', () => {
    render(
      <ResultsView
        analysis={makeAnalysis({ phase: 'ready', heuristics: makeHeuristics() })}
        qualityAssessing={false}
      />,
    )
    expect(screen.getByRole('region', { name: /form metrics/i })).toBeInTheDocument()
  })

  it('does not render results or status content while idle', () => {
    render(<ResultsView analysis={makeAnalysis()} qualityAssessing={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /form metrics/i })).not.toBeInTheDocument()
  })
})
