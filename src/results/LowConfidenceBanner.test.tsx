import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LowConfidenceBanner } from './LowConfidenceBanner'
import { METRIC_LABELS } from './metricConfidence'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 10,
    caveat: null,
    ...overrides,
  }
}

function makeHeuristics(
  overrides: Partial<FormHeuristicsResult> = {},
): FormHeuristicsResult {
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
      metric: 'verticalOscillation',
      value: 0.1,
      unit: 'ratio',
      confidence: 0.9,
      viewFit: 'primary',
      interpolatedFraction: 0,
      frameCoverage: 1,
      sampleSize: 10,
      caveat: null,
      series: [],
      fit: null,
    },
    verticalRatio: makeMetric({ metric: 'verticalRatio', unit: 'percent', value: 0.08 }),
    trunkLean: makeMetric({ metric: 'trunkLean' }),
    overstriding: makeMetric({ metric: 'overstriding', unit: 'ratio' }),
    cadence: makeMetric({ metric: 'cadence', unit: 'stepsPerMinute', value: 170 }),
    kneeFlexion: makeMetric({ metric: 'kneeFlexion' }),
    armSwingSymmetry: makeMetric({ metric: 'armSwingSymmetry', unit: 'percent', value: 0.9 }),
    footStrikePattern: makeMetric({ metric: 'footStrikePattern', unit: 'ratio' }),
    ...overrides,
  }
}

describe('LowConfidenceBanner', () => {
  it('renders nothing when every metric is high confidence', () => {
    const { container } = render(
      <LowConfidenceBanner heuristics={makeHeuristics()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a status banner naming a flagged metric', () => {
    render(
      <LowConfidenceBanner
        heuristics={makeHeuristics({
          trunkLean: makeMetric({ metric: 'trunkLean', confidence: 0.1 }),
        })}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/trunk lean/i)
  })

  it('names every flagged metric, not just the first', () => {
    render(
      <LowConfidenceBanner
        heuristics={makeHeuristics({
          trunkLean: makeMetric({ metric: 'trunkLean', value: null }),
          overstriding: makeMetric({
            metric: 'overstriding',
            unit: 'ratio',
            viewFit: 'unsuitable',
          }),
        })}
      />,
    )
    const text = screen.getByRole('status').textContent ?? ''
    expect(text).toMatch(/trunk lean/i)
    expect(text).toMatch(/overstriding/i)
  })

  it('derives its metric-id enumeration from METRIC_LABELS, covering every metric (D9)', () => {
    // Exercises design.md D9's exhaustiveness guarantee, not just its type: flag EVERY metric at
    // once and confirm the banner names all of them, proving the derived list actually covers
    // every METRIC_LABELS key rather than a hand-written list that could silently omit one.
    const allFlagged: Partial<FormHeuristicsResult> = {}
    for (const id of Object.keys(METRIC_LABELS) as MetricId[]) {
      if (id === 'verticalOscillation') continue // has its own richer shape, left as the base fixture's
      allFlagged[id] = makeMetric({ metric: id, value: null })
    }

    render(<LowConfidenceBanner heuristics={makeHeuristics(allFlagged)} />)

    const text = screen.getByRole('status').textContent ?? ''
    for (const id of Object.keys(METRIC_LABELS) as MetricId[]) {
      if (id === 'verticalOscillation') continue // untouched (confidence 0.9, non-null) -- not flagged
      expect(text).toMatch(new RegExp(METRIC_LABELS[id], 'i'))
    }
  })

  it('flags a metric whose value is null even if confidence looks fine', () => {
    render(
      <LowConfidenceBanner
        heuristics={makeHeuristics({
          trunkLean: makeMetric({
            metric: 'trunkLean',
            value: null,
            confidence: 0.9,
          }),
        })}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/trunk lean/i)
  })
})
