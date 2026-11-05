import { describe, expect, it } from 'vitest'
import { makeHeuristics } from '../results/__fixtures__/metricResult'
import { assessmentFolderName, buildAssessmentRecord, buildFootageManifest } from './assessmentRecord'
import { createFakeProvider } from './fakeProvider'
import { createSaveJobs } from './saveJobs'
import { createStorageConnection } from './storageConnection'

async function prepare() {
  const clips = [
    {
      index: 0,
      source: new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' }),
      metadata: null,
      view: 'side' as const,
      samplingPath: null,
      scalePass: 'done' as const,
      outlinePass: 'skipped' as const,
    },
  ]
  const savedAt = new Date(2026, 10, 5, 9)
  const record = buildAssessmentRecord({ id: 'abcd-1', savedAt, heuristics: makeHeuristics(), sourceIndices: null, clips, poseBackend: {}, samplingRobustness: {}, build: { commit: 't' } })
  return {
    record,
    manifest: await buildFootageManifest('abcd-1', clips, true),
    folderName: assessmentFolderName(savedAt, ['side'], 'abcd-1'),
    clipSources: new Map([[0, clips[0].source as Blob]]),
  }
}

describe('save jobs', () => {
  it('ignores a second start for the same result', async () => {
    const provider = createFakeProvider({ connected: true })
    const jobs = createSaveJobs()
    const args = { provider, connection: createStorageConnection(provider), access: Promise.resolve(), prepare, rootFolderId: null }
    jobs.start('k', args)
    jobs.start('k', args)
    await new Promise((r) => setTimeout(r, 20))
    expect(jobs.get('k').kind).toBe('saved')
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'assessment')).toHaveLength(1)
    jobs.start('k', args) // already saved
    await new Promise((r) => setTimeout(r, 20))
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'assessment')).toHaveLength(1)
  })

  it('returns to idle on cancel and leaves nothing behind', async () => {
    const provider = createFakeProvider({ connected: true })
    const jobs = createSaveJobs()
    let release!: () => void
    const access = new Promise<void>((r) => (release = r))
    jobs.start('k', { provider, connection: createStorageConnection(provider), access, prepare, rootFolderId: null })
    jobs.cancel('k')
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(jobs.get('k')).toEqual({ kind: 'idle' })
    expect(provider.nodes()).toHaveLength(0)
  })
})
