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
      diagnostics: {
        bilateralSpreadRatio: 0.2,
        sagittalExcursionRatio: 0.9,
        frameCoverage: 1,
      },
    },
    verticalOscillation: {
      ...base,
      metric: 'verticalOscillation',
      value: 0.1,
      series: [{ timestamp: 0, value: 0.1 }],
      fit: null,
    },
    verticalRatio: { ...base, metric: 'verticalRatio', value: 0.08, unit: 'percent' },
    verticalOscillationCm: {
      ...base,
      metric: 'verticalOscillationCm',
      value: 4.79,
      unit: 'centimeters',
      calibration: null,
    },
    trunkLean: { ...base, metric: 'trunkLean', value: 5, unit: 'degrees' },
    overstriding: { ...base, metric: 'overstriding', value: 0.1 },
    cadence: { ...base, metric: 'cadence', value: 170, unit: 'stepsPerMinute' },
    kneeFlexion: { ...base, metric: 'kneeFlexion', value: 110, unit: 'degrees' },
    armSwingSymmetry: { ...base, metric: 'armSwingSymmetry', value: 0.9, unit: 'percent' },
    footStrikePattern: {
      ...base,
      metric: 'footStrikePattern',
      value: 0.01,
      caveat: 'Approximated from ankle position relative to the knee at footstrike.',
    },
  }
}

