import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeHeuristics } from '../__fixtures__/metricResult'
import type { VideoAnalysisState } from '../types'
import { RunnerTour } from './RunnerTour'

function readyAnalysis(): VideoAnalysisState {
  return {
    phase: 'ready',
    progress: 1,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: makeHeuristics(),
    diagnostics: null,
    scalePass: { status: 'idle', diagnostics: null },
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
  }
}

describe('RunnerTour (stub)', () => {
  it('renders one guided view, one completion line, a hidden runner slot and Skip', () => {
    const onLeaveTour = vi.fn()
    const { container } = render(
      <RunnerTour
        analysis={readyAnalysis()}
        onTryAgain={vi.fn()}
        onStartOver={vi.fn()}
        onLeaveTour={onLeaveTour}
      />,
    )

    const root = container.firstElementChild
    expect(root).toHaveClass('runner-tour')
    // The root is not a second "Analysis results" section; the guided view inside it is the one.
    expect(root?.tagName).toBe('DIV')
    expect(container.querySelectorAll('section[aria-label="Analysis results"]')).toHaveLength(1)
    expect(container.querySelectorAll('.guided-results')).toHaveLength(1)
    expect(screen.getAllByText(/analysis complete/i)).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Analysis complete\./)

    const slot = container.querySelector('.results-runner-slot')
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    expect(slot).toBeEmptyDOMElement()

    const skip = screen.getByRole('button', { name: 'Skip to summary' })
    expect(skip).toHaveAttribute('type', 'button')
    // The tour's own control comes before the guided view's.
    expect(container.querySelector('button')).toBe(skip)
    expect(container.querySelectorAll('[data-view-entry]')).toHaveLength(1)
    expect(skip).toHaveAttribute('data-view-entry')
    fireEvent.click(skip)
    expect(onLeaveTour).toHaveBeenCalledTimes(1)
  })
})
