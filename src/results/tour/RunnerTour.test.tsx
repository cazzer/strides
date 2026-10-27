import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult } from '../../heuristics/types'
import type { ModelRunnerProps } from '../../runner/ModelRunner'
import { INTRO_HOLD_MS, INTRO_MAX_STEP_MS, INTRO_TOTAL_MS, __resetIntroRegistryForTests } from '../../runner/useRunnerIntro'
import { makeHeuristics, makeMetric, makeVerticalOscillationCm } from '../__fixtures__/metricResult'
import type { SessionCoverage } from '../sessionCoverage'
import type { ScalePassStatus, VideoAnalysisState } from '../types'
import { hasCompactBar } from '../summary/summaryLabels'
import { RunnerTour } from './RunnerTour'
import { tourPlan } from './tourPlan'

// The real runner draws SVG on a rAF loop; what this file checks is which camera, focus, rate and
// intro the tour hands it, and that it is mounted once for the tour's whole life. It reports itself
// seen on mount, as the real one does when it is on screen.
const runner = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock('../../runner/ModelRunner', async () => {
  const { useEffect } = await import('react')
  return {
    RUNNER_CAPTION: 'Model built from your numbers',
    ModelRunner: vi.fn(function MockModelRunner({ onActiveChange }: ModelRunnerProps) {
      useEffect(() => {
        runner.mounts += 1
        onActiveChange?.(true)
        return () => {
          runner.unmounts += 1
        }
        // Mount and unmount only: the count is the point.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return null
    }),
  }
})

async function lastRunnerProps(): Promise<ModelRunnerProps> {
  const { ModelRunner } = await import('../../runner/ModelRunner')
  const call = vi.mocked(ModelRunner).mock.lastCall
  if (!call) throw new Error('ModelRunner never rendered')
  return call[0]
}

function readyAnalysis(
  heuristics: FormHeuristicsResult = makeHeuristics(),
  scalePass: ScalePassStatus = 'done',
): VideoAnalysisState {
  return {
    phase: 'ready',
    progress: 1,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics,
    diagnostics: null,
    scalePass: { status: scalePass, diagnostics: null },
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
  }
}

let keys = 0
function nextKey(): string {
  keys += 1
  return `session-${keys}#0`
}

interface TourOptions {
  heuristics?: FormHeuristicsResult
  scalePass?: ScalePassStatus
  coverage?: SessionCoverage | null
  resultKey?: string
}

function renderTour(options: TourOptions = {}) {
  const onLeaveTour = vi.fn()
  const props = (overrides: TourOptions = {}) => {
    const merged = { ...options, ...overrides }
    return {
      analysis: readyAnalysis(merged.heuristics, merged.scalePass),
      onTryAgain: vi.fn(),
      onStartOver: vi.fn(),
      onLeaveTour,
      resultKey: merged.resultKey ?? 'fixed-key',
      coverage: merged.coverage ?? null,
    }
  }
  const result = render(<RunnerTour {...props()} />)
  return {
    ...result,
    onLeaveTour,
    rerenderWith: (overrides: TourOptions) => result.rerender(<RunnerTour {...props(overrides)} />),
  }
}

function rail(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.runner-tour__rail')!
}

function stop(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-tour-stop="${id}"]`)
  if (!element) throw new Error(`no ${id} stop`)
  return element
}

/** Skips the intro the way the runner's own Skip intro button does. */
async function skipIntro() {
  const { intro } = await lastRunnerProps()
  act(() => intro?.onSkip())
}

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('reduced-motion') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** Visible words a stop's prose carries (design.md D4): the value line, sr-only text, citations,
 * the phone panel's band-bar key (the bar's legend, as beside the runner at `lg`) and the end block
 * are excluded; the end block is budgeted on its own. */
function proseWords(section: Element): number {
  return words(
    section,
    '.sr-only, .runner-tour__value, .feedback-line__citation, .runner-tour__panel-legend, .runner-tour__end',
  )
}

/**
 * Words over the element's text NODES, joined with spaces: adjacent elements with no whitespace
 * between them (a heading and a paragraph) are separate words to a reader, and `textContent` would
 * run them together.
 */
function words(element: Element, excluded = '.sr-only'): number {
  const clone = element.cloneNode(true) as Element
  clone.querySelectorAll(excluded).forEach((node) => node.remove())
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
  const texts: string[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) texts.push(node.nodeValue ?? '')
  return texts.join(' ').trim().split(/\s+/).filter(Boolean).length
}

const SIDE_ONLY = makeHeuristics({
  stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }),
  stepWidthCm: makeMetric('stepWidthCm', { viewFit: 'unsuitable' }),
  armSwingAmplitude: makeMetric('armSwingAmplitude', { viewFit: 'unsuitable' }),
  swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', { viewFit: 'unsuitable' }),
})
const SIDE_ONLY_COVERAGE: SessionCoverage = {
  present: { side: true, front: false },
  needs: [
    {
      view: 'front',
      metrics: ['stepWidth', 'stepWidthCm', 'armSwingAmplitude', 'swingFootLateralExcursion'],
    },
  ],
}

const originalMatchMedia = window.matchMedia
const originalRect = HTMLElement.prototype.getBoundingClientRect

beforeEach(() => {
  runner.mounts = 0
  runner.unmounts = 0
  __resetIntroRegistryForTests()
  setReducedMotion(false)
  // Every stop below the reading line, so only focus and fragments select one here.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 10_000, bottom: 10_500, left: 0, right: 0, width: 0, height: 500, x: 0, y: 10_000, toJSON: () => ({}) }
  }
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
  HTMLElement.prototype.getBoundingClientRect = originalRect
  window.history.replaceState(null, '', window.location.pathname)
  vi.useRealTimers()
})

describe('RunnerTour — shell', () => {
  it('renders one guided shell and one completion line, the h2 then a sticky Skip', () => {
    const { container, onLeaveTour } = renderTour()

    const root = container.firstElementChild
    expect(root).toHaveClass('runner-tour')
    expect(root?.tagName).toBe('DIV')
    expect(container.querySelectorAll('section[aria-label="Analysis results"]')).toHaveLength(1)
    expect(container.querySelectorAll('.guided-results')).toHaveLength(1)
    expect(screen.getAllByText(/analysis complete/i)).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Analysis complete\./)

    const heading = screen.getByRole('heading', { level: 2, name: 'Your runner model' })
    const skip = screen.getByRole('button', { name: 'Skip to summary' })
    const entries = container.querySelectorAll('[data-view-entry]')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toBe(heading)
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading.compareDocumentPosition(skip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The tour's own controls come before the shell's.
    expect(container.querySelector('button')).toBe(skip)
    // Sticky, so Skip stays in view for the whole tour.
    expect(skip.closest('.runner-tour__header')).toHaveClass('sticky')
    expect(skip).not.toHaveAttribute('data-view-entry')
    fireEvent.click(skip)
    expect(onLeaveTour).toHaveBeenCalledTimes(1)
  })

  it('lays out the phone layout in CSS alone: one runner, each stop’s content in one panel', () => {
    // Below `lg` the runner is a background and each stop a panel over it, all through `max-lg:`
    // classes: nothing renders per breakpoint, so a resize never remounts the runner (and never
    // resets the reader's Pause).
    const { container } = renderTour()
    expect(runner.mounts).toBe(1)
    for (const section of container.querySelectorAll<HTMLElement>('[data-tour-stop]')) {
      const panels = section.querySelectorAll(':scope > .runner-tour__panel')
      expect(panels, section.dataset.tourStop).toHaveLength(1)
      expect(section.children).toHaveLength(1)
      // The heading that labels the section is in its panel, first.
      expect(panels[0].firstElementChild?.id).toBe(section.getAttribute('aria-labelledby'))
      // The phone key to a band bar sits in the panel exactly when the panel has a bar.
      const bar = panels[0].querySelector('.metric-scale--compact') !== null
      expect(panels[0].querySelectorAll('.runner-tour__panel-legend'), section.dataset.tourStop).toHaveLength(
        bar ? 1 : 0,
      )
    }
    expect(container.querySelectorAll('.runner-tour__panel-legend').length).toBeGreaterThan(0)
    // Every stop is labelled by its heading still, through the panel.
    expect(screen.getByRole('region', { name: 'Landing' })).toHaveAttribute('data-tour-stop', 'landing')
  })

  it('ends with "See all measurements", which leaves the tour', () => {
    const { onLeaveTour } = renderTour()
    fireEvent.click(screen.getByRole('button', { name: 'See all measurements' }))
    expect(onLeaveTour).toHaveBeenCalledTimes(1)
  })

  it('mounts no metric card, no disclosure and no evidence', () => {
    const { container } = renderTour()
    expect(container.querySelector('.guided-results__group')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('.evidence-image')).toBeNull()
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('renders no body (and no runner) until there is a result', () => {
    const { container } = render(
      <RunnerTour
        analysis={{ ...readyAnalysis(), phase: 'processing', heuristics: null }}
        onTryAgain={vi.fn()}
        onStartOver={vi.fn()}
        onLeaveTour={vi.fn()}
        resultKey="k"
        coverage={null}
      />,
    )
    expect(container.querySelector('[data-tour-stop]')).toBeNull()
    expect(runner.mounts).toBe(0)
  })

  it('has one stop per measured area in order, then the one-thing stop; never more than seven', () => {
    const { container } = renderTour()
    const ids = [...container.querySelectorAll<HTMLElement>('[data-tour-stop]')].map(
      (element) => element.dataset.tourStop,
    )
    expect(ids).toEqual(['rhythm', 'arms', 'posture', 'knees', 'landing', 'footPath', 'oneThing'])
    for (const id of ids) {
      const section = stop(container, id!)
      expect(section.id).toBe(`tour-${id}`)
      expect(section).toHaveAttribute('tabindex', '-1')
      expect(section).toHaveAccessibleName()
    }
  })

  it('skips unmeasured areas and lists them at the end with one capture hint', () => {
    const { container } = renderTour({ heuristics: SIDE_ONLY, coverage: SIDE_ONLY_COVERAGE })
    const ids = [...container.querySelectorAll<HTMLElement>('[data-tour-stop]')].map(
      (element) => element.dataset.tourStop,
    )
    expect(ids).toEqual(['rhythm', 'posture', 'knees', 'landing', 'oneThing'])
    expect(container.querySelector('.runner-tour__end')).toHaveTextContent(
      'Not measured: Arms and Foot path. Add a front-view clip.',
    )
  })

  it('offers the session’s add-a-clip action as the end’s capture hint', () => {
    const onAddClip = vi.fn()
    render(
      <RunnerTour
        analysis={readyAnalysis(SIDE_ONLY)}
        onTryAgain={vi.fn()}
        onStartOver={vi.fn()}
        onLeaveTour={vi.fn()}
        resultKey="k"
        coverage={SIDE_ONLY_COVERAGE}
        onAddClip={onAddClip}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add a front-view clip' }))
    expect(onAddClip).toHaveBeenCalledTimes(1)
  })

  it('shows where the reader is: one dot link per stop, the active one current', async () => {
    const { container } = renderTour({ resultKey: nextKey() })
    await skipIntro()
    const nav = screen.getByRole('navigation', { name: 'Tour stops' })
    // In the sticky bar, before Skip.
    expect(nav.closest('.runner-tour__header')).not.toBeNull()
    const links = [...nav.querySelectorAll('a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#tour-rhythm',
      '#tour-arms',
      '#tour-posture',
      '#tour-knees',
      '#tour-landing',
      '#tour-footPath',
      '#tour-oneThing',
    ])
    expect(links[3]).toHaveAccessibleName('Stop 4 of 7: Knees')
    expect(links[6]).toHaveAccessibleName('Stop 7 of 7: One thing to try')
    expect(nav.querySelector('[aria-current]')).toBeNull()
    act(() => stop(container, 'knees').focus())
    expect(links[3]).toHaveAttribute('aria-current', 'step')
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
})

describe('RunnerTour — the runner follows the active stop', () => {
  it('points the camera at a stop focused from the keyboard, slowed where it says so, on one runner', async () => {
    const { container } = renderTour({ resultKey: nextKey() })
    await skipIntro()
    expect(rail(container)).toHaveAttribute('data-camera', 'wholeBodySide')

    const citation = stop(container, 'landing').querySelector('a')!
    act(() => citation.focus())
    expect(rail(container)).toHaveAttribute('data-camera', 'legsSide')
    expect(rail(container)).toHaveAttribute('data-active-stop', 'landing')
    expect(container.querySelector('.runner-tour__slow-motion')).toHaveTextContent('Slow motion')
    const props = await lastRunnerProps()
    expect(props.camera).toBe('legsSide')
    expect(props.playbackRate).toBe(0.4)
    // The headline metric only: the stop states its value, and the figure labels nothing else.
    expect(props.focus?.metricIds).toEqual(['overstriding'])

    act(() => stop(container, 'posture').focus())
    expect(rail(container)).toHaveAttribute('data-camera', 'torsoSide')
    expect(container.querySelector('.runner-tour__slow-motion')).toBeNull()

    act(() => stop(container, 'oneThing').focus())
    expect(rail(container)).toHaveAttribute('data-camera', 'wholeBodySide')
    // One runner for the whole tour, never remounted by a stop.
    expect(runner.mounts).toBe(1)
    expect(runner.unmounts).toBe(0)
  })

  it('focuses the rhythm stop on cadence alone, and shows the legend only for a banded headline', async () => {
    const { container } = renderTour({ resultKey: nextKey() })
    await skipIntro()
    expect(container.querySelector('.runner-tour__legend')).toBeNull()
    act(() => stop(container, 'rhythm').focus())
    expect((await lastRunnerProps()).focus?.metricIds).toEqual(['cadence'])
    const plan = tourPlan(makeHeuristics(), 'done', null)
    for (const area of plan.areaStops) {
      act(() => stop(container, area.view.area).focus())
      expect(container.querySelector('.runner-tour__legend') !== null, area.view.area).toBe(
        hasCompactBar(area.entries[0]),
      )
    }
    act(() => stop(container, 'oneThing').focus())
    expect(container.querySelector('.runner-tour__legend')).toBeNull()
  })

  it('introduces a front-only session from the front, on the camera the runner gets', async () => {
    vi.useFakeTimers()
    renderTour({
      resultKey: nextKey(),
      coverage: { present: { side: false, front: true }, needs: [] },
    })
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS + 100))
    const props = await lastRunnerProps()
    expect(props.intro?.running).toBe(true)
    expect(props.camera).toBe('feetFront')
  })

  it('holds the intro until 90% of the runner figure is on screen', async () => {
    vi.useFakeTimers()
    const observers: Array<{ callback: IntersectionObserverCallback; target: Element | null }> = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        record: { callback: IntersectionObserverCallback; target: Element | null }
        constructor(callback: IntersectionObserverCallback) {
          this.record = { callback, target: null }
          observers.push(this.record)
        }
        observe(target: Element) {
          this.record.target = target
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return []
        }
      },
    )
    const report = (ratio: number) =>
      act(() => {
        for (const { callback, target } of observers) {
          callback(
            [
              {
                intersectionRatio: ratio,
                intersectionRect: { height: 100 * ratio },
                rootBounds: { height: 800 },
                target,
              } as unknown as IntersectionObserverEntry,
            ],
            {} as IntersectionObserver,
          )
        }
      })
    const { container } = renderTour({ resultKey: nextKey() })
    // The mocked runner draws no figure, so the rail itself stands in for it here.
    expect(observers.some(({ target }) => target === rail(container))).toBe(true)
    report(0.5)
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS * 4))
    // Still the neutral hold: no step has begun.
    expect((await lastRunnerProps()).overrides?.valueTween ?? null).toBeNull()
    report(0.95)
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS + 10))
    expect((await lastRunnerProps()).overrides?.valueTween).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('selects a stop from its #tour-<id> fragment', async () => {
    const { container } = renderTour({ resultKey: nextKey() })
    await skipIntro()
    act(() => {
      window.history.pushState(null, '', '#tour-knees')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(rail(container)).toHaveAttribute('data-camera', 'legsSide')
    expect(document.activeElement).toBe(stop(container, 'knees'))
  })

  it('keeps the whole figure while the intro runs, and reading past the first stop ends it', async () => {
    vi.useFakeTimers()
    const { container } = renderTour({ resultKey: nextKey() })
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS + 100))
    let props = await lastRunnerProps()
    expect(props.intro?.running).toBe(true)
    expect(props.overrides).toBeDefined()
    expect(props.camera).toBe('wholeBodySide')

    // The first stop does not interrupt the intro.
    act(() => stop(container, 'rhythm').focus())
    expect(rail(container)).toHaveAttribute('data-active-stop', '')
    expect((await lastRunnerProps()).intro?.running).toBe(true)

    act(() => stop(container, 'knees').focus())
    props = await lastRunnerProps()
    expect(props.intro?.running).toBe(false)
    expect(props.overrides).toBeUndefined()
    expect(props.camera).toBe('legsSide')
  })

  it('ends the intro on its own after about five seconds', async () => {
    vi.useFakeTimers()
    renderTour({ resultKey: nextKey() })
    expect((await lastRunnerProps()).intro?.running).toBe(true)
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS + INTRO_TOTAL_MS + 2 * INTRO_MAX_STEP_MS))
    expect((await lastRunnerProps()).intro?.running).toBe(false)
  })

  it('plays the intro once per result key, and again for a new one (Replay tour)', async () => {
    vi.useFakeTimers()
    const first = nextKey()
    const { rerenderWith } = renderTour({ resultKey: first })
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS + INTRO_TOTAL_MS + 2 * INTRO_MAX_STEP_MS))
    expect((await lastRunnerProps()).intro?.running).toBe(false)

    // A new render of the same result (the scale-pass graft) does not replay it.
    rerenderWith({ resultKey: first, heuristics: makeHeuristics() })
    expect((await lastRunnerProps()).intro?.running).toBe(false)

    rerenderWith({ resultKey: nextKey() })
    expect((await lastRunnerProps()).intro?.running).toBe(true)
  })

  it('under reduced motion: no intro and no slow-motion label', async () => {
    setReducedMotion(true)
    const { container } = renderTour({ resultKey: nextKey() })
    await act(async () => {})
    expect((await lastRunnerProps()).intro?.running).toBe(false)
    act(() => stop(container, 'landing').focus())
    expect(rail(container)).toHaveAttribute('data-camera', 'legsSide')
    expect(container.querySelector('.runner-tour__slow-motion')).toBeNull()
  })
})

describe('RunnerTour — word budget', () => {
  const cases: Array<[string, TourOptions]> = [
    ['default', {}],
    ['cadence 150', { heuristics: makeHeuristics({ cadence: makeMetric('cadence', { value: 150 }) }) }],
    [
      'cadence 175, bounce 10.4 cm',
      {
        heuristics: makeHeuristics({
          cadence: makeMetric('cadence', { value: 175 }),
          verticalOscillationCm: makeVerticalOscillationCm({ value: 10.4 }),
        }),
      },
    ],
    ['side only', { heuristics: SIDE_ONLY, coverage: SIDE_ONLY_COVERAGE }],
    [
      'scale pass running',
      {
        scalePass: 'running',
        heuristics: makeHeuristics({
          verticalOscillationCm: makeVerticalOscillationCm({ value: null }),
          stepWidthCm: makeMetric('stepWidthCm', { value: null }),
        }),
      },
    ],
    ['caveated', { heuristics: makeHeuristics({}, { confidence: 0.5 }) }],
  ]

  it.each(cases)('%s: every stop ≤ 25 words, the end block ≤ 25 on its own', (_, options) => {
    const { container } = renderTour(options)
    const stops = container.querySelectorAll('[data-tour-stop]')
    expect(stops.length).toBeGreaterThan(0)
    expect(stops.length).toBeLessThanOrEqual(7)
    for (const section of stops) {
      expect(proseWords(section), (section as HTMLElement).dataset.tourStop).toBeLessThanOrEqual(25)
    }
    expect(words(container.querySelector('.runner-tour__end')!)).toBeLessThanOrEqual(25)
  })

  it('a cadence of 150 carries the cue in Rhythm and as the one thing', () => {
    const { container } = renderTour({
      heuristics: makeHeuristics({ cadence: makeMetric('cadence', { value: 150 }) }),
    })
    expect(stop(container, 'rhythm').querySelector('.runner-tour__cue')).not.toBeNull()
    expect(stop(container, 'oneThing').querySelector('.runner-tour__cue')).not.toBeNull()
  })

  it('says it cannot say yet while the scale pass is still measuring bounce', () => {
    const { container } = renderTour({
      scalePass: 'running',
      heuristics: makeHeuristics({
        verticalOscillationCm: makeVerticalOscillationCm({ value: null }),
      }),
    })
    expect(stop(container, 'oneThing')).toHaveTextContent(
      "Can't say yet: bounce in centimetres is still being measured.",
    )
  })
})
