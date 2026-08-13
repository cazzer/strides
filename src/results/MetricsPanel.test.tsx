import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricsPanel } from './MetricsPanel'
import type {
  FormHeuristicsResult,
  MetricResult,
  TimeseriesPoint,
  VerticalOscillationCmResult,
  VerticalOscillationResult,
} from '../heuristics/types'

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 20,
    caveat: null,
    ...overrides,
  }
}

function makeVerticalOscillation(
  overrides: Partial<VerticalOscillationResult> = {},
  series: TimeseriesPoint[] = [],
): VerticalOscillationResult {
  return {
    metric: 'verticalOscillation',
    value: 0.1,
    unit: 'ratio',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 20,
    caveat: null,
    series,
    fit: null,
    ...overrides,
  }
}

function makeVerticalOscillationCm(
  overrides: Partial<VerticalOscillationCmResult> = {},
): VerticalOscillationCmResult {
  return {
    metric: 'verticalOscillationCm',
    value: 4.79,
    unit: 'centimeters',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 3,
    caveat: null,
    calibration: null,
    ...overrides,
  }
}

function makeHighConfidenceResult(): FormHeuristicsResult {
  return {
    view: {
      view: 'side',
      confidence: 0.95,
      diagnostics: {
        bilateralSpreadRatio: 0.2,
        sagittalExcursionRatio: 0.9,
        frameCoverage: 1,
      },
    },
    verticalOscillation: makeVerticalOscillation({ value: 0.12, confidence: 0.9 }, [
      { timestamp: 0, value: 0.05 },
      { timestamp: 1, value: -0.05 },
    ]),
    verticalRatio: makeMetric({
      metric: 'verticalRatio',
      value: 0.08,
      unit: 'percent',
      confidence: 0.9,
    }),
    // Deliberately clean here -- this fixture's job is testing the clean/high-confidence render
    // path for every card, and a dedicated test below covers the unavailable-on-this-backend case.
    verticalOscillationCm: makeVerticalOscillationCm(),
    trunkLean: makeMetric({ metric: 'trunkLean', value: 6, confidence: 0.85 }),
    overstriding: makeMetric({
      metric: 'overstriding',
      value: 0.08,
      unit: 'ratio',
      confidence: 0.8,
    }),
    cadence: makeMetric({
      metric: 'cadence',
      value: 172,
      unit: 'stepsPerMinute',
      confidence: 0.9,
    }),
    kneeFlexion: makeMetric({ metric: 'kneeFlexion', value: 110, confidence: 0.85 }),
    armSwingSymmetry: makeMetric({
      metric: 'armSwingSymmetry',
      value: 0.92,
      unit: 'percent',
      confidence: 0.8,
    }),
    footStrikePattern: makeMetric({
      metric: 'footStrikePattern',
      value: 0.02,
      unit: 'ratio',
      confidence: 0.75,
      caveat: 'Approximated from ankle position relative to the knee at footstrike.',
    }),
  }
}

function makeLowConfidenceResult(): FormHeuristicsResult {
  return {
    view: {
      view: 'front',
      confidence: 0.5,
      diagnostics: {
        bilateralSpreadRatio: 0.6,
        sagittalExcursionRatio: 0.2,
        frameCoverage: 0.5,
      },
    },
    verticalOscillation: makeVerticalOscillation(
      { value: 0.1, confidence: 0.5, viewFit: 'tolerated' },
      [{ timestamp: 0, value: 0.05 }],
    ),
    // Deliberately clean/unflagged, same reasoning as cadence/kneeFlexion/armSwingSymmetry below
    // — this fixture's whole point is testing that the panel correctly discriminates
    // trunkLean/overstriding as the ONLY flagged cards.
    verticalRatio: makeMetric({
      metric: 'verticalRatio',
      value: 0.07,
      unit: 'percent',
      confidence: 0.7,
    }),
    // Deliberately clean/unflagged, same reasoning as cadence/kneeFlexion/armSwingSymmetry below.
    verticalOscillationCm: makeVerticalOscillationCm({ confidence: 0.7 }),
    trunkLean: makeMetric({
      metric: 'trunkLean',
      value: null,
      confidence: 0,
      viewFit: 'unsuitable',
      caveat: 'Trunk lean is a sagittal-plane measurement and is not reliable from a front view.',
    }),
    overstriding: makeMetric({
      metric: 'overstriding',
      value: null,
      unit: 'ratio',
      confidence: 0,
      viewFit: 'unsuitable',
      caveat: 'No resolvable body-scale reference (shoulders/hips) in this clip.',
    }),
    // Deliberately clean/unflagged, even though a real front-view clip would gate some of these
    // differently — this fixture's whole point is testing that the panel correctly discriminates
    // trunkLean/overstriding as the ONLY flagged cards, not that every metric matches real
    // view-fit physics.
    cadence: makeMetric({
      metric: 'cadence',
      value: 168,
      unit: 'stepsPerMinute',
      confidence: 0.7,
    }),
    kneeFlexion: makeMetric({ metric: 'kneeFlexion', value: 105, confidence: 0.75 }),
    armSwingSymmetry: makeMetric({
      metric: 'armSwingSymmetry',
      value: 0.88,
      unit: 'percent',
      confidence: 0.7,
    }),
    footStrikePattern: makeMetric({
      metric: 'footStrikePattern',
      value: 0.01,
      unit: 'ratio',
      confidence: 0.7,
      caveat: 'Approximated from ankle position relative to the knee at footstrike.',
    }),
  }
}

