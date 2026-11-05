import { describe, expect, it } from 'vitest'
import { makeHeuristics, makeMetric } from '../results/__fixtures__/metricResult'
import {
  ALL_METRIC_IDS,
  analysisFileName,
  assessmentFolderName,
  buildAssessmentRecord,
  buildFootageManifest,
  clipFileName,
  emptyIndex,
  indexEntryFor,
  localDateOf,
  mergeIndexEntry,
  parseAssessmentRecord,
  parseIndex,
  type AssessmentClipInput,
  type AssessmentInput,
} from './assessmentRecord'

const SAVED_AT = new Date(2026, 10, 5, 14, 32, 10)

function clip(index: number, overrides: Partial<AssessmentClipInput> = {}): AssessmentClipInput {
  return {
    index,
    source: new File([new Uint8Array([1, 2, 3, index])], `Jane run ${index}.MOV`, {
      type: 'video/quicktime',
      lastModified: 1_700_000_000_000,
    }),
    metadata: { durationSec: 3.88, width: 1920, height: 1080, frameRate: null },
    view: 'side',
    samplingPath: 'sequential',
    scalePass: 'done',
    outlinePass: 'skipped',
    ...overrides,
  }
}

function input(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    id: '3f9a1c2e-0000-4000-8000-000000000000',
    savedAt: SAVED_AT,
    heuristics: makeHeuristics({
      stepWidth: makeMetric('stepWidth', { value: null, confidence: 0, viewFit: 'unsuitable' }),
      trunkLean: makeMetric('trunkLean', { confidence: 0.5, caveat: 'Few frames.' }),
    }),
    sourceIndices: null,
    clips: [clip(0), clip(1, { view: 'front' })],
    poseBackend: { backend: 'movenet' },
    samplingRobustness: { sequentialSampling: { enabled: true } },
    build: { commit: 'aefbfb52' },
    ...overrides,
  }
}

describe('naming', () => {
  it('stamps the analysis file with methodology and local date', () => {
    expect(localDateOf(SAVED_AT)).toBe('2026-11-05')
    expect(analysisFileName(1, '2026-11-05')).toBe('analysis-m1-2026-11-05.json')
  })

  it('names the folder by time, distinct views and id prefix', () => {
    expect(assessmentFolderName(SAVED_AT, ['side', 'front', 'side'], '3f9a1c2e')).toBe(
      '2026-11-05 14.32 side+front (3f9a)',
    )
    expect(assessmentFolderName(SAVED_AT, [null], 'ab-cd')).toBe('2026-11-05 14.32 ambiguous (abcd)')
  })

  it('names clips by position and MIME type, never by the original name', () => {
    expect(clipFileName(0, 'video/mp4', 'Jane.mp4')).toBe('clip-1.mp4')
    expect(clipFileName(1, 'video/quicktime', 'Jane.MOV')).toBe('clip-2.mov')
    expect(clipFileName(2, 'video/webm;codecs=vp9', null)).toBe('clip-3.webm')
    expect(clipFileName(0, '', 'run.M4V')).toBe('clip-1.m4v')
    expect(clipFileName(0, '', null)).toBe('clip-1.bin')
  })
})

describe('buildAssessmentRecord', () => {
  it('records methodology, build, run and every metric with its definition version', () => {
    const record = buildAssessmentRecord(input())
    expect(record.kind).toBe('strides-assessment')
    expect(record.schemaVersion).toBe(1)
    expect(record.localDate).toBe('2026-11-05')
    expect(record.methodology.version).toBe(1)
    expect(record.build.commit).toBe('aefbfb52')
    expect(record.run.clips).toEqual([
      { index: 0, view: 'side', samplingPath: 'sequential', scalePass: 'done', outlinePass: 'skipped' },
      { index: 1, view: 'front', samplingPath: 'sequential', scalePass: 'done', outlinePass: 'skipped' },
    ])
    expect(record.view.clipViews).toEqual(['side', 'front'])
    expect(Object.keys(record.metrics).sort()).toEqual([...ALL_METRIC_IDS].sort())
    for (const metric of ALL_METRIC_IDS) expect(record.metrics[metric].definitionVersion).toBe(1)
  })

  it('keeps an excluded metric with a null value and tier excluded', () => {
    const { stepWidth, trunkLean } = buildAssessmentRecord(input()).metrics
    expect(stepWidth).toMatchObject({ value: null, tier: 'excluded' })
    expect(trunkLean).toMatchObject({ tier: 'caveated', caveat: 'Few frames.' })
  })

  it('records the source clip of each fused metric when known', () => {
    const sourceIndices = Object.fromEntries(ALL_METRIC_IDS.map((m) => [m, 1])) as Record<
      (typeof ALL_METRIC_IDS)[number],
      number
    >
    expect(buildAssessmentRecord(input({ sourceIndices })).metrics.cadence.sourceClipIndex).toBe(1)
    expect(buildAssessmentRecord(input()).metrics.cadence.sourceClipIndex).toBeNull()
  })

  it('saves no exemplars, timeseries or calibration', () => {
    const json = JSON.stringify(buildAssessmentRecord(input()))
    expect(json).not.toMatch(/exemplars|timeseries|series|calibration|keypoints/i)
  })

  it('round-trips through the parser', () => {
    const record = JSON.parse(JSON.stringify(buildAssessmentRecord(input())))
    expect(parseAssessmentRecord(record)).toEqual({ ok: true, value: record })
  })
})

