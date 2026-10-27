import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult, MetricId, View } from '../../heuristics/types'
import type { ModelRunnerProps } from '../../runner/ModelRunner'
import { INTRO_HOLD_MS, INTRO_MAX_STEP_MS, INTRO_TOTAL_MS, __resetIntroRegistryForTests } from '../../runner/useRunnerIntro'
import { makeHeuristics, makeMetric, makeVerticalOscillationCm } from '../__fixtures__/metricResult'
import type { MetricCardEvidence } from '../MetricsPanel'
import { METRIC_LABELS } from '../metricConfidence'
import type { SessionCoverage } from '../sessionCoverage'
import type { ScalePassStatus, VideoAnalysisState } from '../types'
import { readingHeadline } from '../../guidance/compositeReadings'
import { hasCompactBar } from '../summary/summaryLabels'
import { RunnerTour } from './RunnerTour'
import { tourPlan } from './tourPlan'
import { SHORT_PHONE_QUERY } from './useShortPhoneLayout'
import type { ExtractedEvidenceFrame } from '../../video/extractFrames'

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
  evidence?: MetricCardEvidence[]
  sourceIndices?: Record<MetricId, number> | null
  clipViewKinds?: (View | null)[]
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
      evidence: merged.evidence,
      sourceIndices: merged.sourceIndices,
      clipViewKinds: merged.clipViewKinds,
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

