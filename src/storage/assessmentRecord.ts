import type { FormHeuristicsResult, MetricId, MetricResult, View } from '../heuristics/types'
import type { ScalePassStatus } from '../guidance/types'
import type { MetricTier } from '../guidance/types'
import { METRIC_LABELS, metricTier } from '../results/metricConfidence'
import type { VideoMetadata } from '../video/types'
import type { BuildInfo } from './buildInfo'
import { METHODOLOGY_VERSION, METRIC_DEFINITION_VERSIONS } from './methodology'

/**
 * What one saved assessment is on disk (save-assessments-to-runner-storage, design D3/D4). Pure:
 * no provider, no DOM beyond `crypto.subtle` for the manifest hash.
 *
 * The analysis file is the source of truth; the root index is a cache of `indexEntryFor` rows, so
 * the progress view needs one read. Nothing here carries exemplars, timeseries, pose frames or
 * images — they are large, they hold per-frame body geometry, and nothing reads them back.
 */

export const ASSESSMENT_KIND = 'strides-assessment'
export const ASSESSMENT_SCHEMA_VERSION = 1
export const MANIFEST_KIND = 'strides-footage-manifest'
export const MANIFEST_SCHEMA_VERSION = 1
export const INDEX_KIND = 'strides-index'
export const INDEX_SCHEMA_VERSION = 1
export const INDEX_FILE_NAME = 'strides-index.json'
export const MANIFEST_FILE_NAME = 'footage-manifest.json'
export const ROOT_FOLDER_NAME = 'Strides'

/** Every MetricId, in the fixed order `METRIC_LABELS` declares them. */
export const ALL_METRIC_IDS = Object.keys(METRIC_LABELS) as MetricId[]

const UNITS: readonly MetricResult['unit'][] = [
  'ratio',
  'degrees',
  'stepsPerMinute',
  'percent',
  'centimeters',
]
const TIERS: readonly MetricTier[] = ['normal', 'caveated', 'excluded']
const VIEWS: readonly View[] = ['side', 'front', 'ambiguous']

export interface SavedMetric {
  value: number | null
  unit: MetricResult['unit']
  confidence: number
  tier: MetricTier
  viewFit: MetricResult['viewFit']
  caveat: string | null
  sampleSize: number
  frameCoverage: number
  interpolatedFraction: number
  /** Which clip (0-based) the fused value came from; null when not known. */
  sourceClipIndex: number | null
  definitionVersion: number
}

export interface SavedClipRun {
  index: number
  view: View | null
  samplingPath: 'sequential' | 'playback' | null
  scalePass: ScalePassStatus
  outlinePass: ScalePassStatus
}

export interface AssessmentRecord {
  kind: typeof ASSESSMENT_KIND
  schemaVersion: number
  id: string
  savedAt: string
  localDate: string
  methodology: { version: number; metricDefinitions: Record<MetricId, number> }
  build: BuildInfo
  run: {
    poseBackend: unknown
    samplingRobustness: unknown
    clips: SavedClipRun[]
  }
  view: { view: View; confidence: number; clipViews: (View | null)[] }
  metrics: Record<MetricId, SavedMetric>
}

export interface ManifestClip {
  index: number
  /** The file name as the runner's device had it. Only ever written here, never as an uploaded
   * file's name (it can carry personal details). Null for a recording or a demo clip. */
  originalName: string | null
  type: string
  sizeBytes: number
  lastModified: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  view: View | null
  sha256: string | null
  /** The uploaded file's name inside the assessment folder, or null when bytes were not saved. */
  savedAs: string | null
}

export interface FootageManifest {
  kind: typeof MANIFEST_KIND
  schemaVersion: number
  assessmentId: string
  clips: ManifestClip[]
}

export interface IndexMetric {
  value: number | null
  unit: MetricResult['unit']
  tier: MetricTier
  confidence: number
  definitionVersion: number
}

export interface IndexEntry {
  id: string
  savedAt: string
  localDate: string
  methodologyVersion: number
  views: (View | null)[]
  clipCount: number
  folderId: string
  analysisFileId: string
  metrics: Record<MetricId, IndexMetric>
}