describe('buildFootageManifest', () => {
  it('lists every clip with a hash and keeps the original name only here', async () => {
    const manifest = await buildFootageManifest('id-1', input().clips, true)
    expect(manifest.clips).toHaveLength(2)
    expect(manifest.clips[0]).toMatchObject({
      index: 0,
      originalName: 'Jane run 0.MOV',
      type: 'video/quicktime',
      sizeBytes: 4,
      lastModified: 1_700_000_000_000,
      durationSec: 3.88,
      width: 1920,
      height: 1080,
      view: 'side',
      savedAs: 'clip-1.mov',
    })
    expect(manifest.clips[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.clips[0].sha256).not.toBe(manifest.clips[1].sha256)
  })

  it('sets savedAs to null for every clip when footage is not included', async () => {
    const manifest = await buildFootageManifest('id-1', input().clips, false)
    expect(manifest.clips.map((c) => c.savedAs)).toEqual([null, null])
  })

  it('skips the fingerprint for a clip too large to hash in memory', async () => {
    const huge = { size: 300 * 1024 * 1024, type: 'video/mp4', arrayBuffer: () => Promise.reject(new Error('should not read')) } as unknown as Blob
    const manifest = await buildFootageManifest('id-1', [clip(0, { source: huge })], false)
    expect(manifest.clips[0]).toMatchObject({ sha256: null, sizeBytes: 300 * 1024 * 1024 })
  })

  it('handles a recording blob with no name', async () => {
    const manifest = await buildFootageManifest(
      'id-1',
      [clip(0, { source: new Blob([new Uint8Array([9])], { type: 'video/webm' }) })],
      true,
    )
    expect(manifest.clips[0]).toMatchObject({ originalName: null, lastModified: null, savedAs: 'clip-1.webm' })
  })
})

describe('index', () => {
  const record = buildAssessmentRecord(input())
  const entry = indexEntryFor(record, { folderId: 'F', analysisFileId: 'A' })

  it('summarises each metric for the progress view', () => {
    expect(entry.metrics.stepWidth).toEqual({
      value: null,
      unit: record.metrics.stepWidth.unit,
      tier: 'excluded',
      confidence: 0,
      definitionVersion: 1,
    })
    expect(entry).toMatchObject({ id: record.id, clipCount: 2, views: ['side', 'front'], methodologyVersion: 1 })
  })

  it('merges by id, newest first', () => {
    const now = new Date(2026, 10, 6)
    const older = { ...entry, id: 'older', savedAt: '2026-01-01T00:00:00.000Z' }
    let index = mergeIndexEntry(emptyIndex(now), older, now)
    index = mergeIndexEntry(index, entry, now)
    index = mergeIndexEntry(index, { ...entry, clipCount: 3 }, now)
    expect(index.assessments.map((e) => [e.id, e.clipCount])).toEqual([
      [record.id, 3],
      ['older', 2],
    ])
  })

  it('drops and counts a malformed row, keeps the rest', () => {
    const raw = JSON.parse(
      JSON.stringify({ ...emptyIndex(SAVED_AT), assessments: [entry, { ...entry, id: 'bad', metrics: {} }] }),
    )
    const parsed = parseIndex(raw)
    expect(parsed.ok && parsed.value.skipped).toBe(1)
    expect(parsed.ok && parsed.value.index.assessments.map((e) => e.id)).toEqual([record.id])
  })

  it('rejects a wrong kind or a newer schema', () => {
    expect(parseIndex({ kind: 'other', schemaVersion: 1, assessments: [] }).ok).toBe(false)
    expect(parseIndex({ kind: 'strides-index', schemaVersion: 2, assessments: [] })).toEqual({
      ok: false,
      reason: 'saved by a newer Strides',
    })
  })
})

describe('parseAssessmentRecord', () => {
  const good = () => JSON.parse(JSON.stringify(buildAssessmentRecord(input())))

  it('rejects unknown kind, newer schema and malformed metrics', () => {
    expect(parseAssessmentRecord({ ...good(), kind: 'x' }).ok).toBe(false)
    expect(parseAssessmentRecord({ ...good(), schemaVersion: 2 })).toEqual({
      ok: false,
      reason: 'saved by a newer Strides',
    })
    const badUnit = good()
    badUnit.metrics.cadence.unit = 'furlongs'
    expect(parseAssessmentRecord(badUnit)).toEqual({ ok: false, reason: 'cadence: metric unit is unknown' })
    const missing = good()
    delete missing.metrics.kneeDrive
    expect(parseAssessmentRecord(missing).ok).toBe(false)
    const nanValue = good()
    nanValue.metrics.cadence.value = 'fast'
    expect(parseAssessmentRecord(nanValue).ok).toBe(false)
  })

  it('ignores a metric id this build does not know', () => {
    const extra = good()
    extra.metrics.futureMetric = { value: 1 }
    expect(parseAssessmentRecord(extra).ok).toBe(true)
  })
})
