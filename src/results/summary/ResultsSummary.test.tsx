import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeHeuristics } from '../__fixtures__/metricResult'
import type { VideoAnalysisState } from '../types'
import { ResultsSummary } from './ResultsSummary'

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

describe('ResultsSummary (stub)', () => {
  it('renders one guided view, one completion line, a hidden runner slot, Replay and a Classic table link', () => {
    const onReplayTour = vi.fn()
    const onOpenClassic = vi.fn()
    const { container } = render(
      <ResultsSummary
        analysis={readyAnalysis()}
        onTryAgain={vi.fn()}
        onStartOver={vi.fn()}
        onReplayTour={onReplayTour}
        onOpenClassic={onOpenClassic}
      />,
    )

    const root = container.firstElementChild
    expect(root).toHaveClass('results-summary')
    expect(root?.tagName).toBe('DIV')
    expect(container.querySelectorAll('section[aria-label="Analysis results"]')).toHaveLength(1)
    expect(container.querySelectorAll('.guided-results')).toHaveLength(1)
    expect(screen.getAllByText(/analysis complete/i)).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Analysis complete\./)
    expect(container.querySelector('.results-runner-slot')).toHaveAttribute('aria-hidden', 'true')

    // In the footer, not at the top where the tour's Skip sits, so a double click on Skip cannot
    // land on it; and the one control marked as the summary's entry point.
    const replay = screen.getByRole('button', { name: 'Replay tour' })
    expect(replay.closest('footer')).not.toBeNull()
    expect(container.querySelectorAll('[data-view-entry]')).toHaveLength(1)
    expect(replay).toHaveAttribute('data-view-entry')
    expect(replay).toHaveClass('min-h-11')
    fireEvent.click(replay)
    expect(onReplayTour).toHaveBeenCalledTimes(1)

    // A button, not a real link: following an href would reload and lose the in-memory analysis.
    expect(screen.queryByRole('link', { name: 'Classic table' })).toBeNull()
    const classic = screen.getByRole('button', { name: 'Classic table' })
    expect(classic.closest('footer')).not.toBeNull()
    expect(classic).toHaveClass('min-h-11')
    fireEvent.click(classic)
    expect(onOpenClassic).toHaveBeenCalledTimes(1)
  })
})
