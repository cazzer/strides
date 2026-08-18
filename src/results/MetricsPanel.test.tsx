import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricsPanel } from './MetricsPanel'
import type { MetricCardEvidence } from './MetricsPanel'
import type { EvidenceFramePlan, EvidenceInstantPlan } from './evidenceFrames'
import { SCALE_PASS_PROVENANCE_CAVEAT } from './scalePassGraft'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import type {
  FormHeuristicsResult,
  MetricId,
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

function makeStepWidthCm(overrides: Partial<MetricResult> = {}): MetricResult {
  return makeMetric({
    metric: 'stepWidthCm',
    value: 8.2,
    unit: 'centimeters',
    confidence: 0.9,
    viewFit: 'primary',
    sampleSize: 5,
    ...overrides,
  })
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
    stepWidth: makeMetric({
      metric: 'stepWidth',
      value: 0.18,
      unit: 'percent',
      confidence: 0.8,
    }),
    // Deliberately clean here too, same reasoning as verticalOscillationCm above -- a dedicated
    // test below covers the unavailable-on-this-backend case.
    stepWidthCm: makeStepWidthCm(),
  }
}

/**
 * Mixed-tier fixture: verticalOscillation lands in tier 2 (caveated, confidence 0.5, no caveat
 * text -- exercises the documented "tier-2 card with a null caveat" case); trunkLean/overstriding
 * land in tier 3 (excluded, unsuitable view, null value, non-null caveat); every other metric is
 * tier 1 (normal), including footStrikePattern, whose caveat is always present regardless of tier,
 * and stepWidth, which is front-primary -- this fixture's 'front' view -- so it lands in tier 1
 * here, the mirror image of trunkLean/overstriding's side-primary exclusion.
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
    stepWidth: makeMetric({
      metric: 'stepWidth',
      value: 0.15,
      unit: 'percent',
      confidence: 0.72,
    }),
    stepWidthCm: makeStepWidthCm({ confidence: 0.7 }),
  }
}

describe('MetricsPanel', () => {
  it('renders all eleven metrics with their plain-language labels', () => {
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
    expect(screen.getByText('Step width')).toBeInTheDocument()
    expect(screen.getByText('Step width (cm)')).toBeInTheDocument()
  })

  it('renders formatted values and high-confidence labels for a clean (all tier-1) result', () => {
    render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(screen.getByText('6.0°')).toBeInTheDocument()
    // verticalOscillationCm's and stepWidthCm's 'centimeters' unit formats with no
    // "of torso length"/percent suffix at all -- an absolute quantity, unlike every other metric
    // on the panel.
    expect(screen.getByText('4.8 cm')).toBeInTheDocument()
    expect(screen.getByText('8.2 cm')).toBeInTheDocument()
    expect(screen.getAllByText(/high confidence/i).length).toBe(11)
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
    expect(cards.length).toBe(11)
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

  it('renders a tier-count summary line when any metric is caveated or excluded', () => {
    render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    expect(
      screen.getByText(
        '8 metrics measured · 1 with caveat · 2 not measured for this clip (listed below)',
      ),
    ).toBeInTheDocument()
  })

  it('renders no summary line for an all-tier-1 result', () => {
    const { container } = render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(container.querySelector('.metrics-panel__tier-summary')).not.toBeInTheDocument()
  })

  it('9 cards render in the grid and 2 metrics are excluded for the mixed-tier fixture', () => {
    const { container } = render(<MetricsPanel heuristics={makeMixedTierResult()} />)
    const cards = container.querySelectorAll('.metrics-panel__card')
    // trunkLean and overstriding are excluded; the other 9 (1 caveated, 8 normal) render as cards.
    expect(cards.length).toBe(9)
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
    // overstriding, cadence, kneeFlexion, armSwingSymmetry, footStrikePattern, stepWidth,
    // stepWidthCm -- trunkLean and overstriding (excluded) are omitted, but every other label
    // keeps its relative position.
    expect(cardLabels).toEqual([
      'Vertical oscillation',
      'Vertical ratio',
      'Vertical oscillation (cm)',
      'Cadence',
      'Knee flexion',
      'Arm swing symmetry',
      'Foot strike pattern',
      'Step width',
      'Step width (cm)',
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

  it('renders stepWidthCm in the excluded section (not a low-confidence card) when unavailable on this backend', () => {
    // Same MediaPipe-only availability gate as verticalOscillationCm, on a different metric.
    const unavailable = makeHighConfidenceResult()
    unavailable.stepWidthCm = makeStepWidthCm({
      value: null,
      confidence: 0,
      frameCoverage: 0,
      sampleSize: 0,
      caveat:
        "No real-world scale could be measured for this clip, so step width can't be reported in centimetres.",
    })

    render(<MetricsPanel heuristics={unavailable} />)

    expect(screen.queryByLabelText('Step width (cm)')).not.toBeInTheDocument()
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Step width (cm)')).toBeInTheDocument()
    expect(
      within(excludedSection).getByText(/no real-world scale could be measured/i),
    ).toBeInTheDocument()
  })

  it('shows the measuring-scale hint for a null-value stepWidthCm while the scale pass runs, same as verticalOscillationCm', () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.stepWidthCm = makeStepWidthCm({
      value: null,
      confidence: 0,
      caveat:
        "No real-world scale could be measured for this clip, so step width can't be reported in centimetres.",
    })

    render(<MetricsPanel heuristics={heuristics} scalePassStatus="running" />)

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(
      within(excludedSection).getByText(
        'Measuring real-world scale with a second look at the clip…',
      ),
    ).toBeInTheDocument()
    expect(
      within(excludedSection).queryByText(/no real-world scale could be measured/i),
    ).not.toBeInTheDocument()
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
        "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres. Vertical oscillation and vertical ratio measure the same bounce without it.",
      calibration: null,
    }

    render(<MetricsPanel heuristics={unavailable} />)

    expect(screen.queryByLabelText('Vertical oscillation (cm)')).not.toBeInTheDocument()
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Vertical oscillation (cm)')).toBeInTheDocument()
    expect(
      within(excludedSection).getByText(/no real-world scale could be measured/i),
    ).toBeInTheDocument()
    expect(within(excludedSection).queryByText('Not available')).not.toBeInTheDocument()
  })

  it('renders a low-confidence but non-null verticalOscillationCm value as a caveated card, value shown', () => {
    // The reversal exclude-only-unmeasurable-metrics ships: a measured value at a workable
    // camera angle is never withheld for low confidence. Under #37's rule this exact shape
    // (conf 0.37 < 0.4, value present, viewFit primary) was excluded from the grid; now it
    // renders as a tier-2 card carrying its value and a "Low confidence" indicator.
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: 12.4,
      confidence: 0.37,
      caveat: 'Scale coverage was low for this clip -- confidence reduced accordingly.',
    })

    render(<MetricsPanel heuristics={heuristics} />)

    const card = screen.getByLabelText('Vertical oscillation (cm)')
    expect(card.getAttribute('data-tier')).toBe('caveated')
    expect(within(card).getByText('12.4 cm')).toBeInTheDocument()
    expect(within(card).getByText(/low confidence/i)).toBeInTheDocument()
    expect(within(card).getByRole('note').textContent).toMatch(/scale coverage was low/i)
    // Nothing else is excluded in this fixture, so no excluded section renders at all.
    expect(screen.queryByText(/not measured for this clip/i)).not.toBeInTheDocument()
  })

  it('renders every metric of the track-demo bad-fit shape as a card -- low confidence never excludes', () => {
    // The RCA shape: on ~25% of track-demo runs the shared hip-bounce fit's sinusoidR2 lands in
    // its low mode and verticalOscillation/verticalRatio/cadence confidence collapses to
    // 0.02-0.21 -- all three still measured, all three viewFit 'primary'. They must render as
    // cards with values on every run; only the structurally unmeasurable two (null-valued cm on
    // MoveNet, unsuitable-view arm swing on a side clip) belong in the excluded section.
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillation = makeVerticalOscillation({ value: 0.18, confidence: 0.02 }, [
      { timestamp: 0, value: 0.05 },
    ])
    heuristics.verticalRatio = makeMetric({
      metric: 'verticalRatio',
      value: 0.09,
      unit: 'percent',
      confidence: 0.21,
    })
    heuristics.cadence = makeMetric({
      metric: 'cadence',
      value: 91,
      unit: 'stepsPerMinute',
      confidence: 0.1,
    })
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      caveat: 'No real-world scale could be measured for this clip.',
    })
    heuristics.armSwingSymmetry = makeMetric({
      metric: 'armSwingSymmetry',
      value: 0.5,
      unit: 'percent',
      confidence: 0.06,
      viewFit: 'unsuitable',
      caveat: 'Arm swing symmetry needs a front-facing view.',
    })

    render(<MetricsPanel heuristics={heuristics} />)

    for (const label of ['Vertical oscillation', 'Vertical ratio', 'Cadence']) {
      const card = screen.getByLabelText(label)
      expect(card.getAttribute('data-tier')).toBe('caveated')
      expect(within(card).getByText(/low confidence/i)).toBeInTheDocument()
    }
    expect(screen.getByText('18.0% of torso length')).toBeInTheDocument()
    expect(screen.getByText('9.0%')).toBeInTheDocument()
    expect(screen.getByText('91 steps/min')).toBeInTheDocument()

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Vertical oscillation (cm)')).toBeInTheDocument()
    expect(within(excludedSection).getByText('Arm swing symmetry')).toBeInTheDocument()
    expect(within(excludedSection).queryByText('Vertical oscillation')).not.toBeInTheDocument()
    expect(within(excludedSection).queryByText('Vertical ratio')).not.toBeInTheDocument()
    expect(within(excludedSection).queryByText('Cadence')).not.toBeInTheDocument()
  })

  it('excludes an unsuitable-view metric with a measured value, surfacing its caveat and never its number', () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.armSwingSymmetry = makeMetric({
      metric: 'armSwingSymmetry',
      value: 0.88,
      unit: 'percent',
      confidence: 0.06,
      viewFit: 'unsuitable',
      caveat: 'Arm swing symmetry needs a front-facing view and is not reliable from a side view.',
    })

    render(<MetricsPanel heuristics={heuristics} />)

    expect(screen.queryByLabelText('Arm swing symmetry')).not.toBeInTheDocument()
    expect(screen.queryByText('88.0%')).not.toBeInTheDocument()
    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Arm swing symmetry')).toBeInTheDocument()
    expect(
      within(excludedSection).getByText(/not reliable from a side view/i),
    ).toBeInTheDocument()
  })

  it('shows the measuring-scale hint for a null-value verticalOscillationCm while the scale pass runs', () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      caveat:
        "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres.",
    })

    render(<MetricsPanel heuristics={heuristics} scalePassStatus="running" />)

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(
      within(excludedSection).getByText(
        'Measuring real-world scale with a second look at the clip…',
      ),
    ).toBeInTheDocument()
    // The hint REPLACES the availability caveat -- both at once would misstate the situation.
    expect(
      within(excludedSection).queryByText(/no real-world scale could be measured/i),
    ).not.toBeInTheDocument()
  })

  it("says a second look couldn't measure scale, for a null-value verticalOscillationCm after a failed pass", () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      caveat:
        "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres.",
    })

    render(<MetricsPanel heuristics={heuristics} scalePassStatus="failed" />)

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(
      within(excludedSection).getByText(
        "A second look at the clip couldn't measure real-world scale.",
      ),
    ).toBeInTheDocument()
    // The bare availability caveat would imply the capability was never exercised.
    expect(
      within(excludedSection).queryByText(/no real-world scale could be measured/i),
    ).not.toBeInTheDocument()
  })

  it('shows the caveat, not the hint, when no scale pass is in progress', () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      caveat:
        "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres.",
    })

    render(<MetricsPanel heuristics={heuristics} />)

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(
      within(excludedSection).getByText(/no real-world scale could be measured/i),
    ).toBeInTheDocument()
    expect(
      within(excludedSection).queryByText(/measuring real-world scale/i),
    ).not.toBeInTheDocument()
  })

  it('renders a non-null verticalOscillationCm as a card even mid-pass -- the hint is only for nothing-measured-yet', () => {
    // Under exclude-only-unmeasurable-metrics, a measured (non-null) centimetre value is never
    // excluded for low confidence -- it renders as a caveated card, so the in-progress hint
    // (which lives in the excluded section) simply does not apply to it.
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: 12.4,
      confidence: 0.37,
      caveat: 'Scale coverage was low for this clip -- confidence reduced accordingly.',
    })

    render(<MetricsPanel heuristics={heuristics} scalePassStatus="running" />)

    const card = screen.getByLabelText('Vertical oscillation (cm)')
    expect(card.getAttribute('data-tier')).toBe('caveated')
    expect(within(card).getByText('12.4 cm')).toBeInTheDocument()
    expect(screen.queryByText(/measuring real-world scale/i)).not.toBeInTheDocument()
  })

  it('renders a grafted scale-pass result as a caveated card whose note carries the provenance sentence', () => {
    // What the panel sees after the background scale pass grafts its measurement: a non-null
    // centimetre value whose own confidence (0.41, per the assessed live evidence) lands it in
    // tier 2 -- an ordinary caveated card, no scale-pass-specific treatment.
    const heuristics = makeHighConfidenceResult()
    heuristics.verticalOscillationCm = makeVerticalOscillationCm({
      value: 12.0,
      confidence: 0.41,
      caveat: SCALE_PASS_PROVENANCE_CAVEAT,
    })

    render(<MetricsPanel heuristics={heuristics} />)

    const card = screen.getByLabelText('Vertical oscillation (cm)')
    expect(card.getAttribute('data-tier')).toBe('caveated')
    expect(within(card).getByText('12.0 cm')).toBeInTheDocument()
    const note = within(card).getByRole('note')
    expect(note.textContent).toContain('From a second look at the same clip.')
  })

  it('counts a below-0.4-confidence card under "with caveats" in the summary line', () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.cadence = makeMetric({
      metric: 'cadence',
      value: 150,
      unit: 'stepsPerMinute',
      confidence: 0.2,
    })

    render(<MetricsPanel heuristics={heuristics} />)

    expect(screen.getByText('10 metrics measured · 1 with caveat')).toBeInTheDocument()
  })

  it('falls back to a generic reason for an excluded metric with no caveat text', () => {
    // Every live null-value path in the heuristics layer sets a caveat (each nullResult helper
    // requires one), but the shape is type-legal without it -- the excluded section must still
    // show SOME reason text, never a blank entry, and since exclusion can only mean
    // "structurally unmeasurable" the fallback copy is confidence-neutral.
    const heuristics = makeHighConfidenceResult()
    heuristics.cadence = makeMetric({
      metric: 'cadence',
      value: null,
      unit: 'stepsPerMinute',
      confidence: 0,
      caveat: null,
    })

    render(<MetricsPanel heuristics={heuristics} />)

    const excludedSection = screen.getByRole('region', { name: /not measured for this clip/i })
    expect(within(excludedSection).getByText('Cadence')).toBeInTheDocument()
    expect(
      within(excludedSection).getByText('Not measurable for this clip.'),
    ).toBeInTheDocument()
  })
})

function instant(timestamp: number, opacity = 1): EvidenceInstantPlan {
  return { timestamp, opacity, keypoints: [], outwardSign: null, side: null }
}

function framePlan(
  metric: MetricId,
  overrides: Partial<EvidenceFramePlan> = {},
): EvidenceFramePlan {
  return {
    metric,
    kind: 'footStrike',
    quality: 0.8,
    label: 'heel-like footstrike, left foot',
    side: 'left',
    base: instant(0.4),
    ghost: null,
    crop: { x: 0, y: 0, side: 200 },
    travelDirection: 1,
    demotedFromPair: false,
    ...overrides,
  }
}

function extracted(plan: EvidenceFramePlan): ExtractedEvidenceFrame {
  return { plan, canvas: document.createElement('canvas') }
}

function evidenceFor(
  metric: MetricId,
  plans: EvidenceFramePlan[] = [framePlan(metric)],
  clipIndex = 0,
): MetricCardEvidence {
  return { metric, clipIndex, items: plans.map(extracted) }
}

describe('MetricsPanel — evidence inside the card', () => {
  it('renders no imagery anywhere when the prop is omitted, which is every call site without an analysed session', () => {
    const { container } = render(<MetricsPanel heuristics={makeHighConfidenceResult()} />)
    expect(container.querySelectorAll('.metrics-panel__evidence')).toHaveLength(0)
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
  })

  it('puts each metric’s imagery inside that metric’s own card, and nowhere else', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('trunkLean'), evidenceFor('kneeFlexion')]}
      />,
    )
    const trunk = screen.getByRole('article', { name: 'Trunk lean' })
    expect(within(trunk).getByRole('img', { name: /trunk lean/i })).toBeInTheDocument()
    const knee = screen.getByRole('article', { name: 'Knee flexion' })
    expect(within(knee).getByRole('img', { name: /knee flexion/i })).toBeInTheDocument()

    const other = screen.getByRole('article', { name: 'Overstriding' })
    expect(other.querySelectorAll('.metrics-panel__evidence')).toHaveLength(0)
  })

  it('renders the imagery after the description, which is where the eye goes next', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('trunkLean')]}
      />,
    )
    const card = screen.getByRole('article', { name: 'Trunk lean' })
    const description = card.querySelector('.metrics-panel__description')
    const block = card.querySelector('.metrics-panel__evidence')
    expect(description).not.toBeNull()
    expect(block).not.toBeNull()
    const after =
      (description!.compareDocumentPosition(block!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(after).toBe(true)
    // …and the confidence label sits in the SAME column as the description, directly under it,
    // rather than below the whole two-column block. So it precedes the imagery in document order
    // and shares a parent with the description — the property that actually places it on screen.
    const confidence = card.querySelector('.metrics-panel__confidence')
    expect(confidence).not.toBeNull()
    expect(confidence!.parentElement).toBe(description!.parentElement)
    const confidenceAfterDescription =
      (description!.compareDocumentPosition(confidence!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(confidenceAfterDescription).toBe(true)
    const confidenceBeforeBlock =
      (confidence!.compareDocumentPosition(block!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(confidenceBeforeBlock).toBe(true)
  })

  it('puts the caveat and the chart in the text column, not below the two-column block', () => {
    // Needs a series (so the chart renders at all) and a caveat (so both movers are present).
    const heuristics = {
      ...makeHighConfidenceResult(),
      verticalOscillation: makeVerticalOscillation(
        { caveat: 'The bounce rhythm in this clip wasn’t perfectly steady.' },
        [
          { timestamp: 0, value: 0.1 },
          { timestamp: 0.5, value: 0.12 },
          { timestamp: 1, value: 0.09 },
        ],
      ),
    }
    render(
      <MetricsPanel heuristics={heuristics} evidence={[evidenceFor('verticalOscillation')]} />,
    )
    const card = screen.getByRole('article', { name: 'Vertical oscillation' })
    const description = card.querySelector('.metrics-panel__description')!
    const chart = card.querySelector('.vertical-oscillation-chart')
    const caveat = card.querySelector('.metrics-panel__caveat')
    const block = card.querySelector('.metrics-panel__evidence')!
    expect(chart).not.toBeNull()
    expect(caveat).not.toBeNull()

    // The text column is whichever ancestor holds the description AND is a child of the flex row
    // the imagery also sits in. Asserted by CONTAINMENT rather than direct parentage: narrow-width
    // interleaving needs the column's children wrapped in orderable groups, so `parentElement`
    // is an implementation detail while "is inside the text column" is the actual guarantee.
    const row = block.closest('.flex')!.parentElement === null ? null : block.closest('.flex')!
    const column = [...row!.children].find((c) => c.contains(description))!
    expect(column).toBeDefined()

    // The chart is the tall element. Below the block it left the text column a mostly-empty
    // half-card beside a short thumbnail; in the column it fills that space.
    expect(column.contains(chart!)).toBe(true)
    // The caveat rides along so the reading order survives the move — caveat then chart, as it
    // was when both sat below the block. Moving only the chart would have flipped them.
    expect(column.contains(caveat!)).toBe(true)
    const caveatBeforeChart =
      (caveat!.compareDocumentPosition(chart!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(caveatBeforeChart).toBe(true)

    // …and the imagery is NOT in that column — it is the other side of the row.
    expect(column.contains(block)).toBe(false)
  })

  it('interleaves the imagery between the confidence and the chart while the card is narrow', () => {
    // The narrow-width guarantee the spec states as "the picture and the number it explains SHALL
    // be visible together": on a phone the image must not be pushed below a tall chart. jsdom has
    // no layout, so this asserts the MECHANISM — the text column dissolves to `contents` at narrow
    // and its two halves carry orders that bracket the imagery's.
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('trunkLean')]}
      />,
    )
    const card = screen.getByRole('article', { name: 'Trunk lean' })
    const description = card.querySelector('.metrics-panel__description')!
    const block = card.querySelector('.metrics-panel__evidence')!
    const row = block.closest('.flex')!
    const column = [...row.children].find((c) => c.contains(description))!

    // Dissolves at narrow, becomes a column once wide.
    expect(column.className).toContain('contents')
    expect(column.className).toContain('@lg/card:block')

    const textGroup = [...column.children].find((c) => c.contains(description))!
    const imageGroup = [...row.children].find((c) => c.contains(block))!
    expect(textGroup.className).toContain('order-1')
    expect(imageGroup.className).toContain('order-2')
    // …and every ordered group returns to source order once the card is wide.
    expect(imageGroup.className).toContain('@lg/card:order-none')
  })

  it('splits narrow-vs-wide on the CARD’s own width, never the viewport’s', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('trunkLean')]}
      />,
    )
    const card = screen.getByRole('article', { name: 'Trunk lean' })
    // A named container on the card's own content, and the row that queries it — two nodes,
    // because an element with `container-type` cannot query itself.
    const container = card.querySelector('.\\@container\\/card')
    expect(container).not.toBeNull()
    const row = container!.firstElementChild
    expect(row!.className).toContain('flex-col')
    expect(row!.className).toContain('@lg/card:flex-row')
    // No viewport breakpoint anywhere in the placement decision.
    expect(row!.className).not.toMatch(/(^|\s)(sm|md|lg|xl):/)
  })

  it('adopts the extractor’s own canvas rather than re-encoding it, and offers no download', () => {
    const frame = extracted(framePlan('trunkLean'))
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[{ metric: 'trunkLean', clipIndex: 0, items: [frame] }]}
      />,
    )
    const host = screen.getByRole('img', { name: /trunk lean/i })
    expect(host.firstElementChild).toBe(frame.canvas)
    expect(host.querySelector('img')).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('[download]')).toBeNull()
  })

  it('says a ghosted image is one runner at two instants, never two people', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[
          evidenceFor('trunkLean', [
            framePlan('trunkLean', {
              kind: 'trunkLeanRange',
              side: undefined,
              label: 'Most forward trunk lean, ghosted against the most upright frame',
              base: instant(0.2, 1),
              ghost: instant(0.6, 0.5),
            }),
          ]),
        ]}
      />,
    )
    const card = screen.getByRole('article', { name: 'Trunk lean' })
    const caption = within(card).getByText(/same runner at two instants/i)
    expect(caption).toHaveTextContent('not two people')
    expect(caption).toHaveTextContent('0.20 s and 0.60 s into the clip')
    expect(
      within(card).getByRole('img', {
        name: /Trunk lean: Most forward trunk lean.*Two frames of the same runner blended into one image\./i,
      }),
    ).toBeInTheDocument()
  })

  it('names the side in the alt text where the metric is per-side', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('footStrikePattern')]}
      />,
    )
    expect(
      screen.getByRole('img', {
        name: 'Foot strike pattern (left side): heel-like footstrike, left foot. A single frame from the clip.',
      }),
    ).toBeInTheDocument()
  })

  it('never captions a thumbnail with the card’s own reported number', () => {
    const heuristics = makeHighConfidenceResult()
    render(
      <MetricsPanel heuristics={heuristics} evidence={[evidenceFor('trunkLean')]} />,
    )
    const card = screen.getByRole('article', { name: 'Trunk lean' })
    const value = card.querySelector('.metrics-panel__value')!.textContent!
    const caption = card.querySelector('.metrics-panel__evidence-caption')!.textContent!
    expect(value).not.toBe('')
    expect(caption).not.toContain(value)
  })

  it('says which clip the evidence came from once a session holds more than one', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('trunkLean', [framePlan('trunkLean')], 1)]}
        clipCount={2}
      />,
    )
    const card = screen.getByRole('article', { name: 'Trunk lean' })
    expect(within(card).getByText('From clip 2 of 2.')).toBeInTheDocument()
  })

  it('asks no clip question on a single-clip session', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('trunkLean')]}
        clipCount={1}
      />,
    )
    expect(screen.queryByText(/From clip/i)).not.toBeInTheDocument()
  })

  it('renders both images of a two-exemplar metric at one size, as one set', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[
          evidenceFor('footStrikePattern', [
            framePlan('footStrikePattern'),
            framePlan('footStrikePattern', {
              side: 'right',
              label: 'heel-like footstrike, right foot',
              base: instant(0.8),
            }),
          ]),
        ]}
      />,
    )
    const card = screen.getByRole('article', { name: 'Foot strike pattern' })
    const figures = card.querySelectorAll('.metrics-panel__evidence-figure')
    expect(figures).toHaveLength(2)
    // Same image box on both, so a two-image card and a one-image card read at one scale.
    const boxes = [...figures].map((f) => f.querySelector('[role=img]')!.parentElement!.className)
    expect(boxes[0]).toBe(boxes[1])
    expect(boxes[0]).toContain('w-36')
    // …and both captions span the block rather than the thumbnail.
    expect(
      [...figures].every((f) =>
        f.querySelector('.metrics-panel__evidence-caption')!.className.includes('text-[11px]'),
      ),
    ).toBe(true)
  })

  it('keeps a card without evidence byte-identical to the one it rendered before', () => {
    const heuristics = makeHighConfidenceResult()
    const before = render(<MetricsPanel heuristics={heuristics} />)
    const withoutEvidence = screen.getByRole('article', { name: 'Overstriding' }).outerHTML
    before.unmount()

    render(<MetricsPanel heuristics={heuristics} evidence={[evidenceFor('trunkLean')]} />)
    expect(screen.getByRole('article', { name: 'Overstriding' }).outerHTML).toBe(
      withoutEvidence,
    )
  })

  it('keeps the vertical-oscillation chart when that card also gains imagery', () => {
    render(
      <MetricsPanel
        heuristics={makeHighConfidenceResult()}
        evidence={[evidenceFor('verticalOscillation')]}
      />,
    )
    const card = screen.getByRole('article', { name: 'Vertical oscillation' })
    // The chart's own figure, and the evidence thumbnail, both present and distinct.
    expect(card.querySelector('.metrics-panel__evidence')).not.toBeNull()
    expect(within(card).getAllByRole('img').length).toBeGreaterThan(1)
  })

  it('gives a tier-3 metric no imagery, since it renders no card to hang it on (design D10)', () => {
    const heuristics = makeHighConfidenceResult()
    heuristics.cadence = makeMetric({
      metric: 'cadence',
      value: null,
      unit: 'stepsPerMinute',
      confidence: 0,
      caveat: 'Not measurable.',
    })

    const { container } = render(
      <MetricsPanel heuristics={heuristics} evidence={[evidenceFor('cadence')]} />,
    )
    expect(container.querySelectorAll('.metrics-panel__evidence')).toHaveLength(0)
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
  })
})
