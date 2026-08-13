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

/**
 * Mixed-tier fixture: verticalOscillation lands in tier 2 (caveated, confidence 0.5, no caveat
 * text -- exercises the documented "tier-2 card with a null caveat" case); trunkLean/overstriding
 * land in tier 3 (excluded, unsuitable view, null value, non-null caveat); every other metric is
 * tier 1 (normal), including footStrikePattern, whose caveat is always present regardless of tier.
 */
function makeMixedTierResult(): FormHeuristicsResult {
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
    verticalRatio: makeMetric({
      metric: 'verticalRatio',
      value: 0.07,
      unit: 'percent',
      confidence: 0.7,
    }),
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

  it('renders formatted values and high-confidence labels for a clean (all tier-1) result', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByText('6.0°')).toBeInTheDocument()
    // verticalOscillationCm's 'centimeters' unit formats with no "of torso length"/percent
    // suffix at all -- an absolute quantity, unlike every other metric on the panel.
    expect(screen.getByText('4.8 cm')).toBeInTheDocument()
    expect(screen.getAllByText(/high confidence/i).length).toBe(9)
    // No metric is excluded, so the excluded section doesn't render at all.
    expect(screen.queryByText(/not measured for this clip/i)).not.toBeInTheDocument()
    // footStrikePattern is the one deliberate exception: its caveat is always present, even in a
    // clean/high-confidence (tier-1) result, since it's a documented proxy end to end (see
    // footStrikePattern.ts) — so exactly one note renders here, not zero.
    expect(screen.getAllByRole('note').length).toBe(1)
  })

  it('renders the vertical oscillation chart inside its card when it lands in tier 1/2', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByRole('img', { name: /vertical oscillation/i })).toBeInTheDocument()
  })

  it('renders a tier-1 card with the plain border and no data-tier="caveated"/"excluded"', () => {
    const { container } = render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    const cards = container.querySelectorAll('.metrics-panel__card')
    expect(cards.length).toBe(9)
    for (const card of Array.from(cards)) {
      expect(card.getAttribute('data-tier')).toBe('normal')
    }
  })

  it('renders a tier-2 (caveated) card with a distinct data-tier and its confidence label, even with no caveat text', () => {
    render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    const card = screen.getByLabelText('Vertical oscillation')
    expect(card.getAttribute('data-tier')).toBe('caveated')
    expect(within(card).getByText(/medium confidence/i)).toBeInTheDocument()
    // This fixture's tier-2 metric has caveat: null (a documented, real case -- see
    // metricConfidence.ts) -- no role="note" renders for it, but the confidence label text alone
    // still visibly distinguishes it from a tier-1 card without relying on the border/color.
    expect(within(card).queryByRole('note')).not.toBeInTheDocument()
  })

  it('renders a tier-2 card caveat visibly, in its own bordered note, when present', () => {
    const heuristics = makeMixedTierResult()
    heuristics.verticalOscillation = makeVerticalOscillation({
      value: 0.1,
      confidence: 0.5,
      viewFit: 'tolerated',
      caveat: 'Only 2 step(s) observed -- confidence reduced accordingly.',
    })
    render(<MetricsPanel heuristics={heuristics} />)
    const card = screen.getByLabelText('Vertical oscillation')
    const note = within(card).getByRole('note')
    expect(note.textContent).toMatch(/only 2 step\(s\) observed/i)
  })

  it('excludes tier-3 metrics from the card grid entirely -- no value, no confidence label', () => {
    render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    // trunkLean and overstriding are excluded (tier 3) -- neither renders as a card at all.
    expect(screen.queryByLabelText('Trunk lean')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Overstriding')).not.toBeInTheDocument()
    // Nothing in this fixture has a null value or 0 confidence except the two excluded metrics,
    // so these pseudo-values existing anywhere would mean one of them leaked into a card.
    expect(screen.queryByText('Not available')).not.toBeInTheDocument()
    expect(screen.queryByText('Not measurable')).not.toBeInTheDocument()
    // Scoped to the excluded section specifically: no confidence label of any kind renders there,
    // only the name + reason text already asserted by the next test.
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).queryByText(/confidence/i)).not.toBeInTheDocument()
  })

  it('lists excluded metrics by name and reason only, in a labeled section', () => {
    render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Trunk lean')).toBeInTheDocument()
    expect(within(excludedSection).getByText(/sagittal-plane measurement/i)).toBeInTheDocument()
    expect(within(excludedSection).getByText('Overstriding')).toBeInTheDocument()
    expect(
      within(excludedSection).getByText(/no resolvable body-scale reference/i),
    ).toBeInTheDocument()
  })

  it('7 cards render in the grid and 2 metrics are excluded for the mixed-tier fixture', () => {
    const { container } = render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    const cards = container.querySelectorAll('.metrics-panel__card')
    // trunkLean and overstriding are excluded; the other 7 (1 caveated, 6 normal) render as cards.
    expect(cards.length).toBe(7)
    const caveatedCount = Array.from(cards).filter(
      (card) => card.getAttribute('data-tier') === 'caveated',
    ).length
    expect(caveatedCount).toBe(1)
    const excludedEntries = container.querySelectorAll('.metrics-panel__excluded-entry')
    expect(excludedEntries.length).toBe(2)
  })

  it('preserves MetricId declaration order within the grid, skipping excluded metrics in place', () => {
    const { container } = render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    const cardLabels = Array.from(container.querySelectorAll('.metrics-panel__card')).map(
      (card) => card.getAttribute('aria-label'),
    )
    // Declaration order is verticalOscillation, verticalRatio, verticalOscillationCm, trunkLean,
    // overstriding, cadence, kneeFlexion, armSwingSymmetry, footStrikePattern -- trunkLean and
    // overstriding (excluded) are omitted, but every other label keeps its relative position.
    expect(cardLabels).toEqual([
      'Vertical oscillation',
      'Vertical ratio',
      'Vertical oscillation (cm)',
      'Cadence',
      'Knee flexion',
      'Arm swing symmetry',
      'Foot strike pattern',
    ])
  })

  it('preserves MetricId declaration order within the excluded section', () => {
    render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    const names = within(excludedSection)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent)
    // trunkLean precedes overstriding in MetricId, and that order is preserved here.
    expect(names).toEqual(['Trunk lean', 'Overstriding'])
  })

  it('renders verticalOscillationCm in the excluded section (not a low-confidence card) when unavailable on this backend', () => {
    // The #36-deferred wart #37 fixes: on a backend that doesn't measure real-world scale
    // (MoveNet), this metric's null value should read as "not applicable", not "low confidence".
    // Tier 3 achieves that structurally -- it's no longer a confidence-labeled card at all.
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

    expect(screen.queryByLabelText('Vertical oscillation (cm)')).not.toBeInTheDocument()
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Vertical oscillation (cm)')).toBeInTheDocument()
    expect(
      within(excludedSection).getByText(/no real-world scale was measured/i),
    ).toBeInTheDocument()
    expect(within(excludedSection).queryByText('Not available')).not.toBeInTheDocument()
  })

  it('excludes a low-confidence but non-null verticalOscillationCm value, hiding the number itself', () => {
    // Documents a deliberate consequence of the tier-3 rule (confidence < 0.4 OR value === null):
    // a measured-but-untrustworthy number is withheld entirely, not shown with a low-confidence
    // label -- matches the epic's "don't show a metric, show why it was effectively excluded".
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: 12.4,
      confidence: 0.37,
      caveat: 'Scale coverage was low for this clip -- confidence reduced accordingly.',
    })

    render(<MetricsPanel heuristics={heuristics} />)

    expect(screen.queryByLabelText('Vertical oscillation (cm)')).not.toBeInTheDocument()
    expect(screen.queryByText('12.4 cm')).not.toBeInTheDocument()
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Vertical oscillation (cm)')).toBeInTheDocument()
    expect(within(excludedSection).getByText(/scale coverage was low/i)).toBeInTheDocument()
  })

  it('falls back to a generic reason for an excluded metric with no caveat text', () => {
    // A theoretical-but-possible gap in the heuristics layer's caveat emission (see
    // metricConfidence.ts's doc on metricTier): confidence can drop below the exclusion threshold
    // via frameCoverage alone, with no per-metric caveat message pushed for that shortfall. The
    // excluded section must still show SOME reason text, never a blank entry.
    const heuristics = makeHighConfidenceResult()
    heuristics.cadence = makeMetric({
      metric: 'cadence',
      value: 150,
      unit: 'stepsPerMinute',
      confidence: 0.2,
      caveat: null,
    })

    render(<MetricsPanel heuristics={heuristics} />)

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Cadence')).toBeInTheDocument()
    expect(within(excludedSection).getByText(/too low to report/i)).toBeInTheDocument()
  })
})
