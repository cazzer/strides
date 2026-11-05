import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeHeuristics } from '../results/__fixtures__/metricResult'
import { SaveAssessmentPanel } from './SaveAssessmentPanel'
import { formatMegabytes } from './formatBytes'
import { createFakeProvider, type FakeProviderOptions } from './fakeProvider'
import { createStorageConnection } from './storageConnection'
import { createSaveJobs } from './saveJobs'
import { STORAGE_RECORD_KEY, readStorageRecord, writeStorageRecord } from './storageRecord'
import { finishedClip } from './__fixtures__/clipSessions'
import type { ClipSession } from '../results/multiClipAnalysis'

afterEach(() => window.localStorage.removeItem(STORAGE_RECORD_KEY))

const READY = { phase: 'ready' as const, heuristics: makeHeuristics() }

function renderPanel(
  options: FakeProviderOptions & { clips?: ClipSession[]; aggregate?: typeof READY | { phase: 'sampling'; heuristics: null } } = {},
) {
  const provider = createFakeProvider(options)
  const connection = createStorageConnection(provider)
  const onOpenProgress = vi.fn()
  const jobs = createSaveJobs()
  const clips = options.clips ?? [finishedClip('a', { bytes: 3 * 1024 * 1024 }), finishedClip('b')]
  const utils = render(
    <SaveAssessmentPanel
      aggregate={options.aggregate ?? READY}
      clips={clips}
      sourceIndices={null}
      resultKey="a b"
      onOpenProgress={onOpenProgress}
      connection={connection}
      jobs={jobs}
    />,
  )
  return { ...utils, provider, connection, onOpenProgress, jobs }
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
  })
}

