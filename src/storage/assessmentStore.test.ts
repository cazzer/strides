import { describe, expect, it } from 'vitest'
import { makeHeuristics } from '../results/__fixtures__/metricResult'
import {
  assessmentFolderName,
  buildAssessmentRecord,
  buildFootageManifest,
  type AssessmentClipInput,
} from './assessmentRecord'
import { loadIndex, saveAssessment, type SaveProgress, type SaveRequest } from './assessmentStore'
import { createFakeProvider } from './fakeProvider'
import { StorageError } from './provider'

function clip(index: number): AssessmentClipInput {
  return {
    index,
    source: new File([new Uint8Array(1000 * (index + 1))], `c${index}.mp4`, { type: 'video/mp4' }),
    metadata: { durationSec: 2, width: 100, height: 100, frameRate: null },
    view: 'side',
    samplingPath: 'sequential',
    scalePass: 'done',
    outlinePass: 'skipped',
  }
}

async function request(id: string, savedAt: Date, includeFootage: boolean): Promise<SaveRequest> {
  const clips = [clip(0), clip(1)]
  const record = buildAssessmentRecord({
    id,
    savedAt,
    heuristics: makeHeuristics(),
    sourceIndices: null,
    clips,
    poseBackend: {},
    samplingRobustness: {},
    build: { commit: 'test' },
  })
  return {
    record,
    manifest: await buildFootageManifest(id, clips, includeFootage),
    folderName: assessmentFolderName(savedAt, ['side', 'side'], id),
    clipSources: new Map(clips.map((c) => [c.index, c.source!])),
  }
}

const DAY1 = new Date(2026, 10, 5, 9, 0)
const DAY2 = new Date(2026, 10, 12, 9, 0)

describe('saveAssessment', () => {
  it('writes folder, manifest, clips, analysis, then index, in that order', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, true))
    const writes = provider.calls.filter((c) => /^(createFolder|writeJson|uploadBlob)/.test(c))
    expect(writes).toEqual([
      'createFolder:2026-11-05 09.00 side (aaaa)',
      'writeJson:footage-manifest.json',
      'uploadBlob:clip-1.mp4',
      'uploadBlob:clip-2.mp4',
      'writeJson:analysis-m1-2026-11-05.json',
      'writeJson:strides-index.json',
    ])
  })

  it('uploads no clip bytes without the footage option', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    expect(provider.calls.some((c) => c.startsWith('uploadBlob'))).toBe(false)
    expect(provider.nodes().map((n) => n.name)).toEqual([
      'Strides',
      '2026-11-05 09.00 side (aaaa)',
      'footage-manifest.json',
      'analysis-m1-2026-11-05.json',
      'strides-index.json',
    ])
  })

  it('reports monotonic progress ending at 1', async () => {
    const provider = createFakeProvider({ connected: true })
    const seen: SaveProgress[] = []
    await saveAssessment(provider, await request('aaaa-1', DAY1, true), { onProgress: (p) => seen.push(p) })
    const fractions = seen.map((p) => p.fraction)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(fractions.at(-1)).toBe(1)
  })

  it('writes no analysis file and leaves the index alone when a clip upload fails', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    const failing = createFakeProvider({ connected: true, failUploadAt: 1 })
    await saveAssessment(failing, await request('aaaa-1', DAY1, false))
    const indexBefore = JSON.stringify(failing.nodes().find((n) => n.name === 'strides-index.json')!.json)
    await expect(saveAssessment(failing, await request('bbbb-2', DAY2, true))).rejects.toBeInstanceOf(StorageError)
    expect(failing.calls).toContain('trash:2026-11-12 09.00 side (bbbb)')
    const analysisFiles = failing.nodes().filter((n) => n.props.stridesKind === 'analysis')
    expect(analysisFiles.map((n) => n.props.stridesAssessmentId)).toEqual(['aaaa-1'])
    expect(JSON.stringify(failing.nodes().find((n) => n.name === 'strides-index.json')!.json)).toBe(indexBefore)
    // ...and the incomplete folder is not indexed on rebuild.
    const loaded = await loadIndex(failing, { forceRebuild: true })
    expect(loaded.index.assessments.map((e) => e.id)).toEqual(['aaaa-1'])
  })

  it('merges into the existing index, newest first, and reuses the index file', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    const { index } = await saveAssessment(provider, await request('bbbb-2', DAY2, false))
    expect(index.assessments.map((e) => e.id)).toEqual(['bbbb-2', 'aaaa-1'])
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'index')).toHaveLength(1)
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'root')).toHaveLength(1)
  })

  it('recovers entries from the folders when the index was deleted before a save', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    provider.remove(provider.nodes().find((n) => n.props.stridesKind === 'index')!.id)
    const { index } = await saveAssessment(provider, await request('bbbb-2', DAY2, false))
    expect(index.assessments.map((e) => e.id)).toEqual(['bbbb-2', 'aaaa-1'])
  })

  it('fails without writing when a clip to upload is no longer in the session', async () => {
    const provider = createFakeProvider({ connected: true })
    const req = await request('aaaa-1', DAY1, true)
    await expect(saveAssessment(provider, { ...req, clipSources: new Map() })).rejects.toThrow(/no longer/)
    expect(provider.nodes()).toHaveLength(0)
  })

  it('stops when cancelled', async () => {
    const provider = createFakeProvider({ connected: true })
    const controller = new AbortController()
    controller.abort()
    await expect(
      saveAssessment(provider, await request('aaaa-1', DAY1, true), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(provider.nodes().some((n) => n.props.stridesKind === 'analysis')).toBe(false)
  })
})

