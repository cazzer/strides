import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuidedResultsView } from './GuidedResultsView'
import { GuidedMetricCard } from './GuidedMetricCard'
import type { MetricCardEvidence } from './MetricsPanel'
import type { EvidenceFramePlan, EvidenceInstantPlan } from './evidenceFrames'
import { captionFor } from './evidenceCaptions'
import { formatGuidedValue } from './formatGuidedValue'
import { guidedGroups } from './guidedGroups'
import { METRIC_LABELS } from './metricConfidence'
import type { ScalePassStatus, VideoAnalysisState } from './types'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE, guidanceInDisplayOrder } from '../guidance/metricGuidance'
import { formatMeasuredBandValue } from '../guidance/bandPosition'
import type { MetricGuidance } from '../guidance/types'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillationCm,
} from './__fixtures__/metricResult'

// The guided view must render the evidence it is handed and start no acquisition of its own. If
// anything under it ever called the hook, this spy would record it.
const useSessionEvidenceSpy = vi.hoisted(() => vi.fn())
vi.mock('./useSessionEvidence', () => ({ useSessionEvidence: useSessionEvidenceSpy }))

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** Same shape as ResultsView.test.tsx's `makeAnalysis`, restated rather than imported. */
function makeAnalysis(overrides: Partial<VideoAnalysisState> = {}): VideoAnalysisState {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    diagnostics: null,
    scalePass: { status: 'idle', diagnostics: null },
    error: null,
    start: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function readyAnalysis(
  heuristics: FormHeuristicsResult = makeHeuristics(),
  scalePassStatus: ScalePassStatus = 'idle',
): VideoAnalysisState {
  return makeAnalysis({
    phase: 'ready',
    heuristics,
    scalePass: { status: scalePassStatus, diagnostics: null },
  })
}

function renderView(
  analysis: VideoAnalysisState,
  extra: { evidence?: readonly MetricCardEvidence[]; clipCount?: number } = {},
) {
  const onTryAgain = vi.fn()
  const onChooseDifferentVideo = vi.fn()
  const utils = render(
    <GuidedResultsView
      analysis={analysis}
      onTryAgain={onTryAgain}
      onChooseDifferentVideo={onChooseDifferentVideo}
      {...extra}
    />,
  )
  return { ...utils, onTryAgain, onChooseDifferentVideo }
}

const ALL_IDS = guidanceInDisplayOrder().map((g) => g.metric)
const BANDED = guidanceInDisplayOrder().filter((g) => g.band !== null)
const UNBANDED = guidanceInDisplayOrder().filter((g) => g.band === null)

/** A heuristics result with the named metrics unmeasured (null value, zero confidence). */
function withUnmeasured(
  ids: readonly MetricId[],
  caveat: string | null = 'Fixture reason: not measured.',
): FormHeuristicsResult {
  const overrides: Partial<FormHeuristicsResult> = {}
  for (const id of ids) {
    if (id === 'verticalOscillationCm') {
      overrides.verticalOscillationCm = makeVerticalOscillationCm({
        value: null,
        confidence: 0,
        calibration: null,
        caveat,
      })
    } else {
      Object.assign(overrides, { [id]: makeMetric(id, { value: null, confidence: 0, caveat }) })
    }
  }
  return makeHeuristics(overrides)
}

function card(label: string): HTMLElement {
  return screen.getByRole('article', { name: label })
}

function bandedSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Compared with published research' })
}

function groupDetails(container: HTMLElement, modifier: 'unbanded' | 'not-measured') {
  return container.querySelector<HTMLDetailsElement>(`details.guided-results__group--${modifier}`)
}

function instant(timestamp: number): EvidenceInstantPlan {
  return { timestamp, opacity: 1, keypoints: [], outwardSign: null, side: null }
}

function framePlan(metric: MetricId, label: string): EvidenceFramePlan {
  return {
    metric,
    kind: 'footStrike',
    quality: 0.8,
    label,
    side: 'left',
    base: instant(0.4),
    ghost: null,
    crop: { x: 0, y: 0, side: 200 },
    travelDirection: 1,
    demotion: null,
    cropGrowth: null,
    focusOffset: null,
  }
}

function extracted(plan: EvidenceFramePlan): ExtractedEvidenceFrame {
  return { plan, canvas: document.createElement('canvas') }
}

