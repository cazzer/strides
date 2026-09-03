/**
 * One fetch seam for every model asset this app downloads: streams the bytes while reporting
 * honest byte progress, serves them from Cache Storage on a hit, and populates it on a miss.
 *
 * Progress and caching are ONE utility rather than two because they read the same stream. Splitting
 * them by concern would mean writing the fetch twice; splitting by ASSET is the useful split, and
 * that is why MoveNet's weights (`strides-utn.4`) are a separate ticket rather than a separate
 * module — they call this unchanged.
 *
 * Three measured constraints from `strides-utn.2` shape this file. They are measurements from a
 * real browser, not guesses; do not relax one without re-measuring.
 *
 * 1. **The tasks-vision WASM does not belong here.** It is already served
 *    `public, max-age=31536000, immutable` and measured 0 transferred bytes on a warm visit, and
 *    Cache Storage stores the DECODED body — so caching its 3.12 MB wire payload would occupy
 *    11.76 MB of quota to save nothing. It also has no progress hook (`FilesetResolver` exposes
 *    none), so it is indeterminate no matter what this module does. Leave it to the HTTP cache.
 * 2. **`Content-Length` is trusted PER RESPONSE, never globally** — see `trustedContentLength`.
 * 3. **Cache Storage round-trips these assets byte-identically**, cross-origin CORS responses
 *    included, and the measured quota (~10.76 GB) makes the whole model set ~0.2–0.3% of it.
 *
 * The single most load-bearing design constraint is `ModelAssetSpec.id`: MoveNet's model files
 * resolve, through two 302s, to a **per-request signed** `storage.googleapis.com` URL whose
 * `X-Goog-Date` and `X-Goog-Signature` differ on every request. A cache keyed on the fetched or
 * resolved URL would therefore miss 100% of the time and silently do nothing at all. Nothing in
 * this module ever reads `response.url`; the key comes from the caller's stable identity.
 */

import type { ModelLoadProgress } from './modelLoadState'

/** A model file to obtain, named by a STABLE identity that is independent of how it is fetched. */
export interface ModelAssetSpec {
  /**
   * The cache identity. MUST be stable across page loads and across requests for the same bytes —
   * a canonical request URL, or any caller-chosen name. It is **not** the URL that is fetched and
   * must never be derived from `response.url`: see this module's doc for why that would silently
   * disable the cache entirely for MoveNet.
   */
  id: string
  /** Where to actually fetch on a miss. May redirect, may be signed, may differ every request. */
  url: string
  /**
   * Bumped whenever the bytes behind `id` change. Part of the key, so a model swap supersedes the
   * stored bytes instead of serving the old model from a client-side cache forever.
   */
  version: string
}

/** One asset's byte reading. Reported repeatedly as its stream drains. */
export interface ModelAssetProgressEvent {
  /** The `ModelAssetSpec.id` this reading belongs to. */
  assetId: string
  loadedBytes: number
  /**
   * `null` means INDETERMINATE for this asset — the response's byte total is unknown or was
   * measured untrustworthy. Never a zero and never a guess (see `ModelLoadState.progress`).
   */
  totalBytes: number | null
}

export type ModelAssetProgressListener = (event: ModelAssetProgressEvent) => void

/**
 * Bumped only when the KEY SCHEME or the stored representation changes — not when a model does.
 * A model version rides on `ModelAssetSpec.version` instead, so bumping one model does not
 * discard every other cached asset.
 */
export const MODEL_ASSET_CACHE_NAME = 'strides-model-assets-v1'

/**
 * Cache Storage keys are URLs, and `Cache.put` rejects any scheme that is not http(s) — but it
 * never fetches them. A synthetic `https:` origin that cannot resolve is therefore both legal and
 * unambiguous: it can never collide with a real request, and it reads at a glance as a key rather
 * than as a resource.
 */
const KEY_ORIGIN = 'https://model-asset.strides.invalid'
const KEY_PATH_PREFIX = '/asset/'

function cacheKeyUrl(spec: ModelAssetSpec): string {
  return `${assetKeyPrefix(spec.id)}${encodeURIComponent(spec.version)}`
}

