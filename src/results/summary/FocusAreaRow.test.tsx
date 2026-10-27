import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FormHeuristicsResult, MetricId } from '../../heuristics/types'
import { feedbackFor, CUE_PREFIX } from '../../guidance/feedbackPoints'
import type { FocusAreaId } from '../../guidance/focusAreas'
import { makeHeuristics, makeMetric } from '../__fixtures__/metricResult'
import { guidedHeadlineParts } from '../formatGuidedValue'
import { METRIC_LABELS } from '../metricConfidence'
import type { MetricCardEvidence } from '../MetricsPanel'
import { FEEDBACK_SOURCE_TITLES } from '../feedbackSources'
import { FocusAreaRow, NotMeasuredRow } from './FocusAreaRow'
import { summaryRows } from './summaryRows'

function renderRow(
  area: FocusAreaId,
  heuristics: FormHeuristicsResult = makeHeuristics(),
  evidence: readonly MetricCardEvidence[] = [],
) {
  const row = summaryRows(heuristics).areas.find(({ view }) => view.area === area)
  if (!row) throw new Error(`${area} has no row`)
  const onToggle = vi.fn()
  const result = render(
    <FocusAreaRow
      area={area}
      label={row.view.label}
      readings={row.readings}
      bounce={row.bounce}
      feedback={feedbackFor(row.view)}
      evidenceByMetric={new Map(evidence.map((entry) => [entry.metric, entry]))}
      clipCount={1}
      sourceLabelFor={() => undefined}
      onToggle={onToggle}
    />,
  )
  const details = result.container.querySelector('details')!
  const summary = details.querySelector('summary')!
  return { ...result, row, details, summary, onToggle }
}

