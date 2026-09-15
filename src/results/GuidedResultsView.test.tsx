import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuidedMeasurements, GuidedResultsView } from './GuidedResultsView'
import { GuidedMetricCard } from './GuidedMetricCard'
import { MetricsPanel } from './MetricsPanel'
import type { MetricCardEvidence } from './MetricsPanel'
import type { EvidenceFramePlan, EvidenceInstantPlan } from './evidenceFrames'
import { captionFor } from './evidenceCaptions'
import { formatGuidedValue } from './formatGuidedValue'
import {
  WITHHELD_BAND_REASON,
  cardReferences,
  guidedEntryId,
  guidedGroups,
  splitFirstSentence,
} from './guidedGroups'
import type { GuidedEntry } from './guidedGroups'
import { METRIC_LABELS } from './metricConfidence'
import { METRIC_DESCRIPTIONS } from './metricDescriptions'
import type { ScalePassStatus, VideoAnalysisState } from './types'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { METRIC_GUIDANCE, guidanceInDisplayOrder } from '../guidance/metricGuidance'
import { formatMeasuredBandValue } from '../guidance/bandPosition'
import { formatBandValue } from '../guidance/formatBandValue'
import type { BandSource, GuidanceLink, MetricGuidance } from '../guidance/types'
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

function groupSection(container: HTMLElement, modifier: 'unbanded' | 'not-measured') {
  return container.querySelector<HTMLElement>(`section.guided-results__group--${modifier}`)
}

function groupDetails(container: HTMLElement, modifier: 'unbanded' | 'not-measured') {
  return groupSection(container, modifier)?.querySelector<HTMLDetailsElement>('details') ?? null
}

/** A card's visible name: its own `<h3>`, which also names the article. */
function articleLabel(article: Element): string {
  return article.querySelector('h3')?.textContent ?? ''
}

/** The card's one disclosure, or null. */
function disclosure(article: Element): HTMLDetailsElement | null {
  return article.querySelector<HTMLDetailsElement>('details.guided-results__more')
}

/** Is the element outside every `<details>` inside `article` (i.e. visible without a click)? */
function visibleInCard(element: Element): boolean {
  return element.closest('details.guided-results__more') === null
}

function link(url: string, extra: Partial<GuidanceLink> = {}): GuidanceLink {
  return {
    title: `Full title for ${url}`,
    shortTitle: `Short ${url.slice(8, 20)}`,
    url,
    kind: 'peer-reviewed',
    summary: `Summary of ${url}.`,
    ...extra,
  }
}

function source(url: string, extra: Partial<BandSource> = {}): BandSource {
  return {
    title: `Full source title for ${url}`,
    shortTitle: `Source ${url.slice(8, 20)}`,
    url,
    population: `Population measured at ${url}`,
    sampleSize: '42',
    ...extra,
  }
}

/** A measured cadence entry over a fixture guidance record — for branches the shipped data may not reach. */
function cadenceEntry(guidance: Partial<MetricGuidance>): GuidedEntry {
  const base = METRIC_GUIDANCE.cadence
  const merged: MetricGuidance = { ...base, ...guidance }
  return { metric: makeMetric('cadence'), guidance: merged, band: merged.band }
}

