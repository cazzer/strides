import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult } from '../../heuristics/types'
import type { FocusAreaId } from '../../guidance/focusAreas'
import { METRIC_DESCRIPTIONS } from '../metricDescriptions'
import { makeHeuristics, makeMetric } from '../__fixtures__/metricResult'
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

  it('draws a compact bar only for a banded headline', () => {
    for (const area of ['rhythm', 'arms', 'posture', 'knees', 'landing', 'footPath'] as const) {
      const stop = areaStop(area)
      const { container, unmount } = render(<AreaStop stop={stop} />)
      expect(container.querySelector('.runner-tour__scale') !== null, area).toBe(hasCompactBar(stop.entries[0]))
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
