import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import type { ModelRunnerProps } from '../../runner/ModelRunner'
import { makeHeuristics, makeMetric } from '../__fixtures__/metricResult'
import type { EvidenceFramePlan } from '../evidenceFrames'
import { guidedEntryId } from '../guidedGroups'
import { metricTier } from '../metricConfidence'
import type { MetricCardEvidence } from '../MetricsPanel'
import type { VideoAnalysisState } from '../types'
import type { ResultsSummary as ResultsSummaryComponent } from './ResultsSummary'

// The real runner draws SVG on a rAF loop; what this file checks is which camera, focus and rate the
// summary hands it, and that it is mounted once for the summary's whole life.
const runner = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock('../../runner/ModelRunner', async () => {
  const { useEffect } = await import('react')
  return {
    RUNNER_CAPTION: 'Model built from your numbers',
    ModelRunner: vi.fn(function MockModelRunner() {
      useEffect(() => {
        runner.mounts += 1
        return () => {
          runner.unmounts += 1
        }
      }, [])
      return null
    }),
  }
})

let ResultsSummary: typeof ResultsSummaryComponent

async function lastRunnerProps(): Promise<ModelRunnerProps> {
  const { ModelRunner } = await import('../../runner/ModelRunner')
  const call = vi.mocked(ModelRunner).mock.lastCall
  if (!call) throw new Error('ModelRunner never rendered')
  return call[0]
}

function readyAnalysis(heuristics: FormHeuristicsResult = makeHeuristics()): VideoAnalysisState {
  return {
    phase: 'ready',
    progress: 1,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics,
    diagnostics: null,
    scalePass: { status: 'idle', diagnostics: null },
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
  }
}

function framePlan(metric: MetricId): EvidenceFramePlan {
  return {
    metric,
    kind: 'footStrike',
    quality: 0.8,
    label: `Frame for ${metric}`,
    side: 'left',
    base: { timestamp: 0.4, opacity: 1, keypoints: [], outwardSign: null, side: null },
    ghost: null,
    crop: { x: 0, y: 0, side: 200 },
    travelDirection: 1,
    demotion: null,
    cropGrowth: null,
    focusOffset: null,
  }
}

function renderSummary(
  extra: { evidence?: readonly MetricCardEvidence[]; heuristics?: FormHeuristicsResult } = {},
) {
  const onReplayTour = vi.fn()
  const onOpenClassic = vi.fn()
  const result = render(
    <ResultsSummary
      analysis={readyAnalysis(extra.heuristics)}
      onTryAgain={vi.fn()}
      onStartOver={vi.fn()}
      onReplayTour={onReplayTour}
      onOpenClassic={onOpenClassic}
      evidence={extra.evidence}
    />,
  )
  return { ...result, onReplayTour, onOpenClassic }
}

function row(container: HTMLElement, area: string): HTMLDetailsElement {
  const details = container.querySelector<HTMLDetailsElement>(`details[data-area="${area}"]`)
  if (!details) throw new Error(`no ${area} row`)
  return details
}

function wrapper(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.results-summary__runner')!
}

/** Lays the summary out wide (`lg` and up) or narrow; reduced motion stays off. */
function setWide(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('min-width') ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

beforeEach(async () => {
  setWide(true)
  // A fresh module per test is a fresh page session for the fragment handling (`handledHash`).
  vi.resetModules()
  ResultsSummary = (await import('./ResultsSummary')).ResultsSummary
  runner.mounts = 0
  runner.unmounts = 0
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname)
})

