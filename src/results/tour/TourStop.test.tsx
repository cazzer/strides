import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult } from '../../heuristics/types'
import type { FocusAreaId } from '../../guidance/focusAreas'
import { METRIC_DESCRIPTIONS } from '../metricDescriptions'
import { makeHeuristics, makeMetric } from '../__fixtures__/metricResult'
import { readingHeadline } from '../../guidance/compositeReadings'
import { hasCompactBar } from '../summary/summaryLabels'
import { tourPlan } from './tourPlan'
import { AreaStop, OneThingStop } from './TourStop'

function areaStop(area: FocusAreaId, heuristics: FormHeuristicsResult = makeHeuristics()) {
  const stop = tourPlan(heuristics, 'done', null).areaStops.find((candidate) => candidate.view.area === area)
  if (!stop) throw new Error(`${area} is not measured`)
  return stop
}

describe('AreaStop', () => {
  it('names the area in a heading that labels the section, and the headline metric and value', () => {
    const { container } = render(<AreaStop stop={areaStop('rhythm')} />)
    const section = container.querySelector('section')!
    expect(section).toHaveAccessibleName('Rhythm')
    expect(screen.getByRole('heading', { level: 3, name: 'Rhythm' })).toBeInTheDocument()
    const value = container.querySelector('.runner-tour__value')!
    expect(value.firstElementChild).toHaveTextContent(/^Cadence$/)
    expect(value.children[1]).toHaveTextContent(/^\d+ steps\/min/)
    expect(value.children[1]).toHaveClass('text-4xl')
  })

  it('adds the bounce reading after cadence as a secondary value with its From line and no bar', () => {
    const { container } = render(<AreaStop stop={areaStop('rhythm')} />)
    const [headline, secondary] = container.querySelectorAll('.runner-tour__value')
    expect(headline.firstElementChild).toHaveTextContent(/^Cadence$/)
    expect(headline.querySelector('.runner-tour__derivation')).toBeNull()
    expect(secondary).toHaveClass('runner-tour__value--secondary')
    expect(secondary).toHaveAttribute('data-composite', 'bounce')
    expect(secondary.children[0]).toHaveTextContent(/^Vertical ratio$/)
    expect(secondary.children[1]).toHaveTextContent(/^4\.00%/)
    expect(secondary.children[1]).toHaveClass('text-2xl')
    // Its band position is for assistive technology only, as the headline's is.
    expect(secondary.children[1].querySelector('.sr-only')).not.toBeNull()
    expect(secondary.querySelector('.runner-tour__derivation')).toHaveTextContent(
      'From bounce 7.5 cm and stride 3.8 torso lengths (7 strides)',
    )
    expect(container.querySelectorAll('.runner-tour__scale')).toHaveLength(1)
    // After the headline's bar, before the prose.
    expect(container.querySelector('.runner-tour__scale')!.compareDocumentPosition(secondary)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('makes vertical ratio the headline, bar and From line included, when cadence is excluded', () => {
    const heuristics = makeHeuristics({ cadence: makeMetric('cadence', { value: null, confidence: 0 }) })
    const { container } = render(<AreaStop stop={areaStop('rhythm', heuristics)} />)
    const values = container.querySelectorAll('.runner-tour__value')
    expect(values).toHaveLength(1)
    expect(values[0].firstElementChild).toHaveTextContent(/^Vertical ratio$/)
    expect(values[0]).toHaveAttribute('data-composite', 'bounce')
    expect(values[0].querySelector('.runner-tour__derivation')).toHaveTextContent(/^From bounce 7\.5 cm/)
    expect(container.querySelector('.runner-tour__scale')).not.toBeNull()
  })

  it('cites nothing for a fallback bounce headline (vertical ratio excluded)', () => {
    const heuristics = makeHeuristics({ verticalRatio: makeMetric('verticalRatio', { value: null, confidence: 0 }) })
    const { container } = render(<AreaStop stop={areaStop('rhythm', heuristics)} />)
    const secondary = container.querySelector('.runner-tour__value--secondary')!
    expect(secondary.firstElementChild).toHaveTextContent(/^Bounce$/)
    expect(secondary.children[1]).toHaveTextContent(/^7\.5 cm/)
    expect(container.querySelector('.runner-tour__derivation')).toBeNull()
  })

  it('draws a compact bar only for a banded headline', () => {
    for (const area of ['rhythm', 'arms', 'posture', 'knees', 'landing', 'footPath'] as const) {
      const stop = areaStop(area)
      const { container, unmount } = render(<AreaStop stop={stop} />)
      expect(container.querySelector('.runner-tour__scale') !== null, area).toBe(
        hasCompactBar(readingHeadline(stop.readings[0])),
      )
      // One bar per stop, never a second for a secondary reading.
      expect(container.querySelectorAll('.runner-tour__scale').length, area).toBeLessThanOrEqual(1)
      unmount()
    }
  })

  it('shows the cue or the non-point, never both', () => {
    for (const heuristics of [
      makeHeuristics(),
      makeHeuristics({ cadence: makeMetric('cadence', { value: 150 }) }),
    ]) {
      for (const area of ['rhythm', 'landing', 'footPath'] as const) {
        const { container, unmount } = render(<AreaStop stop={areaStop(area, heuristics)} />)
        const cue = container.querySelector('.runner-tour__cue')
        const nonPoint = container.querySelector('.runner-tour__non-point')
        expect(cue !== null && nonPoint !== null, area).toBe(false)
        unmount()
      }
    }
    const { container } = render(
      <AreaStop stop={areaStop('rhythm', makeHeuristics({ cadence: makeMetric('cadence', { value: 150 }) }))} />,
    )
    expect(container.querySelector('.runner-tour__cue')).toHaveTextContent(/^One studied option:/)
  })

  it('says how strong each cited line is, beside its source', () => {
    const { container } = render(<AreaStop stop={areaStop('landing')} />)
    const citations = [...container.querySelectorAll('.feedback-line__citation')].map((el) => el.textContent)
    expect(citations).toEqual([
      expect.stringContaining('Linked, not tested'),
      expect.stringContaining('Reviewed across studies'),
    ])
    expect(container.querySelectorAll('.feedback-line__citation a')).toHaveLength(2)
  })

  it('names a lower confidence in the value line', () => {
    const { container } = render(<AreaStop stop={areaStop('posture', makeHeuristics({}, { confidence: 0.5 }))} />)
    expect(container.querySelector('.runner-tour__value')).toHaveTextContent('Medium confidence')
  })

  it('carries no disclosure and no description', () => {
    const { container } = render(<AreaStop stop={areaStop('knees')} />)
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).not.toContain(METRIC_DESCRIPTIONS.kneeFlexion)
  })
})

describe('a panel that scrolls inside itself (a short phone’s cap)', () => {
  it('is a focusable group named by the stop’s heading, with a visible focus ring, only while it overflows', () => {
    const resizes: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizes.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const size = { scroll: 300, client: 96 }
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => size.scroll)
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => size.client)
    try {
      const { container } = render(<AreaStop stop={areaStop('rhythm')} />)
      const panel = container.querySelector<HTMLElement>('.runner-tour__panel')!
      expect(panel).toHaveAttribute('tabindex', '0')
      expect(screen.getByRole('group', { name: 'Rhythm' })).toBe(panel)
      expect(panel).toHaveClass('focus-visible:outline')

      // It grows to fit (a taller screen): an ordinary panel again, out of the tab order.
      size.client = 300
      act(() => resizes.forEach((callback) => callback([], {} as ResizeObserver)))
      expect(panel).not.toHaveAttribute('tabindex')
      expect(panel).not.toHaveAttribute('role')
      expect(screen.queryByRole('group')).toBeNull()
    } finally {
      scrollHeight.mockRestore()
      clientHeight.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

describe('OneThingStop', () => {
  it('says the cue, nothing to change, or why it cannot say', () => {
    const { rerender, container } = render(
      <OneThingStop oneThing={{ kind: 'nothingToChange' }} unmeasured={[]} captureHint={null} onSeeAll={vi.fn()} />,
    )
    expect(container).toHaveTextContent('No studied change to try for these readings.')
    rerender(
      <OneThingStop
        oneThing={{ kind: 'unclear', reason: 'caveated' }}
        unmeasured={[]}
        captureHint={null}
        onSeeAll={vi.fn()}
      />,
    )
    expect(container).toHaveTextContent("Can't say: a reading that could matter was measured with lower confidence.")
    const plan = tourPlan(makeHeuristics({ cadence: makeMetric('cadence', { value: 150 }) }), 'done', null)
    rerender(<OneThingStop oneThing={plan.oneThing} unmeasured={[]} captureHint={null} onSeeAll={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 3, name: 'One thing to try' })).toBeInTheDocument()
    expect(container.querySelector('.runner-tour__cue')).toHaveTextContent(/^One studied option:/)
    expect(container.querySelector('.runner-tour__cue a')).toHaveAttribute('href', expect.stringMatching(/^https:/))
  })

  it('ends by listing what was skipped, the add-a-clip control, and See all measurements', () => {
    const onSeeAll = vi.fn()
    const onAddClip = vi.fn()
    const { container } = render(
      <OneThingStop
        oneThing={{ kind: 'nothingToChange' }}
        unmeasured={['arms', 'footPath']}
        captureHint={{ text: 'Add a front-view clip', addsClip: true }}
        onSeeAll={onSeeAll}
        onAddClip={onAddClip}
      />,
    )
    const end = container.querySelector('.runner-tour__end')!
    expect(end.querySelector('p')).toHaveTextContent(/^Not measured: Arms and Foot path\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'Add a front-view clip' }))
    expect(onAddClip).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'See all measurements' }))
    expect(onSeeAll).toHaveBeenCalledTimes(1)
  })

  it('says a hint as text where it adds no clip, or no add-a-clip action is offered', () => {
    const { container, rerender } = render(
      <OneThingStop
        oneThing={{ kind: 'nothingToChange' }}
        unmeasured={['knees']}
        captureHint={{ text: 'Film several seconds of steady running, whole body in frame.', addsClip: false }}
        onSeeAll={vi.fn()}
        onAddClip={vi.fn()}
      />,
    )
    expect(container.querySelector('.runner-tour__end')).toHaveTextContent(
      'Not measured: Knees. Film several seconds of steady running, whole body in frame.',
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    rerender(
      <OneThingStop
        oneThing={{ kind: 'nothingToChange' }}
        unmeasured={['arms']}
        captureHint={{ text: 'Add a front-view clip', addsClip: true }}
        onSeeAll={vi.fn()}
      />,
    )
    expect(container.querySelector('.runner-tour__end')).toHaveTextContent(
      'Not measured: Arms. Add a front-view clip.',
    )
    expect(screen.queryByRole('button', { name: 'Add a front-view clip' })).toBeNull()
  })

  it('lists nothing when every area was measured', () => {
    const { container } = render(
      <OneThingStop oneThing={{ kind: 'nothingToChange' }} unmeasured={[]} captureHint={null} onSeeAll={vi.fn()} />,
    )
    expect(container.querySelector('.runner-tour__end')).not.toHaveTextContent(/Not measured/)
  })
})