/** A matchMedia whose short-phone query matches as `set` says; `set` fires its change listeners. */
function stubShortPhone(initial: boolean): { set: (matches: boolean) => void } {
  const state = { matches: initial }
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === SHORT_PHONE_QUERY ? state.matches : false
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  return {
    set: (matches) => {
      state.matches = matches
      act(() => listeners.forEach((listener) => listener()))
    },
  }
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

  it('on a short phone, puts the dots and Skip in one row with the runner’s controls, without remounting it', async () => {
    const phone = stubShortPhone(true)
    const { container, onLeaveTour } = renderTour()

    const heading = screen.getByRole('heading', { level: 2, name: 'Your runner model' })
    const skip = screen.getByRole('button', { name: 'Skip to summary' })
    // The bar keeps only the heading, which stays the tour's entry point and comes first.
    expect(heading.parentElement?.children).toHaveLength(1)
    expect(heading.compareDocumentPosition(skip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The row is a sticky cell of the body's grid.
    const row = skip.closest('.runner-tour__header')!
    expect(row).toHaveClass('sticky')
    expect(row.parentElement).toHaveClass('runner-tour__body')
    expect(row.querySelector('nav[aria-label="Tour stops"]')).not.toBeNull()
    // Visibly "Summary"; the name is unchanged.
    expect(skip.querySelector('.sr-only')).toHaveTextContent('Skip to')
    // The runner is told to lay its controls over the row.
    expect((await lastRunnerProps()).className).toContain('[data-runner-part=controls]]:w-fit')
    fireEvent.click(skip)
    expect(onLeaveTour).toHaveBeenCalledTimes(1)

    // Turning the phone (no longer short): back in the bar, and the runner is never remounted.
    phone.set(false)
    expect(screen.getByRole('button', { name: 'Skip to summary' }).closest('.runner-tour__header')).toBe(
      heading.parentElement,
    )
    expect(container.querySelector('.runner-tour__body .runner-tour__header')).toBeNull()
    expect((await lastRunnerProps()).className).not.toContain('[data-runner-part=controls]]:w-fit')
    expect(runner.mounts).toBe(1)
  })

  it('on a short phone, orders the shared row as it reads: the runner’s controls, the dots, Skip, then the stops', () => {
    stubShortPhone(true)
    const { container } = renderTour()
    const row = screen.getByRole('button', { name: 'Skip to summary' }).closest('.runner-tour__header')!
    // The runner's controls (Skip intro, Pause) are drawn over the row's start from inside the
    // rail: the rail comes first in the DOM, so Tab reaches them first.
    expect(rail(container).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const stops = container.querySelector('.runner-tour__stops')!
    expect(row.compareDocumentPosition(stops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const order = [...row.querySelectorAll('a, button')].map((el) => el.getAttribute('data-tour-action'))
    expect(order.at(-1)).toBe('skip')
    expect(order.slice(0, -1).length).toBeGreaterThan(0)
    expect(order.slice(0, -1).every((key) => key?.startsWith('dot:'))).toBe(true)
  })

  it('keeps focus on the same dot or Skip when they move between the bar and a short phone’s row', () => {
    const phone = stubShortPhone(false)
    renderTour()
    act(() => screen.getByRole('button', { name: 'Skip to summary' }).focus())
    phone.set(true)
    const inRow = screen.getByRole('button', { name: 'Skip to summary' })
    expect(inRow.closest('.runner-tour__body')).not.toBeNull()
    expect(document.activeElement).toBe(inRow)

    act(() => screen.getByRole('link', { name: /^Stop 3 of 7/ }).focus())
    phone.set(false)
    const dot = screen.getByRole('link', { name: /^Stop 3 of 7/ })
    expect(dot.closest('.runner-tour__body')).toBeNull()
    expect(document.activeElement).toBe(dot)

    // Focus the reader took away is left alone.
    act(() => dot.blur())
    phone.set(true)
    expect(document.activeElement).toBe(document.body)
  })

  it('ends with "See all measurements", which leaves the tour', () => {
    const { onLeaveTour } = renderTour()
    fireEvent.click(screen.getByRole('button', { name: 'See all measurements' }))
    expect(onLeaveTour).toHaveBeenCalledTimes(1)
  })

  it('mounts no metric card, no disclosure and no evidence', () => {
    const { container } = renderTour()
    expect(container.querySelector('[data-motion-metric]')).toBeNull()
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
    expect(rail(container)).toHaveAttribute('data-camera', 'landingSide')
    expect(rail(container)).toHaveAttribute('data-active-stop', 'landing')
    expect(container.querySelector('.runner-tour__slow-motion')).toHaveTextContent('Slow motion')
    const props = await lastRunnerProps()
    expect(props.camera).toBe('landingSide')
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
        hasCompactBar(readingHeadline(area.readings[0])),
      )
    }
    act(() => stop(container, 'oneThing').focus())
    expect(container.querySelector('.runner-tour__legend')).toBeNull()
  })

  it('focuses a cadence-less rhythm stop on vertical ratio, which labels nothing on the figure', async () => {
    const { container } = renderTour({
      resultKey: nextKey(),
      heuristics: makeHeuristics({ cadence: makeMetric('cadence', { value: null, confidence: 0 }) }),
    })
    await skipIntro()
    act(() => stop(container, 'rhythm').focus())
    // Vertical ratio, the stop's headline, drives no runner parameter: no bounce label is drawn.
    expect((await lastRunnerProps()).focus?.metricIds).toEqual([])
    expect(container.querySelector('.runner-tour__legend')).not.toBeNull()
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
                intersectionRect: { height: 200 * ratio },
                // Tall enough for the gate's height floor (`MOSTLY_VISIBLE_MIN_HEIGHT`).
                boundingClientRect: { height: 200 },
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
    expect(rail(container)).toHaveAttribute('data-camera', 'landingSide')
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
    ['cadence excluded', { heuristics: makeHeuristics({ cadence: makeMetric('cadence', { value: null, confidence: 0 }) }) }],
    [
      'vertical ratio excluded',
      { heuristics: makeHeuristics({ verticalRatio: makeMetric('verticalRatio', { value: null, confidence: 0 }) }) },
    ],
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
    // A From line is excluded with its value block, and capped on its own.
    for (const line of container.querySelectorAll('.runner-tour__derivation')) {
      expect(words(line), line.textContent ?? '').toBeLessThanOrEqual(14)
    }
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

describe('RunnerTour — the footage plate', () => {
  /** A knee-flexion evidence image from clip 0 with a hip, knee and ankle at its base moment. */
  function kneeEvidence(): MetricCardEvidence {
    const at = (name: 'left_hip' | 'left_knee' | 'left_ankle', x: number, y: number) =>
      ({ name, status: 'detected', x, y }) as const
    const item = {
      plan: {
        metric: 'kneeFlexion',
        base: {
          timestamp: 1,
          opacity: 1,
          keypoints: [at('left_hip', 300, 300), at('left_knee', 320, 400), at('left_ankle', 280, 500)],
          outwardSign: null,
          side: 'left',
        },
        ghost: null,
        crop: { x: 100, y: 200, side: 400 },
        travelDirection: 1,
      },
      canvas: document.createElement('canvas'),
    } as unknown as ExtractedEvidenceFrame
    return { metric: 'kneeFlexion', clipIndex: 0, items: [item] }
  }
  const SOURCES = Object.fromEntries(Object.keys(METRIC_LABELS).map((metric) => [metric, 0])) as Record<MetricId, number>

  it('hands the runner the knees stop’s headline image from a side clip, and none elsewhere', async () => {
    setReducedMotion(true)
    const evidence = [kneeEvidence()]
    const { container } = renderTour({ resultKey: nextKey(), evidence, sourceIndices: SOURCES, clipViewKinds: ['side'] })
    await act(async () => {})
    act(() => stop(container, 'knees').focus())
    const footage = (await lastRunnerProps()).footage
    expect(footage?.metric).toBe('kneeFlexion')
    expect(footage?.image).toBe(evidence[0].items[0].canvas)
    act(() => stop(container, 'posture').focus())
    expect((await lastRunnerProps()).footage).toBeNull()
  })

  it('hands none from a front clip', async () => {
    setReducedMotion(true)
    const { container } = renderTour({
      resultKey: nextKey(),
      evidence: [kneeEvidence()],
      sourceIndices: SOURCES,
      clipViewKinds: ['front'],
    })
    await act(async () => {})
    act(() => stop(container, 'knees').focus())
    expect((await lastRunnerProps()).footage).toBeNull()
  })

  it('hands none while the intro runs', async () => {
    vi.useFakeTimers()
    renderTour({ resultKey: nextKey(), evidence: [kneeEvidence()], sourceIndices: SOURCES, clipViewKinds: ['side'] })
    act(() => vi.advanceTimersByTime(INTRO_HOLD_MS + 100))
    const props = await lastRunnerProps()
    expect(props.intro?.running).toBe(true)
    expect(props.footage).toBeNull()
  })
})