export interface AssessmentIndex {
  kind: typeof INDEX_KIND
  schemaVersion: number
  updatedAt: string
  assessments: IndexEntry[]
}

export interface AssessmentClipInput {
  index: number
  source: Blob | null
  metadata: VideoMetadata | null
  view: View | null
  samplingPath: 'sequential' | 'playback' | null
  scalePass: ScalePassStatus
  outlinePass: ScalePassStatus
}

export interface AssessmentInput {
  id: string
  savedAt: Date
  heuristics: FormHeuristicsResult
  sourceIndices: Record<MetricId, number> | null
  clips: AssessmentClipInput[]
  poseBackend: unknown
  samplingRobustness: unknown
  build: BuildInfo
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** The save's date in the runner's own time zone, `YYYY-MM-DD`. */
export function localDateOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function analysisFileName(methodologyVersion: number, localDate: string): string {
  return `analysis-m${methodologyVersion}-${localDate}.json`
}

/** `2026-11-05 14.32 side+front (3f9a)`: readable in Drive, unique per save. The app never finds a
 * folder by this name — it uses provider properties. */
export function assessmentFolderName(savedAt: Date, clipViews: (View | null)[], id: string): string {
  const views = [...new Set(clipViews.map((v) => v ?? 'ambiguous'))].join('+') || 'no view'
  const hex = id.replace(/[^0-9a-f]/gi, '').slice(0, 4).toLowerCase() || 'xxxx'
  return `${localDateOf(savedAt)} ${pad2(savedAt.getHours())}.${pad2(savedAt.getMinutes())} ${views} (${hex})`
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
}

/** `clip-<n>.<ext>`, n 1-based. The extension comes from the MIME type, then from the original
 * name's extension if it is a short alphanumeric one, else `bin`. */
export function clipFileName(index: number, type: string, originalName: string | null): string {
  const baseType = type.split(';')[0].trim().toLowerCase()
  let ext = EXTENSION_BY_TYPE[baseType]
  if (!ext && originalName) {
    const match = /\.([a-z0-9]{1,5})$/i.exec(originalName)
    if (match) ext = match[1].toLowerCase()
  }
  return `clip-${index + 1}.${ext ?? 'bin'}`
}

function savedMetric(result: MetricResult, metric: MetricId, sourceClipIndex: number | null): SavedMetric {
  return {
    value: result.value,
    unit: result.unit,
    confidence: result.confidence,
    tier: metricTier(result),
    viewFit: result.viewFit,
    caveat: result.caveat,
    sampleSize: result.sampleSize,
    frameCoverage: result.frameCoverage,
    interpolatedFraction: result.interpolatedFraction,
    sourceClipIndex,
    definitionVersion: METRIC_DEFINITION_VERSIONS[metric],
  }
}

export function buildAssessmentRecord(input: AssessmentInput): AssessmentRecord {
  const metrics = {} as Record<MetricId, SavedMetric>
  for (const metric of ALL_METRIC_IDS) {
    metrics[metric] = savedMetric(
      input.heuristics[metric],
      metric,
      input.sourceIndices ? input.sourceIndices[metric] : null,
    )
  }
  return {
    kind: ASSESSMENT_KIND,
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    id: input.id,
    savedAt: input.savedAt.toISOString(),
    localDate: localDateOf(input.savedAt),
    methodology: { version: METHODOLOGY_VERSION, metricDefinitions: { ...METRIC_DEFINITION_VERSIONS } },
    build: { ...input.build },
    run: {
      poseBackend: input.poseBackend,
      samplingRobustness: input.samplingRobustness,
      clips: input.clips.map((clip) => ({
        index: clip.index,
        view: clip.view,
        samplingPath: clip.samplingPath,
        scalePass: clip.scalePass,
        outlinePass: clip.outlinePass,
      })),
    },
    view: {
      view: input.heuristics.view.view,
      confidence: input.heuristics.view.confidence,
      clipViews: input.clips.map((clip) => clip.view),
    },
    metrics,
  }
}

/** Above this a clip is not fingerprinted: hashing reads the whole file into memory, and a long
 * 4K phone clip can be large enough to get a mobile tab killed. The manifest then says `null`. */
export const MAX_FINGERPRINT_BYTES = 256 * 1024 * 1024

async function sha256Hex(blob: Blob): Promise<string | null> {
  if (blob.size > MAX_FINGERPRINT_BYTES) return null
  try {
    const bytes =
      typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await new Response(blob).arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * Always written, footage or not. `includeFootage` decides only whether each clip's `savedAs` is
 * set; the store uploads exactly the clips whose `savedAs` is non-null.
 */
export async function buildFootageManifest(
  assessmentId: string,
  clips: AssessmentClipInput[],
  includeFootage: boolean,
): Promise<FootageManifest> {
  const entries: ManifestClip[] = []
  for (const clip of clips) {
    const source = clip.source
    const originalName = source && 'name' in source && typeof source.name === 'string' && source.name !== ''
      ? source.name
      : null
    const type = source?.type ?? ''
    entries.push({
      index: clip.index,
      originalName,
      type,
      sizeBytes: source?.size ?? 0,
      lastModified:
        source && 'lastModified' in source && typeof source.lastModified === 'number'
          ? source.lastModified
          : null,
      durationSec: clip.metadata?.durationSec ?? null,
      width: clip.metadata?.width ?? null,
      height: clip.metadata?.height ?? null,
      view: clip.view,
      sha256: source ? await sha256Hex(source) : null,
      savedAs: includeFootage && source ? clipFileName(clip.index, type, originalName) : null,
    })
  }
  return { kind: MANIFEST_KIND, schemaVersion: MANIFEST_SCHEMA_VERSION, assessmentId, clips: entries }
}

export function indexEntryFor(
  record: AssessmentRecord,
  refs: { folderId: string; analysisFileId: string },
): IndexEntry {
  const metrics = {} as Record<MetricId, IndexMetric>
  for (const metric of ALL_METRIC_IDS) {
    const m = record.metrics[metric]
    metrics[metric] = {
      value: m.value,
      unit: m.unit,
      tier: m.tier,
      confidence: m.confidence,
      definitionVersion: m.definitionVersion,
    }
  }
  return {
    id: record.id,
    savedAt: record.savedAt,
    localDate: record.localDate,
    methodologyVersion: record.methodology.version,
    views: record.view.clipViews,
    clipCount: record.run.clips.length,
    folderId: refs.folderId,
    analysisFileId: refs.analysisFileId,
    metrics,
  }
}

export function emptyIndex(now: Date): AssessmentIndex {
  return { kind: INDEX_KIND, schemaVersion: INDEX_SCHEMA_VERSION, updatedAt: now.toISOString(), assessments: [] }
}

/** Adds or replaces `entry` by id, newest `savedAt` first. */
export function mergeIndexEntry(index: AssessmentIndex, entry: IndexEntry, now: Date): AssessmentIndex {
  const others = index.assessments.filter((e) => e.id !== entry.id)
  return {
    ...index,
    updatedAt: now.toISOString(),
    assessments: sortEntries([...others, entry]),
  }
}

export function sortEntries(entries: IndexEntry[]): IndexEntry[] {
  return [...entries].sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0))
}

// ---------------------------------------------------------------------------------------------
// Validation on read. Anything saved is untrusted input: the runner can edit files in Drive, and a
// newer Strides may have written a format this build does not know.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isNullableNumber = (x: unknown): x is number | null => x === null || isFiniteNumber(x)
const isPositiveInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1
const isViewOrNull = (x: unknown): x is View | null => x === null || VIEWS.includes(x as View)

function checkIndexMetric(x: unknown): string | null {
  if (!isObject(x)) return 'metric is not an object'
  if (!isNullableNumber(x.value)) return 'metric value is not a number or null'
  if (!UNITS.includes(x.unit as MetricResult['unit'])) return 'metric unit is unknown'
  if (!TIERS.includes(x.tier as MetricTier)) return 'metric tier is unknown'
  if (!isFiniteNumber(x.confidence)) return 'metric confidence is not a number'
  if (!isPositiveInt(x.definitionVersion)) return 'metric definitionVersion is not a positive integer'
  return null
}

/** Checks the fields an index row shares with a saved metric. Unknown metric ids are ignored (a
 * newer build may add one); a MISSING known metric is an error. */
function checkMetrics(x: unknown): string | null {
  if (!isObject(x)) return 'metrics is not an object'
  for (const metric of ALL_METRIC_IDS) {
    const problem = checkIndexMetric(x[metric])
    if (problem) return `${metric}: ${problem}`
  }
  return null
}

export function parseAssessmentRecord(x: unknown): ParseResult<AssessmentRecord> {
  if (!isObject(x)) return { ok: false, reason: 'not an object' }
  if (x.kind !== ASSESSMENT_KIND) return { ok: false, reason: 'not a Strides assessment file' }
  if (!isPositiveInt(x.schemaVersion)) return { ok: false, reason: 'schemaVersion missing' }
  if (x.schemaVersion > ASSESSMENT_SCHEMA_VERSION) {
    return { ok: false, reason: NEWER_STRIDES_REASON }
  }
  if (typeof x.id !== 'string' || x.id === '') return { ok: false, reason: 'id missing' }
  if (typeof x.savedAt !== 'string' || Number.isNaN(Date.parse(x.savedAt))) {
    return { ok: false, reason: 'savedAt is not a date' }
  }
  if (typeof x.localDate !== 'string') return { ok: false, reason: 'localDate missing' }
  if (!isObject(x.methodology) || !isPositiveInt(x.methodology.version)) {
    return { ok: false, reason: 'methodology version missing' }
  }
  if (!isObject(x.view) || !Array.isArray(x.view.clipViews) || !x.view.clipViews.every(isViewOrNull)) {
    return { ok: false, reason: 'view missing' }
  }
  if (!isObject(x.run) || !Array.isArray(x.run.clips)) return { ok: false, reason: 'run missing' }
  const problem = checkMetrics(x.metrics)
  if (problem) return { ok: false, reason: problem }
  return { ok: true, value: x as unknown as AssessmentRecord }
}

function checkIndexEntry(x: unknown): string | null {
  if (!isObject(x)) return 'entry is not an object'
  if (typeof x.id !== 'string' || x.id === '') return 'id missing'
  if (typeof x.savedAt !== 'string' || Number.isNaN(Date.parse(x.savedAt))) return 'savedAt is not a date'
  if (typeof x.localDate !== 'string') return 'localDate missing'
  if (!isPositiveInt(x.methodologyVersion)) return 'methodologyVersion missing'
  if (!Array.isArray(x.views) || !x.views.every(isViewOrNull)) return 'views missing'
  if (!Number.isInteger(x.clipCount)) return 'clipCount missing'
  if (typeof x.folderId !== 'string' || typeof x.analysisFileId !== 'string') return 'file refs missing'
  return checkMetrics(x.metrics)
}

/**
 * The index as a whole is rejected only when its envelope is wrong (then the store rebuilds it).
 * A single bad row is dropped and counted in `skipped`, never guessed at.
 */
export function parseIndex(
  x: unknown,
): ParseResult<{ index: AssessmentIndex; skipped: number; unreadableRows: unknown[] }> {
  if (!isObject(x)) return { ok: false, reason: 'not an object' }
  if (x.kind !== INDEX_KIND) return { ok: false, reason: 'not a Strides index' }
  if (!isPositiveInt(x.schemaVersion)) return { ok: false, reason: 'schemaVersion missing' }
  if (x.schemaVersion > INDEX_SCHEMA_VERSION) return { ok: false, reason: NEWER_STRIDES_REASON }
  if (!Array.isArray(x.assessments)) return { ok: false, reason: 'assessments missing' }
  const kept: IndexEntry[] = []
  const unreadableRows: unknown[] = []
  for (const entry of x.assessments) {
    if (checkIndexEntry(entry) === null) kept.push(entry as IndexEntry)
    else unreadableRows.push(entry)
  }
  const skipped = unreadableRows.length
  return {
    ok: true,
    value: {
      index: {
        kind: INDEX_KIND,
        schemaVersion: x.schemaVersion,
        updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : new Date(0).toISOString(),
        assessments: sortEntries(kept),
      },
      skipped,
      // Kept verbatim and written back on the next save: a row this build cannot read may be one a
      // newer build wrote, and dropping it would lose that assessment from the list for good.
      unreadableRows,
    },
  }
}

export const NEWER_STRIDES_REASON = 'saved by a newer Strides'
