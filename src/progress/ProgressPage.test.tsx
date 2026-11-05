import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { makeHeuristics, makeMetric } from '../results/__fixtures__/metricResult'
import {
  assessmentFolderName,
  buildAssessmentRecord,
  buildFootageManifest,
} from '../storage/assessmentRecord'
import { saveAssessment } from '../storage/assessmentStore'
import { createFakeProvider, type FakeProvider } from '../storage/fakeProvider'
import { createStorageConnection } from '../storage/storageConnection'
import { STORAGE_RECORD_KEY, writeStorageRecord } from '../storage/storageRecord'
import type { FormHeuristicsResult } from '../heuristics/types'
import { ProgressPage } from './ProgressPage'
import { MetricProgressChart } from './MetricProgressChart'

afterEach(() => window.localStorage.removeItem(STORAGE_RECORD_KEY))

async function save(provider: FakeProvider, id: string, savedAt: Date, heuristics: FormHeuristicsResult) {
  const clips = [
    { index: 0, source: null, metadata: null, view: 'side' as const, samplingPath: null, scalePass: 'done' as const, outlinePass: 'skipped' as const },
  ]
  const record = buildAssessmentRecord({ id, savedAt, heuristics, sourceIndices: null, clips, poseBackend: {}, samplingRobustness: {}, build: { commit: 't' } })
  await saveAssessment(provider, {
    record,
    manifest: await buildFootageManifest(id, clips, false),
    folderName: assessmentFolderName(savedAt, ['side'], id),
    clipSources: new Map(),
  })
}

const NO_STEP_WIDTH = { value: null, confidence: 0, viewFit: 'unsuitable' as const }

async function renderPage(provider: FakeProvider) {
  const connection = createStorageConnection(provider)
  const onBack = vi.fn()
  await act(async () => {
    render(<ProgressPage onBack={onBack} hasResults connection={connection} />)
  })
  return { onBack, connection }
}