function makeAnalysis(
  overrides: Partial<VideoAnalysisState> = {},
): VideoAnalysisState {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    diagnostics: null,
    scalePass: { status: 'idle', diagnostics: null },
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function renderResultsView(
  props: Partial<
    Pick<Parameters<typeof ResultsView>[0], 'analysis' | 'onTryAgain'>
  > = {},
) {
  const onTryAgain = props.onTryAgain ?? vi.fn()
  render(
    <ResultsView analysis={props.analysis ?? makeAnalysis()} onTryAgain={onTryAgain} />,
  )
  return { onTryAgain }
}

describe('ResultsView', () => {
  it('enables the Analyze button when idle', () => {
    renderResultsView()
    expect(screen.getByRole('button', { name: /analyze/i })).toBeEnabled()
  })

  it('disables the Analyze button once a run has started', () => {
    renderResultsView({ analysis: makeAnalysis({ phase: 'sampling' }) })
    expect(screen.getByRole('button', { name: /analyze/i })).toBeDisabled()
  })

  it('re-enables Analyze once a run completes, so the same clip can be re-analyzed', () => {
    renderResultsView({
      analysis: makeAnalysis({ phase: 'ready', heuristics: makeHeuristics() }),
    })
    expect(screen.getByRole('button', { name: /analyze again/i })).toBeEnabled()
  })

  it('re-enables Analyze after an error, so the user can retry via the primary button too', () => {
    renderResultsView({
      analysis: makeAnalysis({
        phase: 'error',
        error: { kind: 'unknown', message: 'Something broke.' },
      }),
    })
    expect(screen.getByRole('button', { name: /analyze again/i })).toBeEnabled()
  })

  it('calls start() when the Analyze button is clicked', () => {
    const analysis = makeAnalysis()
    renderResultsView({ analysis })
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }))
    expect(analysis.start).toHaveBeenCalledTimes(1)
  })

  it('shows a progress readout with percentage while sampling', () => {
    renderResultsView({
      analysis: makeAnalysis({ phase: 'sampling', progress: 0.42 }),
    })
    expect(screen.getByRole('status').textContent).toMatch(/42%/)
  })

  it('shows a processing readout while processing', () => {
    renderResultsView({
      analysis: makeAnalysis({ phase: 'processing', progress: 1 }),
    })
    expect(screen.getByRole('status').textContent).toMatch(/processing/i)
  })

  it('mentions the pause when analysis is paused mid-sampling', () => {
    renderResultsView({
      analysis: makeAnalysis({
        phase: 'sampling',
        progress: 0.2,
        isPausedMidAnalysis: true,
      }),
    })
    expect(screen.getByRole('status').textContent).toMatch(/paused/i)
  })

  it('announces completion once ready', () => {
    renderResultsView({
      analysis: makeAnalysis({ phase: 'ready', heuristics: makeHeuristics() }),
    })
    expect(screen.getByRole('status').textContent).toMatch(/complete/i)
  })

  it('narrates the scale pass through the status line: measuring, then measured', () => {
    // The status line is the pass's only always-visible surface (the excluded-list hint sits
    // below the fold) and its only screen-reader announcement path.
    const { rerender } = render(
      <ResultsView
        analysis={makeAnalysis({
          phase: 'ready',
          heuristics: makeHeuristics(),
          scalePass: { status: 'running', diagnostics: null },
        })}
        onTryAgain={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(
      /measuring one more metric with a second pass/i,
    )

    rerender(
      <ResultsView
        analysis={makeAnalysis({
          phase: 'ready',
          heuristics: makeHeuristics(),
          scalePass: { status: 'done', diagnostics: null },
        })}
        onTryAgain={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(
      /one more metric was measured by a second pass/i,
    )
  })

  it('says the second pass ran but failed, in the status line, when it fails', () => {
    renderResultsView({
      analysis: makeAnalysis({
        phase: 'ready',
        heuristics: makeHeuristics(),
        scalePass: { status: 'failed', error: 'x', diagnostics: null },
      }),
    })
    expect(screen.getByRole('status').textContent).toMatch(
      /second measurement pass ran but couldn't add its metric/i,
    )
  })

  it('keeps the status line to plain completion when the pass was skipped', () => {
    renderResultsView({
      analysis: makeAnalysis({
        phase: 'ready',
        heuristics: makeHeuristics(),
        scalePass: { status: 'skipped', reason: 'primary-scale', diagnostics: null },
      }),
    })
    expect(screen.getByRole('status').textContent).toBe('Analysis complete.')
  })

  it('shows an error alert and calls onTryAgain (not analysis.reset directly) from its button', () => {
    const analysis = makeAnalysis({
      phase: 'error',
      error: { kind: 'detector-unavailable', message: 'Detector not ready.' },
    })
    const { onTryAgain } = renderResultsView({ analysis })

    expect(screen.getByRole('alert').textContent).toMatch(/detector not ready/i)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    // The alert unmounts on click and holds focus until then -- moving focus somewhere stable
    // is the caller's job (see App.tsx's handleTryAgain), which is exactly why this button
    // calls the injected onTryAgain prop rather than analysis.reset directly.
    expect(onTryAgain).toHaveBeenCalledTimes(1)
    expect(analysis.reset).not.toHaveBeenCalled()
  })

  it('renders the metrics panel once phase is ready', () => {
    renderResultsView({
      analysis: makeAnalysis({ phase: 'ready', heuristics: makeHeuristics() }),
    })
    expect(
      screen.getByRole('region', { name: /form metrics/i }),
    ).toBeInTheDocument()
  })

  it('does not render an excluded section when every metric clears tier 1/2', () => {
    renderResultsView({
      analysis: makeAnalysis({ phase: 'ready', heuristics: makeHeuristics() }),
    })
    expect(
      screen.queryByText(/not measured for this clip/i),
    ).not.toBeInTheDocument()
  })

  it('renders a flagged metric in the metrics panel excluded section, not a banner', () => {
    const heuristics = makeHeuristics()
    renderResultsView({
      analysis: makeAnalysis({
        phase: 'ready',
        heuristics: { ...heuristics, trunkLean: { ...heuristics.trunkLean, value: null } },
      }),
    })
    // #37 superseded the standalone LowConfidenceBanner with MetricsPanel's own excluded
    // section -- this asserts the excluded metric surfaces there, and that no separate
    // "lower-confidence results" banner text exists anywhere in ResultsView anymore. (Text
    // queries for the phrase would now be ambiguous: the tier-summary line repeats it, by
    // design — so both assertions scope by the section's accessible role.)
    expect(screen.getByRole('region', { name: /not measured for this clip/i })).toHaveTextContent(
      /trunk lean/i,
    )
    expect(screen.queryByText(/lower-confidence results/i)).not.toBeInTheDocument()
  })

  it('does not render results or status content while idle', () => {
    renderResultsView()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: /form metrics/i }),
    ).not.toBeInTheDocument()
  })
})