describe('FocusAreaRow', () => {
  it('is collapsed by default, with its cards already in the document', () => {
    const { details, row } = renderRow('rhythm')
    expect(details.open).toBe(false)
    expect(details).toHaveAttribute('data-area', 'rhythm')
    expect(details).not.toHaveAttribute('name')
    for (const entry of row.entries) {
      expect(details.querySelector(`article[data-metric="${entry.metric.metric}"]`)).not.toBeNull()
    }
  })

  it('names the area, its headline value and where the value sits, in the summary', () => {
    const { summary, row } = renderRow('rhythm')
    // Standalone: the row names its range, since the compact bar prints no numbers.
    const parts = guidedHeadlineParts(row.entries[0], { standalone: true })
    expect(parts.position).not.toBeNull()
    expect(parts.position).not.toMatch(/range shown/)
    expect(summary.textContent).toContain('Rhythm')
    // The headline metric is named before its value.
    expect(summary.querySelector('.results-summary__row-headline')!.textContent).toMatch(
      new RegExp(`^Cadence ${parts.value}`),
    )
    expect(summary.textContent).toContain(parts.position!)
    // The other readings: the bounce composite once, by its headline's name, so nothing reads as
    // listed twice.
    const others = summary.querySelector('.results-summary__row-others')!
    expect(others.textContent).toBe('Also: Vertical ratio')
    // A span, never a heading: a heading inside a summary loses its role.
    expect(summary.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull()
    expect(summary).toHaveClass('min-h-11')
  })

  it('renders the bounce reading as vertical ratio with its From line, the other two collapsed inside', () => {
    const { details } = renderRow('rhythm')
    const composite = details.querySelector<HTMLElement>('div.results-summary__composite')!
    expect(composite).toHaveAttribute('data-composite', 'bounce')
    expect(composite).toHaveAttribute('role', 'group')
    expect(composite).toHaveAccessibleName('Bounce')
    // The headline card first, its From line directly under the headline value.
    const [headlineCard] = composite.querySelectorAll('article')
    expect(headlineCard).toHaveAttribute('data-metric', 'verticalRatio')
    const derived = headlineCard.querySelector('.guided-results__derived-from')!
    expect(derived.textContent).toBe('From hip bounce 15.0% of torso ÷ stride length 3.8 torsos (median of 7)')
    expect(derived.previousElementSibling).toHaveClass('guided-results__headline')
    // One nested disclosure, closed, naming the cards inside, which are mounted already.
    const more = composite.querySelectorAll<HTMLDetailsElement>('details.results-summary__composite-more')
    expect(more).toHaveLength(1)
    expect(more[0].open).toBe(false)
    const moreSummary = more[0].querySelector(':scope > summary')!
    expect(moreSummary.textContent).toBe('Same bounce in cm and % of torso length')
    expect(moreSummary).toHaveClass('min-h-11')
    expect(
      [...more[0].querySelectorAll('article')].map((article) => article.getAttribute('data-metric')),
    ).toEqual(['verticalOscillationCm', 'verticalOscillation'])
    // Cadence stays its own card, first.
    expect(details.querySelector('article')).toHaveAttribute('data-metric', 'cadence')
  })

  it('heads the row with vertical ratio when cadence is excluded, and gives a fallback headline no From line', () => {
    const noCadence = renderRow('rhythm', makeHeuristics({ cadence: makeMetric('cadence', { value: null, confidence: 0 }) }))
    expect(noCadence.summary.querySelector('.results-summary__row-headline')!.textContent).toMatch(/^Vertical ratio /)
    expect(noCadence.summary.querySelector('.results-summary__row-others')).toBeNull()
    noCadence.unmount()

    const noRatio = renderRow(
      'rhythm',
      makeHeuristics({ verticalRatio: makeMetric('verticalRatio', { value: null, confidence: 0 }) }),
    )
    expect(noRatio.summary.querySelector('.results-summary__row-others')!.textContent).toBe(
      'Also: Vertical oscillation (cm)',
    )
    const composite = noRatio.details.querySelector('div.results-summary__composite')!
    expect(composite.querySelector('article')).toHaveAttribute('data-metric', 'verticalOscillationCm')
    expect(composite.querySelector('.guided-results__derived-from')).toBeNull()
    expect(composite.querySelector('details.results-summary__composite-more > summary')!.textContent).toBe('Same bounce in % of torso length')
  })

  it('ignores the bounce reading’s nested disclosure opening inside the row', async () => {
    const { details, onToggle } = renderRow('rhythm')
    const more = details.querySelector<HTMLDetailsElement>('details.results-summary__composite-more')!
    act(() => {
      more.open = true
    })
    await waitFor(() => expect(more.open).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('draws a decorative band marker only when the headline is banded', () => {
    const banded = renderRow('posture')
    const marker = banded.summary.querySelector('.metric-scale--compact')
    expect(marker).not.toBeNull()
    expect(marker).toHaveAttribute('aria-hidden', 'true')
    banded.unmount()

    // Arm swing has no published band.
    const unbanded = renderRow('arms')
    expect(unbanded.row.entries[0].band).toBeNull()
    expect(unbanded.summary.querySelector('.metric-scale--compact')).toBeNull()
  })

  it('reports each open and close', async () => {
    const { details, summary, onToggle } = renderRow('knees')
    fireEvent.click(summary)
    await waitFor(() => expect(onToggle).toHaveBeenLastCalledWith('knees', true))
    expect(details.open).toBe(true)
    act(() => {
      details.open = false
    })
    await waitFor(() => expect(onToggle).toHaveBeenLastCalledWith('knees', false))
  })

  it('ignores a card’s own disclosure opening inside the row', async () => {
    const { details, onToggle } = renderRow('knees')
    const inner = details.querySelector<HTMLDetailsElement>('details.guided-results__more')!
    expect(inner).not.toBeNull()
    act(() => {
      inner.open = true
    })
    await waitFor(() => expect(inner.open).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('carries the area’s why line with its source, and no cue', () => {
    // A cadence past its band's costly side earns the rhythm area a cue. The row shows the why line
    // and leaves the cue to the card's own Try line.
    const heuristics = makeHeuristics({
      cadence: makeMetric('cadence', { value: 145 }),
    })
    const { details, row } = renderRow('rhythm', heuristics)
    const feedback = feedbackFor(row.view)
    expect(feedback.cue).not.toBeNull()
    expect(feedback.why).not.toBeNull()
    const why = details.querySelector('.results-summary__why')!
    expect(why).toHaveTextContent(feedback.why!.text)
    const link = why.querySelector('a')!
    expect(link).toHaveAttribute('href', feedback.why!.url)
    expect(link).toHaveTextContent(FEEDBACK_SOURCE_TITLES[feedback.why!.url])
    expect(details.textContent).not.toContain(CUE_PREFIX)
  })

  it('carries a non-point where the area has one', () => {
    const { details, row } = renderRow('landing')
    const feedback = feedbackFor(row.view)
    expect(feedback.nonPoint).not.toBeNull()
    expect(details.querySelector('.results-summary__why')).toHaveTextContent(feedback.nonPoint!.text)
  })

  it('adopts a card’s evidence canvas inside the collapsed row', () => {
    const canvas = document.createElement('canvas')
    const evidence: MetricCardEvidence[] = [
      {
        metric: 'trunkLean',
        clipIndex: 0,
        items: [
          {
            plan: {
              metric: 'trunkLean',
              kind: 'footStrike',
              quality: 0.8,
              label: 'Torso at the widest lean',
              side: 'left',
              base: { timestamp: 0.4, opacity: 1, keypoints: [], outwardSign: null, side: null },
              ghost: null,
              crop: { x: 0, y: 0, side: 200 },
              travelDirection: 1,
              demotion: null,
              cropGrowth: null,
              focusOffset: null,
            },
            canvas,
          },
        ],
      },
    ]
    const { details } = renderRow('posture', makeHeuristics(), evidence)
    expect(details.open).toBe(false)
    expect(canvas.closest('details')).toBe(details)
  })
})

describe('NotMeasuredRow', () => {
  it('names every unmeasured metric in its collapsed summary and lists each entry inside', () => {
    const ids: MetricId[] = ['kneeDrive', 'stepWidthCm']
    const heuristics = makeHeuristics(
      Object.fromEntries(ids.map((id) => [id, makeMetric(id, { value: null, confidence: 0 })])),
    )
    const { notMeasured } = summaryRows(heuristics)
    const { container } = render(<NotMeasuredRow entries={notMeasured} scalePassStatus="idle" />)
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    const summary = details.querySelector('summary')!
    expect(summary.textContent).toContain('Not measured')
    expect(summary.textContent).not.toMatch(/measurements?:/)
    for (const entry of notMeasured) {
      expect(summary.textContent).toContain(METRIC_LABELS[entry.metric.metric])
      expect(details.querySelector(`#guided-results-${entry.metric.metric}`)).not.toBeNull()
    }
  })
})
