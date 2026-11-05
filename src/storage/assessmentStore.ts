import {
  INDEX_FILE_NAME,
  MANIFEST_FILE_NAME,
  analysisFileName,
  emptyIndex,
  indexEntryFor,
  mergeIndexEntry,
  parseAssessmentRecord,
  parseIndex,
  sortEntries,
  NEWER_STRIDES_REASON,
  type AssessmentIndex,
  type AssessmentRecord,
  type FootageManifest,
  type IndexEntry,
} from './assessmentRecord'
import { StorageError, type StorageProvider, type StoredFile, type StoredFolder } from './provider'

/**
 * Save, load and rebuild over any provider (design D2/D3). Write order is the integrity rule:
 * folder → manifest → clips → analysis file → index. A folder with an analysis file is a complete
 * assessment; anything that fails before the analysis file leaves at most an incomplete folder,
 * which `rebuildIndex` ignores and the index never names.
 */

export type SavePhase = 'preparing' | 'footage' | 'analysis' | 'index'

export interface SaveProgress {
  phase: SavePhase
  /** 0..1 across the whole save, weighted by clip bytes. */
  fraction: number
}

export interface SaveRequest {
  record: AssessmentRecord
  manifest: FootageManifest
  folderName: string
  /** Clip bytes by clip index; only manifest clips with a `savedAs` are uploaded. */
  clipSources: ReadonlyMap<number, Blob>
}

export interface SaveOutcome {
  root: StoredFolder
  entry: IndexEntry
  index: AssessmentIndex
}

export interface LoadedIndex {
  /** Null when the runner has never saved: there is no Strides folder, and none is created. */
  root: StoredFolder | null
  index: AssessmentIndex
  /** Rows (or analysis files, after a rebuild) that could not be read. */
  skipped: number
  /** Why the index was rebuilt from the folders, or null if it was read as saved. */
  rebuilt: null | 'missing' | 'invalid' | 'requested'
}

const JSON_WEIGHT_BYTES = 64 * 1024

/**
 * The assessment is complete on disk but the root index could not be updated. Retrying redoes the
 * index step only (`updateIndex`), never the whole save, so a retry cannot duplicate it.
 */
export class IndexUpdateError extends StorageError {
  readonly entry: IndexEntry
  readonly root: StoredFolder
  constructor(entry: IndexEntry, root: StoredFolder, cause: unknown) {
    super(
      cause instanceof StorageError && cause.code === 'newer-version' ? 'newer-version' : 'unknown',
      cause instanceof StorageError && cause.code === 'newer-version'
        ? cause.message
        : 'Saved, but the list of assessments could not be updated.',
      !(cause instanceof StorageError && cause.code === 'newer-version'),
    )
    this.name = 'IndexUpdateError'
    this.entry = entry
    this.root = root
  }
}

const NEWER_INDEX_MESSAGE =
  'Your saved list was written by a newer version of Strides. Reload this page to update it.'

export async function saveAssessment(
  provider: StorageProvider,
  request: SaveRequest,
  options: {
    rootFolderId?: string | null
    onProgress?: (progress: SaveProgress) => void
    /** Called once the analysis file is about to be written: from here on the save is not
     * cancellable (the signal is ignored), because a complete assessment is what it leaves. */
    onCommit?: () => void
    signal?: AbortSignal
    now?: () => Date
  } = {},
): Promise<SaveOutcome> {
  const now = options.now ?? (() => new Date())
  const { record, manifest } = request
  const uploads = manifest.clips.flatMap((clip) => {
    if (!clip.savedAs) return []
    const blob = request.clipSources.get(clip.index)
    if (!blob) throw new StorageError('not-found', `Clip ${clip.index + 1} is no longer in this session.`, false)
    return [{ clip, blob }]
  })
  const total = uploads.reduce((sum, u) => sum + u.blob.size, 0) + 3 * JSON_WEIGHT_BYTES
  let done = 0
  const report = (phase: SavePhase, extra = 0) =>
    options.onProgress?.({ phase, fraction: Math.min(1, (done + extra) / total) })
  const checkAbort = () => {
    if (options.signal?.aborted) throw new StorageError('cancelled', 'Save cancelled.')
  }

  report('preparing')
  const root = await provider.ensureRoot(options.rootFolderId ?? null)
  checkAbort()
  const folder = await provider.createFolder(root, request.folderName, {
    stridesKind: 'assessment',
    stridesAssessmentId: record.id,
  })
  let analysisFile: StoredFile
  try {
    checkAbort()
    await provider.writeJson(folder, MANIFEST_FILE_NAME, manifest, {
      stridesKind: 'manifest',
      stridesAssessmentId: record.id,
    })
    done += JSON_WEIGHT_BYTES
    report('footage')

    for (const { clip, blob } of uploads) {
      checkAbort()
      await provider.uploadBlob(
        folder,
        clip.savedAs!,
        blob,
        { stridesKind: 'clip', stridesAssessmentId: record.id },
        (fraction) => report('footage', fraction * blob.size),
        options.signal,
      )
      done += blob.size
      report('footage')
    }

    checkAbort()
    options.onCommit?.()
    report('analysis')
    analysisFile = await provider.writeJson(
      folder,
      analysisFileName(record.methodology.version, record.localDate),
      record,
      { stridesKind: 'analysis', stridesAssessmentId: record.id },
    )
  } catch (error) {
    // No analysis file, so this folder is not an assessment: clear it (and any uploaded clips)
    // away rather than leave it in the runner's Drive. Best effort; rebuild ignores it regardless.
    await provider.trash(folder).catch(() => undefined)
    throw error
  }
  done += JSON_WEIGHT_BYTES
  report('index')

  const entry = indexEntryFor(record, { folderId: folder.id, analysisFileId: analysisFile.id })
  let index: AssessmentIndex
  try {
    index = await updateIndex(provider, root, entry, now)
  } catch (error) {
    throw new IndexUpdateError(entry, root, error)
  }
  done += JSON_WEIGHT_BYTES
  report('index')
  return { root, entry, index }
}