describe('SaveAssessmentPanel', () => {
  it('says saving is not set up when the provider is unavailable', () => {
    renderPanel({ unavailable: true })
    expect(screen.getByText(/isn't set up on this build/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('connects in two taps: load sign-in, then continue', async () => {
    const { provider } = renderPanel()
    expect(screen.getByText(/nothing is saved until you press save/i)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Connect Test storage' }))
    expect(provider.calls).toEqual(['prepare'])
    await click(await screen.findByRole('button', { name: 'Continue to Google' }))
    expect(await screen.findByRole('button', { name: 'Save to Test storage' })).toBeEnabled()
    expect(readStorageRecord()).toEqual({ provider: 'fake', rootFolderId: null })
    expect(provider.nodes()).toHaveLength(0) // connecting writes nothing
  })

  it('waits for background checks before allowing a save', () => {
    writeStorageRecord({ provider: 'fake', rootFolderId: null })
    renderPanel({ connected: true, clips: [finishedClip('a', { scalePass: 'running' })] })
    expect(screen.getByRole('button', { name: 'Save to Test storage' })).toBeDisabled()
    expect(screen.getByText('Finishing background checks…')).toBeInTheDocument()
  })

  it('waits for the analysis itself', () => {
    renderPanel({ connected: true, aggregate: { phase: 'sampling', heuristics: null } })
    expect(screen.getByRole('button', { name: 'Save to Test storage' })).toBeDisabled()
  })

  it('saves without footage by default and offers progress', async () => {
    const { provider, onOpenProgress } = renderPanel({ connected: true })
    const footage = screen.getByRole('checkbox', { name: /also save the video \(3\.0 MB\)/i })
    expect(footage).not.toBeChecked()
    await click(screen.getByRole('button', { name: 'Save to Test storage' }))
    expect(provider.calls[0]).toBe('ensureAccess') // first, inside the tap
    expect(await screen.findByText(/^Saved to Test storage: Strides \//)).toBeInTheDocument()
    expect(provider.calls.some((c) => c.startsWith('uploadBlob'))).toBe(false)
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'analysis')).toHaveLength(1)
    expect(readStorageRecord()?.rootFolderId).toBe(provider.nodes()[0].id)
    await click(screen.getByRole('button', { name: 'See progress' }))
    expect(onOpenProgress).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save to Test storage' })).toBeNull() // once per result
  })

  it('keeps a save across an unmount, so Back from Progress cannot save twice', async () => {
    const provider = createFakeProvider({ connected: true })
    const connection = createStorageConnection(provider)
    const jobs = createSaveJobs()
    const props = { aggregate: READY, clips: [finishedClip('a')], sourceIndices: null, resultKey: 'a', connection, jobs }
    const first = render(<SaveAssessmentPanel {...props} />)
    await click(screen.getByRole('button', { name: 'Save to Test storage' }))
    first.unmount() // mid-save: the job carries on
    await waitFor(() => expect(jobs.get('a').kind).toBe('saved'))
    render(<SaveAssessmentPanel {...props} />)
    expect(screen.getByText(/^Saved to Test storage/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save to Test storage' })).toBeNull()
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'analysis')).toHaveLength(1)
  })

  it('starts clean for a new set of clips', async () => {
    const { rerender, connection, jobs } = renderPanel({ connected: true })
    await click(screen.getByRole('button', { name: 'Save to Test storage' }))
    await screen.findByText(/^Saved to/)
    rerender(
      <SaveAssessmentPanel aggregate={READY} clips={[finishedClip('c')]} sourceIndices={null} resultKey="c" connection={connection} jobs={jobs} />,
    )
    expect(screen.getByRole('button', { name: 'Save to Test storage' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retries only the index step when the index write fails', async () => {
    const { provider } = renderPanel({ connected: true })
    const realWrite = provider.writeJson
    let failIndex = true
    provider.writeJson = (parent, name, data, props, existing) => {
      if (props.stridesKind === 'index' && failIndex) return Promise.reject(new Error('index down'))
      return realWrite(parent, name, data, props, existing)
    }
    await click(screen.getByRole('button', { name: 'Save to Test storage' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Saved, but the list of assessments could not be updated/)
    failIndex = false
    await click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/^Saved to/)).toBeInTheDocument()
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'analysis')).toHaveLength(1)
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'assessment')).toHaveLength(1)
  })

  it('uploads the clips only when the box is ticked, under neutral names', async () => {
    const { provider } = renderPanel({
      connected: true,
      clips: [finishedClip('a', { name: 'Jane Doe 5k.mp4' })],
    })
    await click(screen.getByRole('checkbox'))
    await click(screen.getByRole('button', { name: 'Save to Test storage' }))
    await screen.findByText(/^Saved to/)
    expect(provider.calls.filter((c) => c.startsWith('uploadBlob'))).toEqual(['uploadBlob:clip-1.mp4'])
    const manifest = provider.nodes().find((n) => n.props.stridesKind === 'manifest')!.json as {
      clips: { originalName: string }[]
    }
    expect(manifest.clips[0].originalName).toBe('Jane Doe 5k.mp4')
  })

  it('shows a failure with Try again, and the retry can succeed', async () => {
    const { provider } = renderPanel({ connected: true, failUploadAt: 0 })
    await click(screen.getByRole('checkbox'))
    await click(screen.getByRole('button', { name: 'Save to Test storage' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed.')
    expect(provider.nodes().some((n) => n.props.stridesKind === 'analysis')).toBe(false)
    expect(provider.nodes().some((n) => n.props.stridesKind === 'assessment')).toBe(false) // trashed
    await click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/^Saved to/)).toBeInTheDocument()
  })

  it('disconnects, forgets the record and offers to connect again', async () => {
    writeStorageRecord({ provider: 'fake', rootFolderId: 'R' })
    const { provider } = renderPanel({ connected: true })
    expect(screen.getByText(/saved files stay there/i)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Disconnect Test storage' }))
    await waitFor(() => expect(readStorageRecord()).toBeNull())
    expect(provider.calls).toContain('disconnect')
    // Sign-in is already loaded, so reconnecting is one tap.
    expect(await screen.findByRole('button', { name: 'Continue to Google' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save to/i })).toBeNull()
  })

  it('preloads sign-in for a runner who connected on an earlier visit', async () => {
    writeStorageRecord({ provider: 'fake', rootFolderId: null })
    const { provider } = renderPanel()
    await act(async () => {})
    expect(provider.calls).toContain('prepare')
    expect(screen.getByRole('button', { name: 'Save to Test storage' })).toBeEnabled()
  })
})

describe('formatMegabytes', () => {
  it('rounds large sizes and keeps a decimal for small ones', () => {
    expect(formatMegabytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatMegabytes(123.4 * 1024 * 1024)).toBe('123 MB')
  })
})