describe('ResultsSummary', () => {
  it('renders one guided shell with one completion line, a heading at the top and both controls in the footer', () => {
    const { container, onReplayTour, onOpenClassic } = renderSummary()

    const root = container.firstElementChild
    expect(root).toHaveClass('results-summary')
    expect(root?.tagName).toBe('DIV')
    expect(container.querySelectorAll('section[aria-label="Analysis results"]')).toHaveLength(1)
    expect(container.querySelectorAll('.guided-results')).toHaveLength(1)
    expect(screen.getAllByText(/analysis complete/i)).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Analysis complete\./)
    expect(container.querySelector('.results-runner-slot')).toBeNull()

    const entries = container.querySelectorAll('[data-view-entry]')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toBe(screen.getByRole('heading', { level: 2, name: 'Summary' }))
    expect(entries[0]).toHaveAttribute('tabindex', '-1')
    expect(container.firstElementChild?.firstElementChild).toBe(entries[0])

    const replay = screen.getByRole('button', { name: 'Replay tour' })
    expect(replay.closest('footer')).not.toBeNull()
    expect(replay).not.toHaveAttribute('data-view-entry')
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

  it('reaches every measured metric from exactly one collapsed row, and every other from Not measured', () => {
    const heuristics = makeHeuristics({
      kneeDrive: makeMetric('kneeDrive', { value: null, confidence: 0 }),
      stepWidthCm: makeMetric('stepWidthCm', { value: null, confidence: 0 }),
    })
    const { container } = renderSummary({ heuristics })
    const rows = Array.from(container.querySelectorAll<HTMLDetailsElement>('details.results-summary__row'))
    expect(rows.length).toBeGreaterThan(1)
    for (const details of rows) expect(details.open).toBe(false)
    expect(rows.at(-1)).toHaveAttribute('data-area', 'notMeasured')

    const ids = Object.keys(METRIC_GUIDANCE) as MetricId[]
    expect(ids).toHaveLength(13)
    for (const id of ids) {
      const metric = heuristics[id]
      const targets = container.querySelectorAll(`#${guidedEntryId(id)}`)
      expect(targets, id).toHaveLength(1)
      const home = targets[0].closest('details.results-summary__row')!
      if (metricTier(metric) === 'excluded') {
        expect(home, id).toHaveAttribute('data-area', 'notMeasured')
      } else {
        expect(home.getAttribute('data-area'), id).not.toBe('notMeasured')
        expect(targets[0].tagName, id).toBe('ARTICLE')
      }
    }
  })

  it('points the one mounted runner at the most recently opened row, and back to the whole body when it closes', async () => {
    const { container } = renderSummary()
    expect(runner.mounts).toBe(1)
    let props = await lastRunnerProps()
    expect(props.camera).toBe('wholeBodySide')
    expect(props.focus).toBeUndefined()
    expect(props.playbackRate).toBe(1)
    expect(wrapper(container)).toHaveAttribute('data-camera', 'wholeBodySide')
    expect(wrapper(container)).toHaveAttribute('data-focus-area', '')

    fireEvent.click(row(container, 'posture').querySelector('summary')!)
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-focus-area', 'posture'))
    props = await lastRunnerProps()
    expect(props.camera).toBe('torsoSide')
    expect(props.focus?.metricIds).toEqual(['trunkLean'])
    expect(screen.queryByText('Slow motion')).toBeNull()

    // A second open moves the camera on; the first row stays open (rows do not close each other).
    fireEvent.click(row(container, 'landing').querySelector('summary')!)
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-camera', 'legsSide'))
    props = await lastRunnerProps()
    expect(props.playbackRate).toBe(0.4)
    expect(props.focus?.metricIds).toContain('overstriding')
    expect(screen.getByText('Slow motion')).toBeInTheDocument()
    expect(row(container, 'posture').open).toBe(true)

    // Closing a row that is not the active one leaves the camera be.
    act(() => {
      row(container, 'posture').open = false
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper(container)).toHaveAttribute('data-camera', 'legsSide')

    // Closing the active row returns to the whole figure, with no focus.
    act(() => {
      row(container, 'landing').open = false
    })
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-camera', 'wholeBodySide'))
    props = await lastRunnerProps()
    expect(props.focus).toBeUndefined()
    expect(props.playbackRate).toBe(1)

    // Opening Not measured moves no camera.
    const notMeasured = container.querySelector<HTMLDetailsElement>('details[data-area="notMeasured"]')
    if (notMeasured) {
      fireEvent.click(notMeasured.querySelector('summary')!)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(wrapper(container)).toHaveAttribute('data-camera', 'wholeBodySide')
    }

    // One runner throughout: only its props changed.
    expect(runner.mounts).toBe(1)
    expect(runner.unmounts).toBe(0)
  })

  it('leaves the camera where it is when a card’s own disclosure opens inside a row', async () => {
    const { container } = renderSummary()
    const landing = row(container, 'landing')
    fireEvent.click(landing.querySelector('summary')!)
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-camera', 'legsSide'))
    // A card's disclosure in ANOTHER, closed row: were its toggle taken for that row's, the camera
    // would move to it.
    const inner = row(container, 'knees').querySelector<HTMLDetailsElement>('details.guided-results__more')!
    act(() => {
      inner.open = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper(container)).toHaveAttribute('data-camera', 'legsSide')
    expect(wrapper(container)).toHaveAttribute('data-focus-area', 'landing')
    // And closing an inner disclosure inside the active row does not read as the row closing.
    const own = landing.querySelector<HTMLDetailsElement>('details.guided-results__more')!
    act(() => {
      own.open = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    act(() => {
      own.open = false
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper(container)).toHaveAttribute('data-camera', 'legsSide')
  })

  it('keeps the whole-body camera on a narrow layout, whatever row opens', async () => {
    setWide(false)
    const { container } = renderSummary()
    fireEvent.click(row(container, 'landing').querySelector('summary')!)
    await waitFor(() => expect(row(container, 'landing').open).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper(container)).toHaveAttribute('data-camera', 'wholeBodySide')
    expect(wrapper(container)).toHaveAttribute('data-focus-area', '')
    const props = await lastRunnerProps()
    expect(props.focus).toBeUndefined()
    expect(props.playbackRate).toBe(1)
    expect(screen.queryByText('Slow motion')).toBeNull()
  })

  it('states the legend only beside a drawn bar', () => {
    const { container } = renderSummary()
    expect(container.querySelector('.metric-scale--compact')).not.toBeNull()
    expect(container.querySelector('.results-summary__legend')).toHaveTextContent(
      /^Bars: where other runners measured\. .*Not a target\.$/,
    )
  })

  it('mounts each evidence canvas once, inside its collapsed row', () => {
    const ids: MetricId[] = ['cadence', 'trunkLean', 'kneeFlexion', 'overstriding', 'armSwingAmplitude']
    const evidence = ids.map((metric) => ({
      metric,
      clipIndex: 0,
      items: [{ plan: framePlan(metric), canvas: document.createElement('canvas') }],
    }))
    const { container } = renderSummary({ evidence })
    expect(container.querySelectorAll('canvas')).toHaveLength(ids.length)
    for (const entry of evidence) {
      const canvas = entry.items[0].canvas
      expect(container.contains(canvas), entry.metric).toBe(true)
      const home = canvas.closest('details.results-summary__row') as HTMLDetailsElement | null
      expect(home, entry.metric).not.toBeNull()
      expect(home!.open, entry.metric).toBe(false)
      expect(canvas.closest('article')).toHaveAttribute('data-metric', entry.metric)
    }
  })

  it('opens the Landing row and focuses the card when the address changes to it', async () => {
    const { container } = renderSummary()
    const landing = row(container, 'landing')
    expect(landing.open).toBe(false)
    act(() => {
      window.history.replaceState(null, '', `#${guidedEntryId('overstriding')}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(landing.open).toBe(true)
    expect(document.activeElement).toBe(container.querySelector(`#${guidedEntryId('overstriding')}`))
    // The open is a toggle like any other, so the camera follows it.
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-camera', 'legsSide'))
  })

  it('opens the row holding the card in the address on mount, without moving focus', () => {
    const toggle = document.body.appendChild(document.createElement('button'))
    toggle.focus()
    window.history.replaceState(null, '', `#${guidedEntryId('kneeFlexion')}`)
    const { container } = renderSummary()
    expect(row(container, 'knees').open).toBe(true)
    expect(row(container, 'landing').open).toBe(false)
    expect(document.activeElement).toBe(toggle)
    toggle.remove()
  })

  it('does not scroll or take focus again when the view remounts with a fragment it already revealed', () => {
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView)
    window.history.replaceState(null, '', `#${guidedEntryId('kneeFlexion')}`)
    const onReplayTour = vi.fn()
    const onOpenClassic = vi.fn()
    const view = (analysis: VideoAnalysisState) => (
      <ResultsSummary
        analysis={analysis}
        onTryAgain={vi.fn()}
        onStartOver={vi.fn()}
        onReplayTour={onReplayTour}
        onOpenClassic={onOpenClassic}
      />
    )
    const { rerender, unmount } = render(view(readyAnalysis()))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')

    // An added clip: the analysis leaves ready and comes back, remounting the body.
    rerender(view({ ...readyAnalysis(), phase: 'processing', heuristics: null }))
    rerender(view(readyAnalysis()))
    // Back from the classic view: a whole new mount, with the hash the switch kept.
    unmount()
    renderSummary()

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
    focus.mockRestore()
  })

  it('ignores a fragment that names nothing in the view', () => {
    const toggle = document.body.appendChild(document.createElement('button'))
    toggle.focus()
    window.history.replaceState(null, '', '#somewhere-else')
    const { container } = renderSummary({
      heuristics: makeHeuristics({ kneeDrive: makeMetric('kneeDrive', { value: null, confidence: 0 }) }),
    })
    for (const details of container.querySelectorAll('details')) {
      expect(details.open, details.getAttribute('data-area') ?? 'card').toBe(false)
    }
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(toggle)
    toggle.remove()
  })
})