/** Adds `entry` to the root index: re-read, merge by id, write. Keeps rows this build cannot read.
 * Refuses to touch an index a newer Strides wrote. */
export async function updateIndex(
  provider: StorageProvider,
  root: StoredFolder,
  entry: IndexEntry,
  now: () => Date = () => new Date(),
): Promise<AssessmentIndex> {
  const current = await readIndex(provider, root)
  if (current.newer) throw new StorageError('newer-version', NEWER_INDEX_MESSAGE, false)
  const base = current.index ?? (await collectEntries(provider, root)).index
  const index = mergeIndexEntry(base, entry, now())
  await provider.writeJson(
    root,
    INDEX_FILE_NAME,
    { ...index, assessments: [...index.assessments, ...current.unreadableRows] },
    { stridesKind: 'index' },
    current.file ?? undefined,
  )
  return index
}

async function readIndex(
  provider: StorageProvider,
  root: StoredFolder,
): Promise<{
  file: StoredFile | null
  index: AssessmentIndex | null
  skipped: number
  unreadableRows: unknown[]
  invalid: boolean
  newer: boolean
}> {
  const none = { file: null, index: null, skipped: 0, unreadableRows: [], invalid: false, newer: false }
  const files = await provider.findByProps(root, { stridesKind: 'index' })
  const file = files[0] ?? null
  if (!file) return none
  let raw: unknown
  try {
    raw = await provider.readJson(file)
  } catch (error) {
    if (error instanceof StorageError && error.code === 'not-found') return none
    throw error
  }
  const parsed = parseIndex(raw)
  if (!parsed.ok) {
    return { ...none, file, invalid: parsed.reason !== NEWER_STRIDES_REASON, newer: parsed.reason === NEWER_STRIDES_REASON }
  }
  return {
    ...none,
    file,
    index: parsed.value.index,
    skipped: parsed.value.skipped,
    unreadableRows: parsed.value.unreadableRows,
  }
}
/** Every complete assessment under `root`, read from its analysis file. */
async function collectEntries(
  provider: StorageProvider,
  root: StoredFolder,
): Promise<{ index: AssessmentIndex; skipped: number }> {
  const folders = await provider.findByProps(root, { stridesKind: 'assessment' })
  const entries: IndexEntry[] = []
  let skipped = 0
  for (const folder of folders) {
    const analyses = await provider.findByProps(folder, { stridesKind: 'analysis' })
    if (analyses.length === 0) continue // incomplete save: never indexed
    let raw: unknown
    try {
      raw = await provider.readJson(analyses[0])
    } catch (error) {
      if (error instanceof StorageError && error.code === 'not-found') continue
      throw error
    }
    const parsed = parseAssessmentRecord(raw)
    if (!parsed.ok) {
      skipped++
      continue
    }
    entries.push(indexEntryFor(parsed.value, { folderId: folder.id, analysisFileId: analyses[0].id }))
  }
  const deduped = new Map(entries.map((e) => [e.id, e]))
  return {
    index: { ...emptyIndex(new Date()), assessments: sortEntries([...deduped.values()]) },
    skipped,
  }
}

export async function rebuildIndex(
  provider: StorageProvider,
  root: StoredFolder,
  reason: NonNullable<LoadedIndex['rebuilt']>,
  existing: StoredFile | null = null,
): Promise<LoadedIndex> {
  const { index, skipped } = await collectEntries(provider, root)
  let file = existing
  if (!file) file = (await provider.findByProps(root, { stridesKind: 'index' }))[0] ?? null
  // Nothing to index and nothing to repair: write nothing.
  if (!file && index.assessments.length === 0) return { root, index, skipped, rebuilt: reason }
  await provider.writeJson(root, INDEX_FILE_NAME, index, { stridesKind: 'index' }, file ?? undefined)
  return { root, index, skipped, rebuilt: reason }
}

export async function loadIndex(
  provider: StorageProvider,
  options: { rootFolderId?: string | null; forceRebuild?: boolean } = {},
): Promise<LoadedIndex> {
  const root = await provider.findRoot(options.rootFolderId ?? null)
  if (!root) return { root: null, index: emptyIndex(new Date()), skipped: 0, rebuilt: null }
  const current = await readIndex(provider, root)
  // A newer Strides wrote it: read nothing, write nothing, say so.
  if (current.newer) throw new StorageError('newer-version', NEWER_INDEX_MESSAGE, false)
  if (options.forceRebuild) return rebuildIndex(provider, root, 'requested', current.file)
  if (current.invalid) return rebuildIndex(provider, root, 'invalid', current.file)
  if (!current.index) return rebuildIndex(provider, root, 'missing', null)
  return { root, index: current.index, skipped: current.skipped, rebuilt: null }
}