/** Every string reachable from the guidance record: the data layer's own vetted words. */
function guidanceStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((item) => guidanceStrings(item, out))
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => guidanceStrings(item, out))
  }
  return out
}

/** Every URL the data layer holds — the only URLs the page may render. */
function guidanceUrls(): Set<string> {
  const urls = new Set<string>()
  for (const g of Object.values(METRIC_GUIDANCE)) {
    for (const link of [...g.research, ...g.remediation]) urls.add(link.url)
    if (g.band !== null) {
      urls.add(g.band.source.url)
      for (const source of g.band.corroboration) urls.add(source.url)
    }
  }
  return urls
}

// ---------------------------------------------------------------------------------------------
// The page shell
// ---------------------------------------------------------------------------------------------

describe('The guided view announces completion with the same words the classic view does', () => {
  it('The completion line is present and verbatim', () => {
    renderView(readyAnalysis())
    expect(screen.getByRole('status')).toHaveTextContent(/^Analysis complete\./)
  })

  it.each([
    ['pending', /^Analysis complete\. Measuring more metrics with a second look at the clip…$/],
    ['running', /^Analysis complete\. Measuring more metrics with a second look at the clip…$/],
    ['failed', /^Analysis complete\. A second look at the clip couldn't add the extra metrics\.$/],
    ['idle', /^Analysis complete\.$/],
  ] as const)('carries the scale-pass narrative for a %s pass, as ResultsView does', (status, text) => {
    renderView(readyAnalysis(makeHeuristics(), status))
    expect(screen.getByRole('status')).toHaveTextContent(text)
  })

  it('counts the metrics a done scale pass added', () => {
    renderView(readyAnalysis(makeHeuristics(), 'done'))
    expect(screen.getByRole('status')).toHaveTextContent(
      /^Analysis complete\. A second look at the clip added 2 more metrics\.$/,
    )
  })

  it("says a done pass couldn't add anything when neither centimetre metric has a value", () => {
    renderView(readyAnalysis(withUnmeasured(['verticalOscillationCm', 'stepWidthCm']), 'done'))
    expect(screen.getByRole('status')).toHaveTextContent(
      /A second look at the clip couldn't add the extra metrics\.$/,
    )
  })

  it('renders no status line before the analysis is ready', () => {
    renderView(makeAnalysis({ phase: 'sampling' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('GuidedResultsView — shell controls mirror ResultsView', () => {
  it('labels the root landmark exactly as ResultsView does', () => {
    renderView(makeAnalysis())
    expect(screen.getByRole('region', { name: 'Analysis results' })).toBeInTheDocument()
  })

  it('shows an enabled Analyze button when idle, and calls start on click', () => {
    const analysis = makeAnalysis()
    renderView(analysis)
    const analyze = screen.getByRole('button', { name: 'Analyze' })
    expect(analyze).toBeEnabled()
    fireEvent.click(analyze)
    expect(analysis.start).toHaveBeenCalledTimes(1)
  })

  it.each(['sampling', 'processing'] as const)('disables Analyze while %s', (phase) => {
    renderView(makeAnalysis({ phase }))
    const analyze = screen.getByRole('button', { name: 'Analyze' })
    expect(analyze).toBeDisabled()
    expect(analyze).toHaveAttribute('title', 'Analysis already in progress')
  })

  it('does not render Analyze once the analysis is ready', () => {
    renderView(readyAnalysis())
    expect(screen.queryByRole('button', { name: /analyze/i })).not.toBeInTheDocument()
  })

  it('calls onChooseDifferentVideo from its button', () => {
    const { onChooseDifferentVideo } = renderView(readyAnalysis())
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different video' }))
    expect(onChooseDifferentVideo).toHaveBeenCalledTimes(1)
  })

  it('renders the error alert with Try again and Analyze again, and no metrics, in the error phase', () => {
    const { container, onTryAgain } = renderView(
      makeAnalysis({
        phase: 'error',
        heuristics: makeHeuristics(),
        error: { kind: 'unknown', message: 'The detector gave up.' },
      }),
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The detector gave up.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(onTryAgain).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Analyze again' })).toBeEnabled()
    expect(container.querySelector('.guided-results__group')).toBeNull()
    expect(container.querySelector('.guided-results__card')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders no metrics when ready but heuristics are missing', () => {
    const { container } = renderView(makeAnalysis({ phase: 'ready', heuristics: null }))
    expect(container.querySelector('.guided-results__results')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The three groups
// ---------------------------------------------------------------------------------------------

describe('The guided view ranks metrics into three groups by what can be said about them', () => {
  it('Banded metrics render expanded and in their fixed rank order', () => {
    const { container } = renderView(readyAnalysis())
    const section = bandedSection()
    expect(section.closest('details')).toBeNull()
    const labels = within(section)
      .getAllByRole('article')
      .map((article) => article.getAttribute('aria-label'))
    expect(labels).toEqual(BANDED.map((g) => METRIC_LABELS[g.metric]))
    // For makeHeuristics() defaults: 5 banded / 7 unbanded / 0 not measured.
    expect(labels).toHaveLength(5)
    expect(groupDetails(container, 'unbanded')?.querySelectorAll('article')).toHaveLength(7)
    expect(groupDetails(container, 'not-measured')).toBeNull()
  })

  it('keeps the banded order when values and confidences change', () => {
    renderView(
      readyAnalysis(
        makeHeuristics({
          cadence: makeMetric('cadence', { value: 120, confidence: 0.3 }),
          kneeFlexion: makeMetric('kneeFlexion', { value: 170, confidence: 0.99 }),
        }),
      ),
    )
    const labels = within(bandedSection())
      .getAllByRole('article')
      .map((article) => article.getAttribute('aria-label'))
    expect(labels).toEqual(BANDED.map((g) => METRIC_LABELS[g.metric]))
  })

  it('The two other groups render collapsed and expand on demand', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    for (const modifier of ['unbanded', 'not-measured'] as const) {
      const details = groupDetails(container, modifier)
      if (details === null) throw new Error(`missing ${modifier} group`)
      expect(details.open).toBe(false)
      fireEvent.click(details.querySelector('summary') as HTMLElement)
      expect(details.open).toBe(true)
    }
  })

  it('states in the unbanded summary how many there are and why they have no scale', () => {
    const { container } = renderView(readyAnalysis())
    expect(groupDetails(container, 'unbanded')?.querySelector('summary')).toHaveTextContent(
      `${UNBANDED.length} more measurements without a published reference range`,
    )
  })

  it('orders unbanded cards by display rank', () => {
    const { container } = renderView(readyAnalysis())
    const labels = Array.from(
      groupDetails(container, 'unbanded')?.querySelectorAll('article') ?? [],
    ).map((article) => article.getAttribute('aria-label'))
    expect(labels).toEqual(UNBANDED.map((g) => METRIC_LABELS[g.metric]))
  })

  it('omits empty groups entirely — no empty section, no empty details', () => {
    const { container, unmount } = renderView(readyAnalysis(withUnmeasured(ALL_IDS)))
    expect(
      screen.queryByRole('region', { name: 'Compared with published research' }),
    ).not.toBeInTheDocument()
    expect(groupDetails(container, 'unbanded')).toBeNull()
    expect(groupDetails(container, 'not-measured')?.querySelector('summary')).toHaveTextContent(
      '12 metrics not measurable for this clip',
    )
    unmount()

    const second = renderView(readyAnalysis(withUnmeasured(BANDED.map((g) => g.metric))))
    expect(
      screen.queryByRole('region', { name: 'Compared with published research' }),
    ).not.toBeInTheDocument()
    // With no banded group above it, the unbanded summary does not say "more".
    expect(groupDetails(second.container, 'unbanded')?.querySelector('summary')).toHaveTextContent(
      `${UNBANDED.length} measurements without a published reference range`,
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Group 1 — banded cards
// ---------------------------------------------------------------------------------------------

describe('A reference band renders only with its provenance on screen', () => {
  it.each(BANDED.map((g) => [g.metric, g] as const))(
    'A band is shown with its source, population and sample size — %s',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const band = guidance.band!
      const article = card(METRIC_LABELS[guidance.metric])
      const provenance = article.querySelector('.guided-results__provenance') as HTMLElement
      expect(provenance).not.toBeNull()
      // Visible without expanding anything: not inside a <details>, not hidden.
      expect(provenance.closest('details')).toBeNull()
      expect(provenance.closest('[hidden]')).toBeNull()

      const sourceLink = within(provenance)
        .getAllByRole('link')
        .find((a) => a.getAttribute('href') === band.source.url)
      expect(sourceLink).toBeDefined()
      expect(sourceLink).toHaveTextContent(band.source.title)
      expect(provenance).toHaveTextContent(band.source.population)
      const sampleText = /^\d[\d,]*$/.test(band.source.sampleSize)
        ? `n = ${band.source.sampleSize}`
        : band.source.sampleSize
      expect(provenance).toHaveTextContent(sampleText)

      for (const source of band.corroboration) {
        expect(provenance).toHaveTextContent(source.title)
        expect(provenance).toHaveTextContent(source.population)
      }
      if (band.note !== null) expect(provenance).toHaveTextContent(band.note)
      if (band.centralTendency !== null) {
        expect(provenance).toHaveTextContent(band.centralTendency.label)
      }
    },
  )

  it('renders a bare-count sample size as "n = …" and a non-count verbatim', () => {
    renderView(readyAnalysis())
    const counted = BANDED.find((g) => /^\d+$/.test(g.band!.source.sampleSize))
    const uncounted = BANDED.find((g) => !/^\d+$/.test(g.band!.source.sampleSize))
    if (counted) {
      expect(card(METRIC_LABELS[counted.metric])).toHaveTextContent(
        `n = ${counted.band!.source.sampleSize}`,
      )
    }
    if (uncounted) {
      expect(card(METRIC_LABELS[uncounted.metric])).toHaveTextContent(
        uncounted.band!.source.sampleSize,
      )
    }
  })

  it.each(BANDED.map((g) => [g.metric, g] as const))(
    'A derived band says it is derived exactly when its guidance carries a derivation — %s',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const article = card(METRIC_LABELS[guidance.metric])
      const derivation = guidance.band!.derivation
      if (derivation === null) {
        expect(within(article).queryByText('Derived range')).not.toBeInTheDocument()
      } else {
        expect(within(article).getByText('Derived range')).toBeInTheDocument()
        expect(article).toHaveTextContent(derivation.statement)
        for (const definition of derivation.restsOn) {
          expect(article).toHaveTextContent(definition)
        }
      }
    },
  )

  it('At least one shipped band is derived, so the scenario above is exercised', () => {
    expect(BANDED.some((g) => g.band!.derivation !== null)).toBe(true)
  })

  it('A band without provenance does not render', () => {
    const target = BANDED[0]
    const stripped: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      [target.metric]: {
        ...target,
        band: { ...target.band!, source: { ...target.band!.source, population: '' } },
      },
    }
    const entry = guidedGroups(makeHeuristics(), stripped).unbanded.find(
      (e) => e.metric.metric === target.metric,
    )
    if (entry === undefined) throw new Error('expected the stripped metric in the unbanded group')
    const { container } = render(<GuidedMetricCard entry={entry} clipCount={1} />)
    expect(container.querySelector('.metric-scale')).toBeNull()
    expect(container.querySelector('.guided-results__provenance')).toBeNull()
    expect(container.querySelector('.guided-results__no-band')).not.toBeNull()
  })
})

describe('Group 1 cards — scale, headline value and notes', () => {
  it.each(BANDED.map((g) => [g.metric, g] as const))(
    'renders exactly one scale inside the %s card',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const article = card(METRIC_LABELS[guidance.metric])
      expect(article.querySelectorAll('.metric-scale')).toHaveLength(1)
    },
  )

  it('renders no scale anywhere outside the banded cards', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    expect(container.querySelectorAll('.metric-scale')).toHaveLength(BANDED.length)
    expect(groupDetails(container, 'unbanded')?.querySelector('.metric-scale')).toBeNull()
    expect(groupDetails(container, 'not-measured')?.querySelector('.metric-scale')).toBeNull()
  })

  it("prints a banded headline at the band's precision, so it cannot contradict the scale", () => {
    const heuristics = makeHeuristics({ cadence: makeMetric('cadence', { value: 163.5 }) })
    renderView(readyAnalysis(heuristics))
    for (const guidance of BANDED) {
      const value = heuristics[guidance.metric].value as number
      const headline = card(METRIC_LABELS[guidance.metric]).querySelector('.guided-results__value')
      expect(headline).toHaveTextContent(formatMeasuredBandValue(guidance.band!, value))
    }
    // The classic panel's rounding would print 164 — a published bound the value does not sit on.
    expect(card('Cadence').querySelector('.guided-results__value')).not.toHaveTextContent(
      /^164 steps\/min$/,
    )
  })

  it('renders every mandatory note in its own card', () => {
    renderView(readyAnalysis())
    for (const guidance of guidanceInDisplayOrder()) {
      const article = card(METRIC_LABELS[guidance.metric])
      for (const note of guidance.mandatoryNotes) expect(article).toHaveTextContent(note)
    }
  })

  it("renders the metric's own caveat, and a confidence label only for a caveated card", () => {
    renderView(
      readyAnalysis(
        makeHeuristics({
          trunkLean: makeMetric('trunkLean', { confidence: 0.2, caveat: 'Fixture torso caveat.' }),
          kneeFlexion: makeMetric('kneeFlexion', { confidence: 0.5 }),
        }),
      ),
    )
    const trunk = card('Trunk lean')
    expect(within(trunk).getByText('Fixture torso caveat.')).toBeInTheDocument()
    expect(within(trunk).getByText('Low confidence')).toBeInTheDocument()
    expect(within(card('Knee flexion')).getByText('Medium confidence')).toBeInTheDocument()
    expect(within(card('Cadence')).queryByText(/confidence$/)).not.toBeInTheDocument()
  })
})

describe('The speed caveat renders wherever speed materially moves the metric', () => {
  it('A speed-sensitive banded metric carries the caveat (cadence)', () => {
    const speed = METRIC_GUIDANCE.cadence.speedSensitivity
    expect(speed).not.toBeNull()
    renderView(readyAnalysis())
    const note = card('Cadence').querySelector('.guided-results__speed')
    expect(note).not.toBeNull()
    expect(note).toHaveTextContent(speed!.summary)
    if (speed!.withinRunner !== null) expect(note).toHaveTextContent(speed!.withinRunner)
    if (speed!.betweenRunners !== null) expect(note).toHaveTextContent(speed!.betweenRunners)
  })

  it('A metric with no established speed dependence does not carry it (trunkLean)', () => {
    expect(METRIC_GUIDANCE.trunkLean.speedSensitivity).toBeNull()
    renderView(readyAnalysis())
    expect(card('Trunk lean').querySelector('.guided-results__speed')).toBeNull()
  })

  it('renders the caveat on exactly the metrics whose guidance records a speed dependence', () => {
    renderView(readyAnalysis())
    for (const guidance of guidanceInDisplayOrder()) {
      const note = card(METRIC_LABELS[guidance.metric]).querySelector('.guided-results__speed')
      expect(note !== null, guidance.metric).toBe(guidance.speedSensitivity !== null)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Group 2 — unbanded cards
// ---------------------------------------------------------------------------------------------

describe('Banding controls whether a scale renders, not whether the metric renders', () => {
  it.each(UNBANDED.map((g) => [g.metric, g] as const))(
    'An unbanded metric renders its value and its links — %s',
    (_id, guidance) => {
      const heuristics = makeHeuristics()
      const { container } = renderView(readyAnalysis(heuristics))
      const article = card(METRIC_LABELS[guidance.metric])
      expect(groupDetails(container, 'unbanded')?.contains(article)).toBe(true)
      expect(article.querySelector('.guided-results__value')).toHaveTextContent(
        formatGuidedValue(heuristics[guidance.metric]),
      )
      expect(article.querySelector('.metric-scale')).toBeNull()
      const hrefs = within(article)
        .queryAllByRole('link')
        .map((a) => a.getAttribute('href'))
      for (const link of [...guidance.research, ...guidance.remediation]) {
        expect(hrefs).toContain(link.url)
        expect(article).toHaveTextContent(link.summary)
      }
    },
  )

  it.each(UNBANDED.map((g) => [g.metric, g] as const))(
    'An unbanded metric can say why it has no band — %s',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const reason = card(METRIC_LABELS[guidance.metric]).querySelector('.guided-results__no-band')
      expect(reason).toHaveTextContent(guidance.noBandReason!)
    },
  )

  it("puts overstriding in group 2 with its reason, and its intervention links on cadence's card too (D8)", () => {
    const { container } = renderView(readyAnalysis())
    const overstriding = card('Overstriding')
    expect(groupDetails(container, 'unbanded')?.contains(overstriding)).toBe(true)
    expect(overstriding).toHaveTextContent(METRIC_GUIDANCE.overstriding.noBandReason!)

    const cadenceRemediation = card('Cadence').querySelector('.guided-results__links--remediation')
    const hrefs = Array.from(cadenceRemediation?.querySelectorAll('a') ?? []).map((a) =>
      a.getAttribute('href'),
    )
    expect(METRIC_GUIDANCE.overstriding.remediation.length).toBeGreaterThan(0)
    for (const link of METRIC_GUIDANCE.overstriding.remediation) {
      expect(hrefs).toContain(link.url)
    }
  })

  it('separates research links from remediation links under distinct headings', () => {
    renderView(readyAnalysis())
    const cadence = card('Cadence')
    const research = cadence.querySelector('.guided-results__links--research') as HTMLElement
    const remediation = cadence.querySelector('.guided-results__links--remediation') as HTMLElement
    expect(within(research).getByRole('heading', { name: 'What the research says' })).toBeInTheDocument()
    expect(
      within(remediation).getByRole('heading', { name: 'Changes that have been studied' }),
    ).toBeInTheDocument()
    expect(within(research).getAllByRole('link')).toHaveLength(METRIC_GUIDANCE.cadence.research.length)
    expect(within(remediation).getAllByRole('link')).toHaveLength(
      METRIC_GUIDANCE.cadence.remediation.length,
    )
  })

  it('omits a link heading for a metric with no links of that kind', () => {
    const empty = guidanceInDisplayOrder().find(
      (g) => g.research.length === 0 && g.remediation.length === 0,
    )
    if (empty === undefined) return
    renderView(readyAnalysis())
    expect(card(METRIC_LABELS[empty.metric]).querySelector('.guided-results__links')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Group 3 — not measured
// ---------------------------------------------------------------------------------------------

describe('A metric not measured on this clip collapses with a reason and a capture hint', () => {
  it('An excluded metric names its reason and a capture hint', () => {
    const { container } = renderView(
      readyAnalysis(withUnmeasured(['cadence'], 'Fixture reason: the rhythm was too irregular.')),
    )
    const details = groupDetails(container, 'not-measured')!
    expect(details.querySelector('summary')).toHaveTextContent('1 metric not measurable for this clip')
    const entry = details.querySelector('[data-metric="cadence"]') as HTMLElement
    expect(entry).toHaveTextContent('Cadence')
    expect(entry).toHaveTextContent('Fixture reason: the rhythm was too irregular.')
    expect(entry.querySelector('.guided-results__capture-hint')).toHaveTextContent(
      `Suggestion for filming next time: ${METRIC_GUIDANCE.cadence.captureHint}`,
    )
    // Moved, not duplicated: no card for it anywhere.
    expect(screen.queryByRole('article', { name: 'Cadence' })).not.toBeInTheDocument()
  })

  it('The excluded group is collapsed, not omitted', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['trunkLean', 'kneeDrive'])))
    const details = groupDetails(container, 'not-measured')!
    expect(details.open).toBe(false)
    const entries = Array.from(details.querySelectorAll('[data-metric]')).map((el) =>
      el.getAttribute('data-metric'),
    )
    expect(entries).toEqual(ALL_IDS.filter((id) => id === 'trunkLean' || id === 'kneeDrive'))
  })

  it('never renders the value of a measured metric excluded for an unsuitable view', () => {
    const { container } = renderView(
      readyAnalysis(
        makeHeuristics({
          armSwingAmplitude: makeMetric('armSwingAmplitude', {
            value: 0.88,
            viewFit: 'unsuitable',
            caveat: 'Fixture reason: needs a front-facing view.',
          }),
        }),
      ),
    )
    const entry = groupDetails(container, 'not-measured')!.querySelector(
      '[data-metric="armSwingAmplitude"]',
    )
    expect(entry).toHaveTextContent('Fixture reason: needs a front-facing view.')
    expect(container).not.toHaveTextContent('88.0% of torso length')
  })

  it.each([
    ['running', 'Measuring real-world scale with a second look at the clip…'],
    ['pending', 'Measuring real-world scale with a second look at the clip…'],
    ['failed', "A second look at the clip couldn't measure real-world scale."],
    ['idle', 'Fixture reason: no real-world scale.'],
    ['done', 'Fixture reason: no real-world scale.'],
  ] as const)(
    'shows the scale-pass hint for both centimetre metrics under a %s pass',
    (status, reason) => {
      const { container } = renderView(
        readyAnalysis(
          withUnmeasured(['verticalOscillationCm', 'stepWidthCm'], 'Fixture reason: no real-world scale.'),
          status,
        ),
      )
      const details = groupDetails(container, 'not-measured')!
      for (const id of ['verticalOscillationCm', 'stepWidthCm'] as const) {
        const entry = details.querySelector(`[data-metric="${id}"]`) as HTMLElement
        expect(entry).toHaveTextContent(reason)
        expect(entry.querySelector('.guided-results__capture-hint')).toHaveTextContent(
          METRIC_GUIDANCE[id].captureHint,
        )
      }
    },
  )

  it("does not apply the scale-pass hint to a metric that isn't scale-pass-backed", () => {
    const { container } = renderView(
      readyAnalysis(withUnmeasured(['kneeDrive'], 'Fixture reason: no knee.'), 'running'),
    )
    expect(
      groupDetails(container, 'not-measured')!.querySelector('[data-metric="kneeDrive"]'),
    ).toHaveTextContent('Fixture reason: no knee.')
  })

  it('falls back to a generic reason for an excluded metric with no caveat', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'], null)))
    expect(
      groupDetails(container, 'not-measured')!.querySelector('[data-metric="kneeDrive"]'),
    ).toHaveTextContent('Not measurable for this clip.')
  })
})

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

describe('Every outbound reference is from a verified set and opens safely', () => {
  it('Links are https, safely targeted, and from the pinned set', () => {
    const allowed = guidanceUrls()
    const { container } = renderView(readyAnalysis())
    const anchors = Array.from(container.querySelectorAll('a'))
    expect(anchors.length).toBeGreaterThan(0)
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? ''
      expect(href, 'every rendered anchor is an outbound reference').toMatch(/^https:\/\//)
      expect(anchor).toHaveAttribute('target', '_blank')
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer')
      expect(allowed.has(href), href).toBe(true)
    }
  })

  it('renders every URL the guidance holds for a fully measured clip', () => {
    const { container } = renderView(readyAnalysis())
    const rendered = new Set(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href')))
    for (const url of guidanceUrls()) expect(rendered.has(url), url).toBe(true)
  })

  it('gives every link its visible title and supporting summary', () => {
    renderView(readyAnalysis())
    // Scoped to the research list: the same URL can also be the band's source, under its own title.
    const research = card('Cadence').querySelector('.guided-results__links--research') as HTMLElement
    for (const link of METRIC_GUIDANCE.cadence.research) {
      const anchor = within(research)
        .getAllByRole('link')
        .find((a) => a.getAttribute('href') === link.url)
      expect(anchor).toHaveTextContent(link.title)
      expect(anchor?.closest('li')).toHaveTextContent(link.summary)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------

describe('Evidence arrives as input and renders into the card it belongs to', () => {
  it('adopts the given canvas into the matching card, with its caption', () => {
    const plan = framePlan('trunkLean', 'Torso at the widest lean')
    const item = extracted(plan)
    const { container } = renderView(readyAnalysis(), {
      evidence: [{ metric: 'trunkLean', clipIndex: 0, items: [item] }],
    })
    const trunk = card('Trunk lean')
    expect(trunk.querySelector('canvas')).toBe(item.canvas)
    expect(within(trunk).getByText(captionFor(plan))).toBeInTheDocument()
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(card('Cadence').querySelector('canvas')).toBeNull()
  })

  it('renders evidence into an unbanded card too', () => {
    const item = extracted(framePlan('overstriding', 'Foot ahead of the hip at contact'))
    renderView(readyAnalysis(), {
      evidence: [{ metric: 'overstriding', clipIndex: 0, items: [item] }],
    })
    expect(card('Overstriding').querySelector('canvas')).toBe(item.canvas)
  })

  it('names the source clip on a multi-clip session', () => {
    const item = extracted(framePlan('cadence', 'A footstrike'))
    renderView(readyAnalysis(), {
      evidence: [{ metric: 'cadence', clipIndex: 1, items: [item] }],
      clipCount: 3,
    })
    expect(within(card('Cadence')).getByText('From clip 2 of 3.')).toBeInTheDocument()
  })

  it('shows a busy placeholder while a metric’s evidence is pending', () => {
    renderView(readyAnalysis(), {
      evidence: [{ metric: 'kneeFlexion', clipIndex: 0, items: [], pending: true }],
    })
    const knee = card('Knee flexion')
    const placeholder = knee.querySelector('[aria-busy="true"]')
    expect(placeholder).not.toBeNull()
    expect(placeholder).toHaveTextContent('Preparing the frames this was measured from…')
    expect(knee.querySelector('canvas')).toBeNull()
  })

  it('renders no evidence block for a card without evidence', () => {
    const { container } = renderView(readyAnalysis())
    expect(container.querySelector('.guided-results__evidence')).toBeNull()
  })

  it('The guided view does not acquire evidence itself', () => {
    renderView(readyAnalysis(), {
      evidence: [{ metric: 'cadence', clipIndex: 0, items: [extracted(framePlan('cadence', 'x'))] }],
    })
    expect(useSessionEvidenceSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------
// No grading
// ---------------------------------------------------------------------------------------------

describe('A band states where the runner sits, never where they should be', () => {
  const COLOUR_CLASS =
    /\b(bg|text|border|fill|stroke|ring|outline|shadow|from|via|to|decoration|accent)-(red|green|emerald|rose|amber|yellow|lime|orange)-/
  const GRADING_WORD =
    /\b(good|bad|poor|better|worse|best|worst|optimal|ideal|excessive|healthy|unhealthy|target|goal|should|correct|incorrect|normal|abnormal|recommended)\b/i

  /** A page that exercises every branch: all three groups, caveats, evidence, hints. */
  function renderEverything() {
    return renderView(
      readyAnalysis(
        makeHeuristics({
          trunkLean: makeMetric('trunkLean', { confidence: 0.3 }),
          kneeDrive: makeMetric('kneeDrive', { value: null, confidence: 0, caveat: null }),
          stepWidthCm: makeMetric('stepWidthCm', { value: null, confidence: 0, caveat: null }),
        }),
        'failed',
      ),
      {
        evidence: [
          { metric: 'cadence', clipIndex: 0, items: [extracted(framePlan('cadence', 'A footstrike'))] },
          { metric: 'kneeFlexion', clipIndex: 0, items: [], pending: true },
        ],
        clipCount: 2,
      },
    )
  }

  it('No element grades the runner — no hue-graded class on any element', () => {
    const { container } = renderEverything()
    for (const element of container.querySelectorAll('*')) {
      expect(element.getAttribute('class') ?? '').not.toMatch(COLOUR_CLASS)
    }
  })

  it('No element grades the runner — no grading word or icon in the copy this view authors', () => {
    const { container } = renderEverything()
    const clone = container.cloneNode(true) as HTMLElement
    // MetricScale's own wording is pinned by its own suite; this test scans the guided view's copy.
    clone.querySelectorAll('.metric-scale').forEach((node) => node.remove())
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
    const texts: string[] = []
    while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? '')
    for (const element of clone.querySelectorAll('*')) {
      for (const attribute of ['aria-label', 'title', 'alt']) {
        const value = element.getAttribute(attribute)
        if (value !== null) texts.push(value)
      }
    }
    // The guidance record's strings are vetted, with their exemptions, by metricGuidance.test.ts.
    const vetted = guidanceStrings(METRIC_GUIDANCE).sort((a, b) => b.length - a.length)
    const authored = texts.map((text) => vetted.reduce((t, s) => t.split(s).join('\n'), text))
    const joined = authored.join('\n')
    expect(joined.trim().length).toBeGreaterThan(0)
    expect(joined).not.toMatch(GRADING_WORD)
    expect(container.textContent ?? '').not.toMatch(/[✓✔✗✘]/)
  })

  it('A band is worded as a population, not a goal — the central tendency is described, never marked', () => {
    renderView(readyAnalysis())
    for (const guidance of BANDED) {
      const tendency = guidance.band!.centralTendency
      const node = card(METRIC_LABELS[guidance.metric]).querySelector(
        '.guided-results__central-tendency',
      )
      if (tendency === null) {
        expect(node).toBeNull()
      } else {
        expect(node).toHaveTextContent(/^Reported for this population — /)
        expect(node).toHaveTextContent(tendency.label)
      }
    }
  })
})

describe('The guided view changes no measurement', () => {
  it('Selecting the guided view changes nothing that was measured — the result is not mutated', () => {
    const heuristics = makeHeuristics({ cadence: makeMetric('cadence', { value: 163.5 }) })
    const before = structuredClone(heuristics)
    renderView(readyAnalysis(heuristics))
    expect(heuristics).toEqual(before)
  })
})