/** An unbanded kneeDrive entry over a fixture guidance record. */
function kneeDriveEntry(guidance: Partial<MetricGuidance>): GuidedEntry {
  const base = METRIC_GUIDANCE.kneeDrive
  return {
    metric: makeMetric('kneeDrive'),
    guidance: { ...base, band: null, noBandReason: 'Fixture: no band.', ...guidance },
    band: null,
  }
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
// The contents list
// ---------------------------------------------------------------------------------------------

describe('The contents list names every measurement and reaches it, even inside a closed group', () => {
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname)
  })

  function contents(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Measurements on this page' })
  }

  it('sits directly under the status line, above the first group', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    const status = screen.getByRole('status')
    const nav = contents()
    const firstGroup = container.querySelector('section.guided-results__group')!
    expect(status.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nav.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lists all twelve in page order, each with its value or "not measured", and no zone words', () => {
    const heuristics = makeHeuristics({
      cadence: makeMetric('cadence', { value: 163.5 }),
      kneeDrive: makeMetric('kneeDrive', { value: null, confidence: 0 }),
      stepWidth: makeMetric('stepWidth', { value: 0.4, viewFit: 'unsuitable' }),
    })
    const { container } = renderView(readyAnalysis(heuristics))
    const { banded, unbanded, notMeasured } = guidedGroups(heuristics)
    const pageOrder = [...banded, ...unbanded, ...notMeasured].map((e) => e.metric.metric)
    const items = within(contents()).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-metric'))).toEqual(pageOrder)

    for (const item of items) {
      const id = item.getAttribute('data-metric') as MetricId
      const anchor = within(item).getByRole('link')
      expect(anchor).toHaveAttribute('href', `#${guidedEntryId(id)}`)
      expect(container.querySelector(`#${guidedEntryId(id)}`)).not.toBeNull()
      expect(anchor).toHaveTextContent(METRIC_LABELS[id])
      const value = item.querySelector('.guided-results__contents-value')
      if (notMeasured.some((e) => e.metric.metric === id)) {
        expect(value).toHaveTextContent(/^not measured$/)
      } else {
        const onCard = container.querySelector(`#${guidedEntryId(id)} .guided-results__value`)
        expect(value?.textContent).toBe(onCard?.textContent)
      }
    }
    // A measured value excluded for its view never prints, here either.
    expect(contents()).not.toHaveTextContent('40.0% of torso length')
    // Values only: no zone label from any band.
    for (const g of BANDED) {
      for (const zone of g.band!.zones) expect(contents()).not.toHaveTextContent(zone.label)
    }
  })

  it('opens the closed group holding a card when its link is clicked', () => {
    const { container } = renderView(readyAnalysis())
    const target = UNBANDED[0].metric
    const details = groupDetails(container, 'unbanded')!
    expect(details.open).toBe(false)
    fireEvent.click(within(contents()).getByRole('link', { name: new RegExp(METRIC_LABELS[target]) }))
    expect(details.open).toBe(true)
  })

  it('opens the not-measured group when a not-measured entry is clicked', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    const details = groupDetails(container, 'not-measured')!
    const anchor = container.querySelector<HTMLAnchorElement>(`a[href="#${guidedEntryId('kneeDrive')}"]`)!
    fireEvent.click(anchor)
    expect(details.open).toBe(true)
  })

  it('opens the group when the address changes to a card inside it', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    const details = groupDetails(container, 'not-measured')!
    expect(details.open).toBe(false)
    act(() => {
      window.history.replaceState(null, '', `#${guidedEntryId('kneeDrive')}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(details.open).toBe(true)
    expect(document.activeElement).toBe(container.querySelector(`#${guidedEntryId('kneeDrive')}`))
  })

  it('opens the group on mount when the page loads with a card in the address', () => {
    window.history.replaceState(null, '', `#${guidedEntryId(UNBANDED[1].metric)}`)
    const { container } = renderView(readyAnalysis())
    expect(groupDetails(container, 'unbanded')!.open).toBe(true)
    expect(groupDetails(container, 'not-measured')).toBeNull()
  })

  it('ignores a fragment that names nothing in the view', () => {
    window.history.replaceState(null, '', '#somewhere-else')
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    expect(groupDetails(container, 'unbanded')!.open).toBe(false)
    expect(groupDetails(container, 'not-measured')!.open).toBe(false)
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
    const labels = within(section).getAllByRole('article').map(articleLabel)
    expect(labels).toEqual(BANDED.map((g) => METRIC_LABELS[g.metric]))
    // For makeHeuristics() defaults: 5 banded / 7 unbanded / 0 not measured.
    expect(labels).toHaveLength(5)
    expect(groupDetails(container, 'unbanded')?.querySelectorAll('article')).toHaveLength(7)
    expect(groupSection(container, 'not-measured')).toBeNull()
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
    const labels = within(bandedSection()).getAllByRole('article').map(articleLabel)
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

  it('titles each collapsed group with a real heading, and names every measurement inside in its summary', () => {
    const heuristics = withUnmeasured(['kneeDrive', 'trunkLean'])
    const { container } = renderView(readyAnalysis(heuristics))
    const { unbanded, notMeasured } = guidedGroups(heuristics)
    const names = (entries: GuidedEntry[]) =>
      entries.map((e) => METRIC_LABELS[e.metric.metric]).join(', ')

    const unbandedSection = screen.getByRole('region', { name: 'Measured, no published range' })
    expect(unbandedSection.querySelector('summary h2')).toBeNull()
    expect(unbandedSection.querySelector('summary')).toHaveTextContent(
      `${unbanded.length} measurements: ${names(unbanded)}`,
    )
    expect(unbandedSection).toBe(groupSection(container, 'unbanded'))

    const notMeasuredSection = screen.getByRole('region', { name: 'Not measured on this clip' })
    expect(notMeasuredSection.querySelector('summary')).toHaveTextContent(
      `2 measurements: ${names(notMeasured)}`,
    )
    // "measurements", never "metrics", in the view's own group copy.
    for (const section of [unbandedSection, notMeasuredSection]) {
      expect(section.querySelector('h2')!.textContent).not.toMatch(/metric/i)
      expect(section.querySelector('summary')!.textContent).not.toMatch(/metric/i)
    }
  })

  it('says "1 measurement" in the singular', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    expect(groupDetails(container, 'not-measured')!.querySelector('summary')).toHaveTextContent(
      /^1 measurement: Knee drive$/,
    )
  })

  it('orders unbanded cards by display rank', () => {
    const { container } = renderView(readyAnalysis())
    const labels = Array.from(groupDetails(container, 'unbanded')?.querySelectorAll('article') ?? []).map(
      articleLabel,
    )
    expect(labels).toEqual(UNBANDED.map((g) => METRIC_LABELS[g.metric]))
  })

  it('omits empty groups entirely — no empty section, no empty details', () => {
    const { container, unmount } = renderView(readyAnalysis(withUnmeasured(ALL_IDS)))
    expect(
      screen.queryByRole('region', { name: 'Compared with published research' }),
    ).not.toBeInTheDocument()
    expect(groupSection(container, 'unbanded')).toBeNull()
    expect(groupDetails(container, 'not-measured')?.querySelector('summary')).toHaveTextContent(
      /^12 measurements: /,
    )
    unmount()
    const second = renderView(readyAnalysis(withUnmeasured(BANDED.map((g) => g.metric))))
    expect(
      screen.queryByRole('region', { name: 'Compared with published research' }),
    ).not.toBeInTheDocument()
    expect(groupDetails(second.container, 'unbanded')?.querySelector('summary')).toHaveTextContent(
      new RegExp(`^${UNBANDED.length} measurements: `),
    )
  })

  it('frames a banded card, and separates a card inside a framed group with a top rule instead', () => {
    const { container } = renderView(readyAnalysis())
    const bandedCard = within(bandedSection()).getAllByRole('article')[0]
    expect(bandedCard.className).toMatch(/(^|\s)border-2(\s|$)/)
    for (const article of groupDetails(container, 'unbanded')!.querySelectorAll('article')) {
      expect(article.className).toMatch(/(^|\s)border-t-2(\s|$)/)
      expect(article.className).not.toMatch(/(^|\s)border-2(\s|$)/)
    }
  })
})

describe('The heading outline reads group → measurement', () => {
  it('gives every measurement an h3 whose nearest preceding h2 is its own group’s heading', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive', 'cadence'])))
    const h2s = Array.from(container.querySelectorAll('h2'))
    expect(h2s).toHaveLength(3)
    for (const h2 of h2s) expect(h2.closest('summary')).toBeNull()
    const h3s = Array.from(container.querySelectorAll('h3'))
    expect(h3s).toHaveLength(12)
    for (const h3 of h3s) {
      const preceding = h2s.filter(
        (h2) => h2.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
      const nearest = preceding[preceding.length - 1]
      const group = h3.closest('section.guided-results__group')!
      expect(nearest, h3.textContent ?? '').toBe(
        document.getElementById(group.getAttribute('aria-labelledby')!),
      )
    }
  })

  it('names each card by its h3 rather than a duplicate aria-label', () => {
    renderView(readyAnalysis())
    for (const article of screen.getAllByRole('article')) {
      expect(article).not.toHaveAttribute('aria-label')
      const heading = article.querySelector('h3')!
      expect(article).toHaveAttribute('aria-labelledby', heading.id)
      expect(article).toHaveAccessibleName(heading.textContent!)
    }
  })

  it('names each not-measured entry with an h3', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive', 'stepWidthCm'])))
    for (const entry of container.querySelectorAll('.guided-results__not-measured-entry')) {
      const id = entry.getAttribute('data-metric') as MetricId
      expect(entry.querySelector('h3')).toHaveTextContent(METRIC_LABELS[id])
    }
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
      expect(sourceLink).toHaveTextContent(band.source.shortTitle)
      expect(provenance).toHaveTextContent(band.source.title)
      expect(provenance).toHaveTextContent(band.source.population)
      const sampleText = /^\d[\d,]*$/.test(band.source.sampleSize)
        ? `n = ${band.source.sampleSize}`
        : band.source.sampleSize
      expect(provenance).toHaveTextContent(sampleText)

      // Everything else about the band waits in the card's disclosure.
      const more = disclosure(article)
      for (const corroborating of band.corroboration) {
        expect(more).toHaveTextContent(corroborating.population)
      }
      if (band.note !== null) expect(more?.querySelector('.guided-results__band-note')).toHaveTextContent(band.note)
      if (band.centralTendency !== null) {
        expect(more?.querySelector('.guided-results__central-tendency')).toHaveTextContent(
          band.centralTendency.label,
        )
      }
    },
  )

  it('renders a bare-count sample size as "n = …" and a non-count verbatim', () => {
    const counted = cadenceEntry({
      band: { ...METRIC_GUIDANCE.cadence.band!, source: source('https://counted.example/', { sampleSize: '860' }) },
    })
    const { unmount } = render(<GuidedMetricCard entry={counted} clipCount={1} />)
    expect(document.querySelector('.guided-results__provenance')).toHaveTextContent('n = 860')
    unmount()
    const uncounted = cadenceEntry({
      band: {
        ...METRIC_GUIDANCE.cadence.band!,
        source: source('https://uncounted.example/', { sampleSize: 'Not published' }),
      },
    })
    render(<GuidedMetricCard entry={uncounted} clipCount={1} />)
    const provenance = document.querySelector('.guided-results__provenance')
    expect(provenance).toHaveTextContent('Not published')
    expect(provenance).not.toHaveTextContent('n = Not published')
  })

  it('shows the full source title only when it differs from the short one', () => {
    const same = source('https://same.example/', { title: 'Same words', shortTitle: 'Same words' })
    render(
      <GuidedMetricCard
        entry={cadenceEntry({ band: { ...METRIC_GUIDANCE.cadence.band!, source: same } })}
        clipCount={1}
      />,
    )
    expect(document.querySelector('.guided-results__provenance .guided-results__full-title')).toBeNull()
  })

  it.each(BANDED.map((g) => [g.metric, g] as const))(
    'A derived band says it is derived, visibly, exactly when its guidance carries a derivation — %s',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const article = card(METRIC_LABELS[guidance.metric])
      const derivation = guidance.band!.derivation
      if (derivation === null) {
        expect(within(article).queryByText('Derived range')).not.toBeInTheDocument()
      } else {
        const label = within(article).getByText('Derived range')
        expect(visibleInCard(label)).toBe(true)
        expect(label.closest('.guided-results__provenance')).not.toBeNull()
        expect(article.querySelector('.guided-results__derivation')).toHaveTextContent(derivation.statement)
        const restsOn = article.querySelector('.guided-results__derivation-rests-on')
        if (derivation.restsOn.length > 0) {
          expect(restsOn).not.toBeNull()
          expect(visibleInCard(restsOn!)).toBe(false)
          for (const definition of derivation.restsOn) expect(restsOn).toHaveTextContent(definition)
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
    expect(container.querySelector('.guided-results__no-band')).toHaveTextContent(WITHHELD_BAND_REASON)
  })

  it('does not put a withheld band under copy claiming no published range exists', () => {
    const target = BANDED[0]
    const stripped: Record<MetricId, MetricGuidance> = {
      ...METRIC_GUIDANCE,
      [target.metric]: {
        ...target,
        band: { ...target.band!, source: { ...target.band!.source, sampleSize: ' ' } },
      },
    }
    const { container } = render(
      <GuidedMeasurements
        heuristics={makeHeuristics()}
        scalePassStatus="idle"
        evidence={[]}
        clipCount={1}
        guidance={stripped}
      />,
    )
    const section = groupSection(container, 'unbanded')!
    expect(section.contains(card(METRIC_LABELS[target.metric]))).toBe(true)
    expect(section.querySelector('h2')).toHaveTextContent('Measured, no range shown')
    expect(section).not.toHaveTextContent(/no published range/i)
    expect(card(METRIC_LABELS[target.metric]).querySelector('.guided-results__no-band')).toHaveTextContent(
      WITHHELD_BAND_REASON,
    )
  })

  it('titles the unbanded group "no published range" when every metric in it genuinely has none', () => {
    const { container } = renderView(readyAnalysis())
    expect(groupSection(container, 'unbanded')!.querySelector('h2')).toHaveTextContent(
      'Measured, no published range',
    )
  })
})

describe('Group 1 cards — scale, headline value and notes', () => {
  it.each(BANDED.map((g) => [g.metric, g] as const))(
    'renders exactly one scale inside the %s card, visible',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const article = card(METRIC_LABELS[guidance.metric])
      const scales = article.querySelectorAll('.metric-scale')
      expect(scales).toHaveLength(1)
      expect(visibleInCard(scales[0])).toBe(true)
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

  it('shows the first sentence of every mandatory note on the card, and the rest in its disclosure', () => {
    renderView(readyAnalysis())
    let continued = 0
    for (const guidance of guidanceInDisplayOrder()) {
      const article = card(METRIC_LABELS[guidance.metric])
      const visible = Array.from(article.querySelectorAll('.guided-results__notes [role="note"]'))
      expect(visible).toHaveLength(guidance.mandatoryNotes.length)
      guidance.mandatoryNotes.forEach((note, index) => {
        const { first, rest } = splitFirstSentence(note)
        expect(visible[index].textContent).toBe(first)
        expect(visibleInCard(visible[index])).toBe(true)
        if (rest.length > 0) {
          continued++
          expect(disclosure(article)?.querySelector('.guided-results__notes-more')).toHaveTextContent(rest)
        }
      })
    }
    expect(continued, 'some shipped note runs past one sentence').toBeGreaterThan(0)
  })

  it('renders a one-sentence note whole and adds nothing to the disclosure for it', () => {
    render(
      <GuidedMetricCard
        entry={kneeDriveEntry({ mandatoryNotes: ['Just the one sentence.'], research: [], remediation: [] })}
        clipCount={1}
      />,
    )
    expect(screen.getByRole('note')).toHaveTextContent(/^Just the one sentence\.$/)
    expect(document.querySelector('details')).toBeNull()
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

  it('keeps the always-visible parts in reading order: label, value, description, caveat, scale, provenance, speed, notes, studies', () => {
    renderView(
      readyAnalysis(makeHeuristics({ cadence: makeMetric('cadence', { caveat: 'Fixture caveat.' }) })),
    )
    const article = card('Cadence')
    const order = [
      'h3',
      '.guided-results__value',
      '.guided-results__description',
      '.guided-results__caveat',
      '.metric-scale',
      '.guided-results__provenance',
      '.guided-results__speed',
      '.guided-results__notes',
      '.guided-results__links--remediation',
      'details.guided-results__more',
    ].map((selector) => article.querySelector(selector))
    expect(order.every((node) => node !== null)).toBe(true)
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${i}`,
      ).toBeTruthy()
    }
  })

  it('uses the guided description when the guidance carries one, and the shared one otherwise', () => {
    const { unmount } = render(
      <GuidedMetricCard entry={kneeDriveEntry({ guidedDescription: 'Fixture guided description.' })} clipCount={1} />,
    )
    expect(document.querySelector('.guided-results__description')).toHaveTextContent(
      /^Fixture guided description\.$/,
    )
    unmount()
    render(<GuidedMetricCard entry={kneeDriveEntry({ guidedDescription: null })} clipCount={1} />)
    expect(document.querySelector('.guided-results__description')).toHaveTextContent(
      METRIC_DESCRIPTIONS.kneeDrive,
    )
  })
})

describe("A card's disclosure holds the rest, and counts its sources", () => {
  it('summarises a banded card as how the range was built plus its source count', () => {
    renderView(readyAnalysis())
    let counted = 0
    for (const guidance of BANDED) {
      const article = card(METRIC_LABELS[guidance.metric])
      const entry = guidedGroups(makeHeuristics()).banded.find((e) => e.metric.metric === guidance.metric)!
      const n = cardReferences(entry).disclosureSourceCount
      const summary = disclosure(article)?.querySelector('summary')
      if (n === 0) {
        expect(summary ?? null).toSatisfy(
          (node: Element | null) => node === null || node.textContent === 'How this range was built',
        )
      } else {
        counted++
        expect(summary).toHaveTextContent(
          `How this range was built, and the research (${n} ${n === 1 ? 'source' : 'sources'})`,
        )
        const linked = new Set(
          Array.from(disclosure(article)!.querySelectorAll('a')).map((a) => a.getAttribute('href')),
        )
        expect(linked.size).toBe(n)
      }
    }
    expect(counted, 'some shipped band has research behind its disclosure').toBeGreaterThan(0)
  })

  it('summarises a banded card with no linked sources inside as just how the range was built', () => {
    const entry = cadenceEntry({
      band: { ...METRIC_GUIDANCE.cadence.band!, source: source('https://only-source.example/'), corroboration: [] },
      research: [],
      remediation: [],
      mandatoryNotes: [],
    })
    render(<GuidedMetricCard entry={entry} clipCount={1} />)
    expect(document.querySelector('details summary')).toHaveTextContent(/^How this range was built$/)
  })

  it('summarises an unbanded card as the research with its source count', () => {
    const entry = kneeDriveEntry({
      research: [link('https://one.example/'), link('https://two.example/')],
      remediation: [],
    })
    render(<GuidedMetricCard entry={entry} clipCount={1} />)
    expect(document.querySelector('details summary')).toHaveTextContent(/^The research \(2 sources\)$/)
  })

  it('renders research links, with summaries, only inside the disclosure', () => {
    renderView(readyAnalysis())
    const article = card('Cadence')
    const research = article.querySelector('.guided-results__links--research') as HTMLElement
    expect(research).not.toBeNull()
    expect(visibleInCard(research)).toBe(false)
    expect(within(research).getByRole('heading', { name: 'What the research says' })).toBeInTheDocument()
  })

  it('renders the band note and the central statistic as "{label}: {value}", inside the disclosure', () => {
    renderView(readyAnalysis())
    for (const guidance of BANDED) {
      const tendency = guidance.band!.centralTendency
      const node = card(METRIC_LABELS[guidance.metric]).querySelector('.guided-results__central-tendency')
      if (tendency === null) {
        expect(node).toBeNull()
      } else {
        expect(node?.textContent).toBe(
          `${tendency.label}: ${formatBandValue(tendency.value, guidance.band!.unit)}`,
        )
        expect(visibleInCard(node!)).toBe(false)
      }
    }
  })

  it('renders no disclosure on a card with nothing more to say', () => {
    render(
      <GuidedMetricCard
        entry={kneeDriveEntry({ mandatoryNotes: [], research: [], remediation: [link('https://only.example/')] })}
        clipCount={1}
      />,
    )
    expect(document.querySelector('details')).toBeNull()
  })
})

describe('The speed caveat renders wherever speed materially moves the metric', () => {
  it('A speed-sensitive banded metric carries the caveat (cadence)', () => {
    const speed = METRIC_GUIDANCE.cadence.speedSensitivity
    expect(speed).not.toBeNull()
    renderView(readyAnalysis())
    const note = card('Cadence').querySelector('.guided-results__speed')
    expect(note).not.toBeNull()
    expect(visibleInCard(note!)).toBe(true)
    expect(note).toHaveTextContent(speed!.summary)
  })

  it('labels the two halves "As one runner speeds up:" and "Across different runners:" as a two-item list', () => {
    const speed = { summary: 'Fixture summary.', withinRunner: 'Fixture within.', betweenRunners: 'Fixture between.' }
    const { unmount } = render(
      <GuidedMetricCard entry={kneeDriveEntry({ speedSensitivity: speed })} clipCount={1} />,
    )
    const note = document.querySelector('.guided-results__speed')!
    const items = within(note as HTMLElement).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'As one runner speeds up: Fixture within.',
      'Across different runners: Fixture between.',
    ])
    unmount()

    render(
      <GuidedMetricCard
        entry={kneeDriveEntry({ speedSensitivity: { ...speed, withinRunner: null, betweenRunners: null } })}
        clipCount={1}
      />,
    )
    expect(document.querySelector('.guided-results__speed ul')).toBeNull()
    expect(document.querySelector('.guided-results__speed')).toHaveTextContent('Fixture summary.')
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
      for (const reference of [...guidance.research, ...guidance.remediation]) {
        expect(hrefs.filter((href) => href === reference.url), reference.url).toHaveLength(1)
      }
    },
  )

  it.each(UNBANDED.map((g) => [g.metric, g] as const))(
    'An unbanded metric can say why it has no band, visibly — %s',
    (_id, guidance) => {
      renderView(readyAnalysis())
      const reason = card(METRIC_LABELS[guidance.metric]).querySelector('.guided-results__no-band')
      expect(reason).toHaveTextContent(guidance.noBandReason!)
      expect(visibleInCard(reason!)).toBe(true)
    },
  )

  it.each(guidanceInDisplayOrder().map((g) => [g.metric, g] as const))(
    'every measured card carries its description — %s',
    (id, guidance) => {
      renderView(readyAnalysis())
      const description = card(METRIC_LABELS[id]).querySelector('.guided-results__description')
      expect(description).toHaveTextContent(guidance.guidedDescription ?? METRIC_DESCRIPTIONS[id])
    },
  )

  it("prints every unbanded measured value exactly as the classic panel does, from the same heuristics", () => {
    const heuristics = makeHeuristics({
      overstriding: makeMetric('overstriding', { value: 0.3257 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: -0.12 }),
      kneeDrive: makeMetric('kneeDrive', { value: 47.26 }),
    })
    const guided = renderView(readyAnalysis(heuristics))
    const unbanded = guidedGroups(heuristics).unbanded
    expect(unbanded.length).toBeGreaterThan(0)
    const guidedValues = new Map(
      unbanded.map((entry) => [
        entry.metric.metric,
        card(METRIC_LABELS[entry.metric.metric]).querySelector('.guided-results__value')?.textContent,
      ]),
    )
    guided.unmount()

    render(<MetricsPanel heuristics={heuristics} />)
    for (const entry of unbanded) {
      const label = METRIC_LABELS[entry.metric.metric]
      const classic = screen
        .getAllByRole('article')
        .find((article) => article.querySelector('h3')?.textContent === label)
      expect(classic, label).toBeDefined()
      expect(classic!.querySelector('.metrics-panel__value')?.textContent, label).toBe(
        guidedValues.get(entry.metric.metric),
      )
    }
  })

  it("puts overstriding in group 2 with its reason, and its intervention links on cadence's card too (D8)", () => {
    const { container } = renderView(readyAnalysis())
    const overstriding = card('Overstriding')
    expect(groupDetails(container, 'unbanded')?.contains(overstriding)).toBe(true)
    expect(overstriding).toHaveTextContent(METRIC_GUIDANCE.overstriding.noBandReason!)

    // Attached to cadence as well (D8). Where cadence's band or research already links the same
    // URL, the card renders it there instead — each URL once per card — so presence is the claim.
    const shown = new Set(
      Array.from(card('Cadence').querySelectorAll('a')).map((a) => a.getAttribute('href')),
    )
    expect(METRIC_GUIDANCE.overstriding.remediation.length).toBeGreaterThan(0)
    for (const reference of METRIC_GUIDANCE.overstriding.remediation) {
      expect(shown.has(reference.url), reference.url).toBe(true)
    }
  })
})

describe('What runners have tried in studies', () => {
  const four = ['a', 'b', 'c', 'd'].map((x) => link(`https://${x}.example/`))

  it('shows up to three studies visibly, as short-title links with the full title and no summary', () => {
    render(<GuidedMetricCard entry={kneeDriveEntry({ remediation: four, research: [] })} clipCount={1} />)
    const visible = document.querySelector('.guided-results__links--remediation') as HTMLElement
    expect(visibleInCard(visible)).toBe(true)
    expect(within(visible).getByRole('heading', { name: 'What runners have tried in studies' })).toBeInTheDocument()
    const anchors = within(visible).getAllByRole('link')
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(four.slice(0, 3).map((l) => l.url))
    four.slice(0, 3).forEach((reference, index) => {
      expect(anchors[index]).toHaveTextContent(reference.shortTitle)
      expect(anchors[index].closest('li')).toHaveTextContent(reference.title)
      expect(visible).not.toHaveTextContent(reference.summary)
    })
    const more = document.querySelector('details .guided-results__links--remediation-more') as HTMLElement
    expect(within(more).getByRole('link')).toHaveAttribute('href', four[3].url)
    expect(more).toHaveTextContent(four[3].summary)
  })

  it('renders the remediation intro above the list when there is one, and nothing when there is not', () => {
    const { unmount } = render(
      <GuidedMetricCard
        entry={kneeDriveEntry({ remediation: four.slice(0, 1), remediationIntro: 'Fixture intro.' })}
        clipCount={1}
      />,
    )
    const intro = document.querySelector('.guided-results__remediation-intro')!
    expect(intro).toHaveTextContent(/^Fixture intro\.$/)
    const list = document.querySelector('.guided-results__links--remediation ul')!
    expect(intro.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()

    render(
      <GuidedMetricCard entry={kneeDriveEntry({ remediation: four.slice(0, 1), remediationIntro: null })} clipCount={1} />,
    )
    expect(document.querySelector('.guided-results__remediation-intro')).toBeNull()
  })

  it("renders the shipped intro on the card whose guidance carries one", () => {
    const withIntro = guidanceInDisplayOrder().filter((g) => g.remediationIntro !== null)
    renderView(readyAnalysis())
    for (const guidance of withIntro) {
      expect(
        card(METRIC_LABELS[guidance.metric]).querySelector('.guided-results__remediation-intro'),
      ).toHaveTextContent(guidance.remediationIntro!)
    }
  })

  it('omits the link headings for a metric with no links of either kind', () => {
    render(<GuidedMetricCard entry={kneeDriveEntry({ research: [], remediation: [] })} clipCount={1} />)
    expect(document.querySelector('.guided-results__links')).toBeNull()
  })

  it('renders a URL at most once per card, even when research, remediation and the band share it', () => {
    const shared = 'https://shared.example/'
    const entry = cadenceEntry({
      band: { ...METRIC_GUIDANCE.cadence.band!, source: source(shared), corroboration: [source(shared)] },
      research: [link(shared), link('https://research.example/')],
      remediation: [link(shared), link('https://research.example/')],
    })
    const { container } = render(<GuidedMetricCard entry={entry} clipCount={1} />)
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs.filter((href) => href === shared)).toHaveLength(1)
    expect(hrefs.filter((href) => href === 'https://research.example/')).toHaveLength(1)
    // The corroborating source still shows its population, without a second link.
    expect(container.querySelector('.guided-results__corroboration')).toHaveTextContent(
      `Population measured at ${shared}`,
    )
  })

  it('never renders a URL twice on any shipped card', () => {
    renderView(readyAnalysis())
    for (const article of screen.getAllByRole('article')) {
      const hrefs = Array.from(article.querySelectorAll('a')).map((a) => a.getAttribute('href'))
      expect(new Set(hrefs).size, articleLabel(article)).toBe(hrefs.length)
    }
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
    expect(details.querySelector('summary')).toHaveTextContent('1 measurement: Cadence')
    const entry = details.querySelector('[data-metric="cadence"]') as HTMLElement
    expect(entry.querySelector('h3')).toHaveTextContent('Cadence')
    expect(entry.querySelector('.guided-results__not-measured-reason')).toHaveTextContent(
      'Fixture reason: the rhythm was too irregular.',
    )
    expect(entry.querySelector('.guided-results__capture-hint')).toHaveTextContent(
      `To measure this next time: ${METRIC_GUIDANCE.cadence.captureHints.notEnoughData}`,
    )
    // Moved, not duplicated: no card for it anywhere.
    expect(screen.queryByRole('article', { name: 'Cadence' })).not.toBeInTheDocument()
  })

  it('gives the camera-angle hint when the view was unsuitable, and the not-enough-data hint otherwise', () => {
    const { container } = renderView(
      readyAnalysis(
        makeHeuristics({
          stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable', caveat: 'Fixture: wrong angle.' }),
          kneeDrive: makeMetric('kneeDrive', { value: null, confidence: 0, caveat: 'Fixture: too few.' }),
        }),
      ),
    )
    const details = groupDetails(container, 'not-measured')!
    const hint = (id: MetricId) =>
      details.querySelector(`[data-metric="${id}"] .guided-results__capture-hint`)?.textContent
    expect(hint('stepWidth')).toBe(`To measure this next time: ${METRIC_GUIDANCE.stepWidth.captureHints.wrongAngle}`)
    expect(hint('kneeDrive')).toBe(
      `To measure this next time: ${METRIC_GUIDANCE.kneeDrive.captureHints.notEnoughData}`,
    )
    expect(METRIC_GUIDANCE.stepWidth.captureHints.wrongAngle).not.toBe(
      METRIC_GUIDANCE.stepWidth.captureHints.notEnoughData,
    )
  })

  it('puts the hint first in body weight, and the reason after it muted', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    const entry = groupDetails(container, 'not-measured')!.querySelector('[data-metric="kneeDrive"]')!
    const hint = entry.querySelector('.guided-results__capture-hint')!
    const reason = entry.querySelector('.guided-results__not-measured-reason')!
    expect(hint.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hint.className).toContain('text-neutral-700')
    expect(reason.className).toContain('text-neutral-600')
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
        expect(entry.querySelector('.guided-results__not-measured-reason')).toHaveTextContent(reason)
        expect(entry.querySelector('.guided-results__capture-hint')).toHaveTextContent(
          METRIC_GUIDANCE[id].captureHints.notEnoughData,
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
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    const anchors = Array.from(container.querySelectorAll('a'))
    const outbound = anchors.filter((anchor) => !(anchor.getAttribute('href') ?? '').startsWith('#'))
    expect(outbound.length).toBeGreaterThan(0)
    for (const anchor of outbound) {
      const href = anchor.getAttribute('href') ?? ''
      expect(href, 'every outbound anchor is https').toMatch(/^https:\/\//)
      expect(anchor).toHaveAttribute('target', '_blank')
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer')
      expect(allowed.has(href), href).toBe(true)
    }
  })

  it('has no in-page anchor except the contents list, and every one of those resolves in the view', () => {
    const { container } = renderView(readyAnalysis(withUnmeasured(['kneeDrive'])))
    const inPage = Array.from(container.querySelectorAll('a')).filter((anchor) =>
      (anchor.getAttribute('href') ?? '').startsWith('#'),
    )
    expect(inPage).toHaveLength(12)
    for (const anchor of inPage) {
      expect(anchor.closest('nav')).not.toBeNull()
      expect(anchor).not.toHaveAttribute('target')
      expect(container.querySelector(anchor.getAttribute('href')!)).not.toBeNull()
    }
  })

  it('renders every URL the guidance holds for a fully measured clip', () => {
    const { container } = renderView(readyAnalysis())
    const rendered = new Set(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href')))
    for (const url of guidanceUrls()) expect(rendered.has(url), url).toBe(true)
  })

  it('gives every research link its short title, full title and summary', () => {
    renderView(readyAnalysis())
    const research = card('Cadence').querySelector('.guided-results__links--research') as HTMLElement
    const anchors = within(research).getAllByRole('link')
    expect(anchors.length).toBeGreaterThan(0)
    for (const anchor of anchors) {
      const reference = METRIC_GUIDANCE.cadence.research.find((l) => l.url === anchor.getAttribute('href'))!
      expect(anchor).toHaveTextContent(reference.shortTitle)
      expect(anchor.closest('li')).toHaveTextContent(reference.title)
      expect(anchor.closest('li')).toHaveTextContent(reference.summary)
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

  it('places each of twelve distinct canvases once, in its own card, and none for an excluded metric', () => {
    const excluded: MetricId[] = ['kneeDrive', 'stepWidthCm', 'cadence']
    const evidence = ALL_IDS.map((id) => ({
      metric: id,
      clipIndex: 0,
      items: [extracted(framePlan(id, `Frame for ${id}`))],
    }))
    const { container } = renderView(readyAnalysis(withUnmeasured(excluded)), { evidence })
    const canvases = Array.from(container.querySelectorAll('canvas'))
    expect(canvases).toHaveLength(ALL_IDS.length - excluded.length)
    for (const entry of evidence) {
      const canvas = entry.items[0].canvas
      if (excluded.includes(entry.metric)) {
        expect(container.contains(canvas), entry.metric).toBe(false)
        continue
      }
      expect(canvases.filter((c) => c === canvas), entry.metric).toHaveLength(1)
      expect(canvas.closest('article')?.getAttribute('data-metric'), entry.metric).toBe(entry.metric)
      // Beside the scale or the reason, never hidden in the disclosure.
      expect(canvas.closest('details.guided-results__more'), entry.metric).toBeNull()
    }
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
          stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }),
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
    // Split sentences are vetted with their notes, so strip both halves too.
    const vetted = guidanceStrings(METRIC_GUIDANCE)
    const halves = Object.values(METRIC_GUIDANCE).flatMap((g) =>
      g.mandatoryNotes.flatMap((note) => Object.values(splitFirstSentence(note))),
    )
    const strip = [...vetted, ...halves].filter(Boolean).sort((a, b) => b.length - a.length)
    const authored = texts.map((text) => strip.reduce((t, s) => t.split(s).join('\n'), text))
    const joined = authored.join('\n')
    expect(joined.trim().length).toBeGreaterThan(0)
    expect(joined).not.toMatch(GRADING_WORD)
    expect(container.textContent ?? '').not.toMatch(/[✓✔✗✘]/)
  })

  it('A band is worded as a population, not a goal — the population is on screen beside the range', () => {
    renderView(readyAnalysis())
    for (const guidance of BANDED) {
      const article = card(METRIC_LABELS[guidance.metric])
      const provenance = article.querySelector('.guided-results__provenance')!
      expect(within(provenance as HTMLElement).getByText('Population')).toBeInTheDocument()
      expect(provenance).toHaveTextContent(guidance.band!.source.population)
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