/** Every key for this asset, at any version, shares this prefix — which is what eviction scans. */
function assetKeyPrefix(id: string): string {
  return `${KEY_ORIGIN}${KEY_PATH_PREFIX}${encodeURIComponent(id)}?v=`
}

/**
 * `caches` is absent in some contexts (insecure origins, some embeddings) and its mere ACCESS
 * throws in others (private browsing, blocked site data) — so this is a try/catch around the read
 * and not a `typeof` check alone.
 */
function cacheStorage(): CacheStorage | null {
  try {
    return (globalThis as { caches?: CacheStorage }).caches ?? null
  } catch {
    return null
  }
}

/** `null` whenever the cache is unavailable for any reason — callers then simply download. */
async function openCache(): Promise<Cache | null> {
  const store = cacheStorage()
  if (!store) return null
  try {
    return await store.open(MODEL_ASSET_CACHE_NAME)
  } catch {
    return null
  }
}

/**
 * Whether this response's `Content-Length` counts the same bytes the stream below will count.
 *
 * Measured (`strides-utn.2`): the tasks-vision WASM ships `content-encoding: br`, so its
 * `Content-Length` is the COMPRESSED length — 3,124,166 against 11,756,954 decoded, 3.76x — and a
 * naive `loaded / total` there reads ~376%. The three assets this app actually routes here carry no
 * `content-encoding` and their `Content-Length` is exact, so the check below is a guard rather than
 * a workhorse; it exists because the decision has to be made per response and cannot be assumed.
 *
 * A cross-origin response only exposes `content-encoding` when the server lists it in
 * `access-control-expose-headers`, so this check alone is not sufficient. The streaming loop's
 * overrun guard is the other half: a total the body has already passed was measuring something
 * else, whatever the headers did or did not say.
 */
function trustedContentLength(response: Response): number | null {
  const encoding = response.headers.get('content-encoding')
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') return null

  const declared = response.headers.get('content-length')
  if (declared === null) return null

  const parsed = Number(declared)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function downloadWithProgress(
  spec: ModelAssetSpec,
  onProgress: ModelAssetProgressListener | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(spec.url)
  if (!response.ok) {
    throw new Error(
      `Model asset "${spec.id}" failed to download: HTTP ${response.status} ${response.statusText}`,
    )
  }

  const body = response.body
  if (!body) {
    // No readable stream (an older runtime, or a `Response` built from bytes). Still correct —
    // just one reading instead of many, rather than a fabricated ramp.
    const whole = new Uint8Array(await response.arrayBuffer())
    onProgress?.({
      assetId: spec.id,
      loadedBytes: whole.byteLength,
      totalBytes: whole.byteLength,
    })
    return whole
  }

  let totalBytes = trustedContentLength(response)
  let loadedBytes = 0
  const chunks: Uint8Array[] = []
  onProgress?.({ assetId: spec.id, loadedBytes, totalBytes })

  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loadedBytes += value.byteLength
    // The other half of the per-response trust decision: a declared total the decoded body has
    // already overrun was counting compressed bytes (or was simply wrong). Drop to indeterminate
    // rather than reporting the >100% this would otherwise produce.
    if (totalBytes !== null && loadedBytes > totalBytes) totalBytes = null
    onProgress?.({ assetId: spec.id, loadedBytes, totalBytes })
  }

  // Close with the measured size as the total. This is a measurement, not an invention: the asset
  // is complete and it was exactly this many bytes. It also stops an asset whose total was never
  // readable from holding a multi-file aggregate at indeterminate after it has finished.
  onProgress?.({ assetId: spec.id, loadedBytes, totalBytes: loadedBytes })
  return concatChunks(chunks, loadedBytes)
}

/**
 * Delete every stored entry for this asset that is not the key we are about to write — i.e. the
 * entries left behind by an earlier `ModelAssetSpec.version`. Run on a miss, which is exactly the
 * request a version bump produces.
 */