describe('MetricsPanel', () => {
  it('renders all nine metrics with their plain-language labels', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByText('Vertical oscillation')).toBeInTheDocument()
    expect(screen.getByText('Vertical ratio')).toBeInTheDocument()
    expect(screen.getByText('Vertical oscillation (cm)')).toBeInTheDocument()
    expect(screen.getByText('Trunk lean')).toBeInTheDocument()
    expect(screen.getByText('Overstriding')).toBeInTheDocument()
    expect(screen.getByText('Cadence')).toBeInTheDocument()
    expect(screen.getByText('Knee flexion')).toBeInTheDocument()
    expect(screen.getByText('Arm swing symmetry')).toBeInTheDocument()
    expect(screen.getByText('Foot strike pattern')).toBeInTheDocument()
  })

  it('renders formatted values and high-confidence labels for a clean result', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByText('6.0°')).toBeInTheDocument()
    // verticalOscillationCm's 'centimeters' unit formats with no "of torso length"/percent
    // suffix at all -- an absolute quantity, unlike every other metric on the panel.
    expect(screen.getByText('4.8 cm')).toBeInTheDocument()
    expect(screen.getAllByText(/high confidence/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/not reliable from this camera angle/i)).not.toBeInTheDocument()
    // footStrikePattern is the one deliberate exception: its caveat is always present, even in a
    // clean/high-confidence result, since it's a documented proxy end to end (see
    // footStrikePattern.ts) — so exactly one note renders here, not zero.
    expect(screen.getAllByRole('note').length).toBe(1)
  })

  it('renders the vertical oscillation chart inside its card', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByRole('img', { name: /vertical oscillation/i })).toBeInTheDocument()
  })

  it('visibly flags a low-confidence/unsuitable-view metric with distinct text, not color alone', () => {
    render(<MetricsPanel heuristics={makeLowConfidenceResult()} />)

    expect(screen.getAllByText('Not available').length).toBe(2)
    expect(screen.getAllByText(/not reliable from this camera angle/i).length).toBe(2)
    expect(screen.getAllByText('Not measurable').length).toBe(2)

    // trunkLean and overstriding's caveats from being flagged, plus footStrikePattern's
    // always-present proxy caveat (present regardless of flagged state — see footStrikePattern.ts).
    const notes = screen.getAllByRole('note')
    expect(notes.length).toBe(3)
    expect(notes[0].textContent).toMatch(/sagittal-plane measurement/i)
  })

  it('marks flagged cards with data-flagged for styling, unflagged cards without it', () => {
    const { container } = render(<MetricsPanel heuristics={makeLowConfidenceResult()} />)
    const cards = container.querySelectorAll('.metrics-panel__card')
    const flaggedCount = Array.from(cards).filter(
      (card) => card.getAttribute('data-flagged') === 'true',
    ).length
    // trunkLean and overstriding are unsuitable/null; every other metric (including
    // verticalOscillation, merely tolerated at confidence 0.5, above the low-confidence
    // threshold, and verticalRatio/verticalOscillationCm, deliberately clean here) is unflagged,
    // so 2 of 9 cards are flagged.
    expect(flaggedCount).toBe(2)
  })

  it('renders verticalOscillationCm as an unavailable card with its availability caveat, not an error', () => {
    const unavailable = makeHighConfidenceResult()
    unavailable.verticalOscillationCm = {
      metric: 'verticalOscillationCm',
      value: null,
      unit: 'centimeters',
      confidence: 0,
      viewFit: 'primary',
      interpolatedFraction: 0,
      frameCoverage: 0,
      sampleSize: 0,
      caveat:
        "No real-world scale was measured for this clip, so bounce can't be reported in centimetres — that needs a pose-detection backend that measures real-world scale (today, MediaPipe Pose Landmarker). Vertical oscillation and vertical ratio measure the same bounce without it.",
      calibration: null,
    }

    render(<MetricsPanel heuristics={unavailable} />)

    const card = screen.getByLabelText('Vertical oscillation (cm)')
    expect(card).toHaveTextContent('Not available')
    const note = within(card).getByRole('note')
    expect(note.textContent).toMatch(/no real-world scale was measured/i)
  })
})