describe('index safety', () => {
  it('keeps rows this build cannot read when it writes the index', async () => {
    const provider = createFakeProvider({ connected: true })
    const { index } = await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    const file = provider.nodes().find((n) => n.props.stridesKind === 'index')!
    const future = { id: 'future', fromANewerBuild: true }
    provider.overwrite(file.id, { ...index, assessments: [...index.assessments, future] })
    await saveAssessment(provider, await request('bbbb-2', DAY2, false))
    const written = provider.nodes().find((n) => n.props.stridesKind === 'index')!.json as { assessments: unknown[] }
    expect(written.assessments).toContainEqual(future)
    expect(written.assessments).toHaveLength(3)
  })

  it('never overwrites an index a newer Strides wrote', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    const file = provider.nodes().find((n) => n.props.stridesKind === 'index')!
    const newer = { kind: 'strides-index', schemaVersion: 2, assessments: [] }
    provider.overwrite(file.id, newer)
    await expect(loadIndex(provider)).rejects.toMatchObject({ code: 'newer-version' })
    await expect(saveAssessment(provider, await request('bbbb-2', DAY2, false))).rejects.toMatchObject({
      name: 'IndexUpdateError',
      code: 'newer-version',
      retryable: false,
    })
    expect(provider.nodes().find((n) => n.props.stridesKind === 'index')!.json).toEqual(newer)
    // The assessment itself is complete on disk.
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'analysis')).toHaveLength(2)
  })

  it('ignores cancel once the analysis file is being written', async () => {
    const provider = createFakeProvider({ connected: true })
    const controller = new AbortController()
    const outcome = await saveAssessment(provider, await request('aaaa-1', DAY1, false), {
      signal: controller.signal,
      onCommit: () => controller.abort(),
    })
    expect(outcome.index.assessments.map((e) => e.id)).toEqual(['aaaa-1'])
  })
})

describe('loadIndex', () => {
  it('creates nothing for a runner who has never saved', async () => {
    const provider = createFakeProvider({ connected: true })
    const loaded = await loadIndex(provider)
    expect(loaded).toMatchObject({ root: null, skipped: 0, rebuilt: null })
    expect(loaded.index.assessments).toEqual([])
    expect(provider.nodes()).toHaveLength(0)
  })

  it('reads the index as saved', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    const loaded = await loadIndex(provider)
    expect(loaded.rebuilt).toBeNull()
    expect(loaded.index.assessments.map((e) => e.id)).toEqual(['aaaa-1'])
  })

  it('rebuilds a missing index from the assessment folders', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    await saveAssessment(provider, await request('bbbb-2', DAY2, false))
    provider.remove(provider.nodes().find((n) => n.props.stridesKind === 'index')!.id)
    const loaded = await loadIndex(provider)
    expect(loaded.rebuilt).toBe('missing')
    expect(loaded.index.assessments.map((e) => e.id)).toEqual(['bbbb-2', 'aaaa-1'])
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'index')).toHaveLength(1)
  })

  it('rebuilds an invalid index in place and counts unreadable analysis files', async () => {
    const provider = createFakeProvider({ connected: true })
    await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    await saveAssessment(provider, await request('bbbb-2', DAY2, false))
    const index = provider.nodes().find((n) => n.props.stridesKind === 'index')!
    provider.overwrite(index.id, { garbage: true })
    const analysis = provider.nodes().find((n) => n.props.stridesAssessmentId === 'aaaa-1' && n.props.stridesKind === 'analysis')!
    provider.overwrite(analysis.id, { kind: 'strides-assessment', schemaVersion: 99 })
    const loaded = await loadIndex(provider)
    expect(loaded).toMatchObject({ rebuilt: 'invalid', skipped: 1 })
    expect(loaded.index.assessments.map((e) => e.id)).toEqual(['bbbb-2'])
    expect(provider.nodes().filter((n) => n.props.stridesKind === 'index')).toHaveLength(1)
  })

  it('counts malformed index rows without rebuilding', async () => {
    const provider = createFakeProvider({ connected: true })
    const { index } = await saveAssessment(provider, await request('aaaa-1', DAY1, false))
    const file = provider.nodes().find((n) => n.props.stridesKind === 'index')!
    provider.overwrite(file.id, { ...index, assessments: [...index.assessments, { id: 'broken' }] })
    const loaded = await loadIndex(provider)
    expect(loaded).toMatchObject({ rebuilt: null, skipped: 1 })
  })

  it('persists across provider instances with a persist key', async () => {
    window.localStorage.removeItem('test.fake')
    const first = createFakeProvider({ connected: true, persistKey: 'test.fake' })
    await saveAssessment(first, await request('aaaa-1', DAY1, true))
    const second = createFakeProvider({ connected: true, persistKey: 'test.fake' })
    expect((await loadIndex(second)).index.assessments.map((e) => e.id)).toEqual(['aaaa-1'])
    window.localStorage.removeItem('test.fake')
  })
})