async function evictSupersededVersions(
  cache: Cache,
  spec: ModelAssetSpec,
  currentKey: string,
): Promise<void> {
  try {
    const prefix = assetKeyPrefix(spec.id)
    const stored = await cache.keys()
    for (const request of stored) {
      if (request.url === currentKey) continue
      if (!request.url.startsWith(prefix)) continue
      await cache.delete(request)
    }
  } catch {
    // A cache that cannot be enumerated or pruned is not a download failure. The worst case is a
    // superseded entry lingering until storage pressure evicts it; the current key is what gets
    // read back, so no stale model is ever served.
  }
}

/**
 * Obtain a model asset's bytes — from Cache Storage where possible, from the network otherwise,
 * reporting byte progress either way.
 *
 * Never rejects because of the cache: an absent, throwing or full Cache Storage degrades to a
 * plain uncached download. It rejects only when the download itself fails.
 */
export async function fetchModelAsset(
  spec: ModelAssetSpec,
  onProgress?: ModelAssetProgressListener,
): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await openCache()
  const key = cacheKeyUrl(spec)

  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer())
        // A hit still reports, and reports as complete: a multi-file load where some files are
        // cached and some are not would otherwise under-count its own total.
        onProgress?.({
          assetId: spec.id,
          loadedBytes: bytes.byteLength,
          totalBytes: bytes.byteLength,
        })
        return bytes
      }
    } catch {
      // Fall through to the network. A read that throws is a cache miss, not an error.
    }
    await evictSupersededVersions(cache, spec, key)
  }

  const bytes = await downloadWithProgress(spec, onProgress)

  if (cache) {
    try {
      // Store exactly the bytes handed back, not a clone of the original response: the two are
      // then identical by construction, so a cached load cannot differ from a fetched one.
      await cache.put(key, new Response(bytes))
    } catch {
      // Quota exceeded, private browsing, blocked site data. The bytes are already in hand; the
      // only cost is re-downloading next time.
    }
  }

  return bytes
}

/**
 * Fold per-asset byte readings into the single `ModelLoadState.progress` an owner publishes.
 *
 * One owner's load is several files (MoveNet fetches a `model.json` plus two or three weight
 * shards, per model), and the header must not have to know that inventory — so aggregation lives
 * here rather than being reimplemented per caller. Hand the returned listener to
 * `fetchModelAsset`, or to `createDetector`'s `onAssetProgress`, once per owner attempt.
 *
 * **One unknown total makes the whole reading indeterminate.** Summing the totals that happen to be
 * known would report a total that is not the total, which is the same dishonesty as inventing one.
 *
 * A caller that knows a file's size before fetching it can seed it by emitting
 * `{ assetId, loadedBytes: 0, totalBytes: <declared> }` before the fetch starts, so the aggregate
 * total is right from the first byte instead of growing as each file begins.
 *
 * ⚠️ **MoveNet is not such a caller, and this doc used to claim it was.** Its `model.json` weights
 * manifest declares every WEIGHT's dtype and shape — so a per-GROUP byte total is derivable — but
 * a group's split across its `paths` is nowhere in the file, and reconstructing it means assuming
 * the converter's 4 MiB shard size. `strides-utn.4` therefore seeds nothing and lets its aggregate
 * total grow as each of its 7 files begins: a total that is knowably partial is still a
 * measurement, while one inferred from a shard size nobody declared is the guess this whole shape
 * exists to keep out.
 */
export function aggregateModelAssetProgress(
  emit: (progress: ModelLoadProgress | null) => void,
): ModelAssetProgressListener {
  const perAsset = new Map<string, { loadedBytes: number; totalBytes: number | null }>()

  return (event: ModelAssetProgressEvent): void => {
    perAsset.set(event.assetId, {
      loadedBytes: event.loadedBytes,
      totalBytes: event.totalBytes,
    })

    let loadedBytes = 0
    let totalBytes = 0
    let determinate = true
    for (const asset of perAsset.values()) {
      loadedBytes += asset.loadedBytes
      if (asset.totalBytes === null) determinate = false
      else totalBytes += asset.totalBytes
    }

    emit(determinate ? { loadedBytes, totalBytes } : null)
  }
}