describe('ProgressPage', () => {
  it('offers to connect when nothing is connected, and shows no chart', async () => {
    await renderPage(createFakeProvider())
    expect(screen.getByRole('button', { name: 'Connect Test storage' })).toBeInTheDocument()
    expect(document.querySelector('svg')).toBeNull()
  })

  it('says when no assessment has been saved, and creates nothing', async () => {
    const provider = createFakeProvider({ connected: true })
    await renderPage(provider)
    expect(await screen.findByText(/no saved assessments yet/i)).toBeInTheDocument()
    expect(provider.nodes()).toHaveLength(0)
  })

  it('lists saved dates newest first and charts each measured metric', async () => {
    const provider = createFakeProvider({ connected: true })
    await save(provider, 'a1', new Date(2026, 10, 1, 9), makeHeuristics({ cadence: makeMetric('cadence', { value: 160 }) }))
    await save(provider, 'b2', new Date(2026, 10, 8, 9), makeHeuristics({ cadence: makeMetric('cadence', { value: 166 }), stepWidth: makeMetric('stepWidth', NO_STEP_WIDTH) }))
    await save(provider, 'c3', new Date(2026, 10, 15, 9), makeHeuristics({ cadence: makeMetric('cadence', { value: 163, confidence: 0.5 }) }))
    await renderPage(provider)
    const dates = await screen.findByRole('list')
    expect(within(dates).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '2026-11-15 · side · 1 clip',
      '2026-11-08 · side · 1 clip',
      '2026-11-01 · side · 1 clip',
    ])
    const cadence = document.querySelector('[data-metric="cadence"]')!
    expect(cadence.querySelectorAll('circle')).toHaveLength(3)
    expect([...cadence.querySelectorAll('circle')].map((c) => c.getAttribute('data-tier'))).toEqual(['normal', 'normal', 'caveated'])
    const stepWidth = document.querySelector('[data-metric="stepWidth"]')!
    expect(stepWidth.querySelectorAll('circle')).toHaveLength(2)
    expect(stepWidth.textContent).toContain('Not measured on 2026-11-08')
    expect(document.body.textContent).not.toMatch(/improv|better|worse|declin|trend|progressed/i)
  })

  it('rebuilds a deleted list and says so', async () => {
    const provider = createFakeProvider({ connected: true })
    await save(provider, 'a1', new Date(2026, 10, 1, 9), makeHeuristics())
    provider.remove(provider.nodes().find((n) => n.props.stridesKind === 'index')!.id)
    await renderPage(provider)
    expect(await screen.findByText(/was missing, so it was rebuilt/i)).toBeInTheDocument()
  })

  it('counts unreadable rows', async () => {
    const provider = createFakeProvider({ connected: true })
    await save(provider, 'a1', new Date(2026, 10, 1, 9), makeHeuristics())
    const index = provider.nodes().find((n) => n.props.stridesKind === 'index')!
    const json = index.json as { assessments: unknown[] }
    provider.overwrite(index.id, { ...json, assessments: [...json.assessments, { id: 'x' }] })
    await renderPage(provider)
    expect(await screen.findByText(/one saved assessment could not be read/i)).toBeInTheDocument()
  })

  it('asks a remembered runner to load in a tap, then loads', async () => {
    writeStorageRecord({ provider: 'fake', rootFolderId: null })
    const provider = createFakeProvider()
    await renderPage(provider)
    const button = await screen.findByRole('button', { name: 'Show my saved assessments' })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(provider.calls).toContain('ensureAccess')
    expect(await screen.findByText(/no saved assessments yet/i)).toBeInTheDocument()
  })

  it('shows a provider error with Try again', async () => {
    const provider = createFakeProvider({ connected: true })
    provider.findRoot = () => Promise.reject(new Error('boom'))
    await renderPage(provider)
    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i)
  })

  it('goes back', async () => {
    const { onBack } = await renderPage(createFakeProvider())
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('MetricProgressChart', () => {
  it('draws separate runs with a labelled break and never joins them', () => {
    render(
      <MetricProgressChart
        series={{
          metric: 'cadence',
          unit: 'stepsPerMinute',
          runs: [
            {
              definitionVersion: 1,
              points: [
                { id: 'a', savedAt: '2026-11-01T00:00:00Z', localDate: '2026-11-01', value: 160, tier: 'normal' },
                { id: 'b', savedAt: '2026-11-02T00:00:00Z', localDate: '2026-11-02', value: 162, tier: 'normal' },
              ],
            },
            {
              definitionVersion: 2,
              points: [{ id: 'c', savedAt: '2026-11-03T00:00:00Z', localDate: '2026-11-03', value: 175, tier: 'normal' }],
            },
          ],
          notMeasured: [],
          newer: [{ id: 'd', localDate: '2026-11-04', savedAt: '2026-11-04T00:00:00Z', definitionVersion: 3 }],
        }}
      />,
    )
    const runs = document.querySelectorAll('[data-run]')
    expect(runs).toHaveLength(2)
    expect(runs[0].querySelectorAll('polyline')).toHaveLength(1)
    expect(runs[1].querySelectorAll('polyline')).toHaveLength(0) // one point: nothing to join
    expect(runs[0].getAttribute('opacity')).toBe('0.45')
    expect(document.querySelectorAll('[data-definition-break]')).toHaveLength(1)
    expect(screen.getByText(/Definition changed \(v1 → v2\): earlier readings are not comparable/)).toBeInTheDocument()
    expect(screen.getByText(/saved by a newer Strides and is not shown/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows).toEqual([
      '2026-11-01160 steps/minDefinition 1',
      '2026-11-02162 steps/minDefinition 1',
      '2026-11-03175 steps/minDefinition 2',
      '2026-11-04Not shownSaved by a newer Strides (definition 3)',
    ])
  })
})
