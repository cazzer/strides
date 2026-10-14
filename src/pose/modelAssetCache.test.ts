import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MODEL_ASSET_CACHE_NAME,
  aggregateModelAssetProgress,
  fetchModelAsset,
  hasCachedModelAsset,
} from './modelAssetCache'
import type { ModelAssetProgressEvent, ModelAssetProgressListener } from './modelAssetCache'
import type { ModelLoadProgress } from './modelLoadState'

/**
 * A Cache Storage stand-in. jsdom implements none of it, and the behaviours under test here are
 * exactly the ones a real cache makes awkward to provoke on demand — a throwing `open`, a throwing
 * `put`, an entry stored under a superseded version token.
 */
class FakeCache {
  readonly entries = new Map<string, Uint8Array<ArrayBuffer>>()
  putCalls = 0
  throwOnMatch = false
  throwOnPut = false
  throwOnKeys = false

  async match(key: string): Promise<Response | undefined> {
    if (this.throwOnMatch) throw new Error('site data blocked')
    const stored = this.entries.get(key)
    return stored ? new Response(stored) : undefined
  }

  async put(key: string, response: Response): Promise<void> {
    this.putCalls += 1
    if (this.throwOnPut) throw new Error('quota exceeded')
    this.entries.set(key, new Uint8Array(await response.arrayBuffer()))
  }

  async keys(): Promise<{ url: string }[]> {
    if (this.throwOnKeys) throw new Error('site data blocked')
    return [...this.entries.keys()].map((url) => ({ url }))
  }

  async delete(request: { url: string }): Promise<boolean> {
    return this.entries.delete(request.url)
  }
}

function installCache(cache: FakeCache | null, openThrows = false): void {
  vi.stubGlobal('caches', {
    open: vi.fn(async (name: string) => {
      expect(name).toBe(MODEL_ASSET_CACHE_NAME)
      if (openThrows) throw new Error('site data blocked')
      return cache
    }),
  })
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

/** A streaming response, so the utility's real read loop runs rather than a one-shot fallback. */
function streamedResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): Response {
  return new Response(streamOf(chunks), { status: 200, headers })
}

const CHUNKS = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6]), new Uint8Array([7, 8, 9, 10])]
const TOTAL = 10
const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

const SPEC = { id: 'model/weights.bin', url: 'https://example.test/weights.bin', version: 'v1' }

function fetchReturning(...responses: Response[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn()
  for (const response of responses) mock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', mock)
  return mock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchModelAsset — Cache Storage', () => {
  it('populates the cache on a miss and returns the downloaded bytes', async () => {
    const cache = new FakeCache()
    installCache(cache)
    const fetchMock = fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(SPEC.url)
    expect(cache.entries.size).toBe(1)
    expect([...cache.entries.values()][0]).toEqual(BYTES)
  })

  it('serves a hit from the cache with no network request at all', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await fetchModelAsset(SPEC)

    // Second request, same spec: a fresh fetch mock that would throw if it were reached.
    const secondFetch = vi.fn(() => {
      throw new Error('a cache hit must not fetch')
    })
    vi.stubGlobal('fetch', secondFetch)

    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
    expect(secondFetch).not.toHaveBeenCalled()
  })

  it('returns byte-identical bytes whether they came from the cache or the network', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    const downloaded = await fetchModelAsset(SPEC)
    const cached = await fetchModelAsset(SPEC)

    // The cached entry is written from the bytes handed back, not from a clone of the original
    // response, so the two are the same by construction — and the analysis output cannot depend
    // on which path a run took.
    expect(cached).toEqual(downloaded)
  })

  it('keys on the CALLER-SUPPLIED id, so a per-request signed URL still hits', async () => {
    // MoveNet's weights resolve, through two 302s, to a `storage.googleapis.com` URL whose
    // `X-Goog-Date`/`X-Goog-Signature` differ on EVERY request. A cache keyed on the fetched URL
    // would miss 100% of the time and silently do nothing — this is the check that it does not.
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await fetchModelAsset({ ...SPEC, url: 'https://signed.test/x?X-Goog-Signature=aaa' })

    const secondFetch = vi.fn(() => {
      throw new Error('the signed URL changed, but the identity did not')
    })
    vi.stubGlobal('fetch', secondFetch)

    await expect(
      fetchModelAsset({ ...SPEC, url: 'https://signed.test/x?X-Goog-Signature=bbb' }),
    ).resolves.toEqual(BYTES)
    expect(secondFetch).not.toHaveBeenCalled()
  })

  it('evicts the superseded entry when the version token changes', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(
      streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }),
      streamedResponse([new Uint8Array([42])], { 'content-length': '1' }),
    )

    await fetchModelAsset(SPEC)
    const v1Key = [...cache.entries.keys()][0]

    const v2 = await fetchModelAsset({ ...SPEC, version: 'v2' })

    expect(v2).toEqual(new Uint8Array([42]))
    // Exactly one entry, and it is not the old one: a superseded model's bytes are removed rather
    // than accumulating beside the current ones.
    expect(cache.entries.size).toBe(1)
    expect(cache.entries.has(v1Key)).toBe(false)
  })

  it('leaves another asset alone when one asset s version changes', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(
      streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }),
      streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }),
      streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }),
    )

    await fetchModelAsset(SPEC)
    await fetchModelAsset({ id: 'model/other.bin', url: 'https://example.test/o', version: 'v1' })
    await fetchModelAsset({ ...SPEC, version: 'v2' })

    // Eviction is scoped to the asset whose token moved — bumping one model must not discard
    // every other cached asset.
    expect(cache.entries.size).toBe(2)
    expect([...cache.entries.keys()].some((key) => key.includes('other.bin'))).toBe(true)
  })
})

describe('hasCachedModelAsset', () => {
  it('is true only for an entry stored at exactly this version', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS))
    await fetchModelAsset(SPEC)

    await expect(hasCachedModelAsset(SPEC)).resolves.toBe(true)
    await expect(hasCachedModelAsset({ ...SPEC, version: 'v2' })).resolves.toBe(false)
  })

  it('is false, never a rejection, when the cache is absent or its read throws', async () => {
    await expect(hasCachedModelAsset(SPEC)).resolves.toBe(false)

    const cache = new FakeCache()
    cache.throwOnMatch = true
    installCache(cache)
    await expect(hasCachedModelAsset(SPEC)).resolves.toBe(false)
  })
})

describe('fetchModelAsset — an unusable cache is not a download failure', () => {
  it('downloads normally when `caches` is absent entirely', async () => {
    // No stub at all: jsdom has no Cache Storage, which is exactly the "absent" case.
    const fetchMock = fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('downloads normally when reading `caches` throws', async () => {
    // Private browsing / blocked site data can make the mere ACCESS throw, not just `open`.
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      get() {
        throw new Error('site data blocked')
      },
    })
    try {
      fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))
      await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
    } finally {
      Reflect.deleteProperty(globalThis, 'caches')
    }
  })

  it('downloads normally when `caches.open` rejects', async () => {
    installCache(null, true)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
  })

  it('treats a throwing cache read as a miss and still downloads', async () => {
    const cache = new FakeCache()
    cache.throwOnMatch = true
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
  })

  it('resolves with the asset even when the cache write throws', async () => {
    const cache = new FakeCache()
    cache.throwOnPut = true
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    // Quota exceeded is the realistic case, and re-downloading next time is the only cost.
    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
    expect(cache.putCalls).toBe(1)
  })

  it('still stores the asset when the eviction scan throws', async () => {
    const cache = new FakeCache()
    cache.throwOnKeys = true
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))

    await expect(fetchModelAsset(SPEC)).resolves.toEqual(BYTES)
    expect(cache.entries.size).toBe(1)
  })

  it('rejects when the DOWNLOAD itself fails, rather than resolving with nothing', async () => {
    installCache(new FakeCache())
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))

    await expect(fetchModelAsset(SPEC)).rejects.toThrow(/404/)
  })
})

describe('fetchModelAsset — byte progress', () => {
  function record(): { events: ModelAssetProgressEvent[]; listener: ModelAssetProgressListener } {
    const events: ModelAssetProgressEvent[] = []
    return {
      events,
      listener: (event) => {
        events.push(event)
      },
    }
  }

  it('reports loaded bytes against a trustworthy Content-Length', async () => {
    installCache(new FakeCache())
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))
    const { events, listener } = record()

    await fetchModelAsset(SPEC, listener)

    expect(events[0]).toEqual({ assetId: SPEC.id, loadedBytes: 0, totalBytes: TOTAL })
    expect(events.at(-1)).toEqual({ assetId: SPEC.id, loadedBytes: TOTAL, totalBytes: TOTAL })
    // Monotonic, and never over 100% of a declared total.
    let previous = -1
    for (const event of events) {
      expect(event.loadedBytes).toBeGreaterThanOrEqual(previous)
      previous = event.loadedBytes
      if (event.totalBytes !== null) expect(event.loadedBytes).toBeLessThanOrEqual(event.totalBytes)
    }
  })

  it('reports NO total when Content-Length is missing', async () => {
    installCache(new FakeCache())
    fetchReturning(streamedResponse(CHUNKS))
    const { events, listener } = record()

    await fetchModelAsset(SPEC, listener)

    // Absent for the whole download, rather than an invented total. The one determinate reading is
    // the last: by then the size is measured, not guessed.
    expect(events.slice(0, -1).every((event) => event.totalBytes === null)).toBe(true)
    expect(events.at(-1)).toEqual({ assetId: SPEC.id, loadedBytes: TOTAL, totalBytes: TOTAL })
  })

  it('distrusts Content-Length on a content-encoded response', async () => {
    // Measured on the tasks-vision WASM (`strides-utn.2`): 3,124,166 declared against 11,756,954
    // decoded, so a naive loaded/total reads ~376%. Decided per response, never globally.
    installCache(new FakeCache())
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': '3', 'content-encoding': 'br' }))
    const { events, listener } = record()

    await fetchModelAsset(SPEC, listener)

    expect(events[0].totalBytes).toBeNull()
  })

  it('drops to indeterminate when the body overruns a declared total', async () => {
    // The other half of the trust decision: a cross-origin response only exposes
    // `content-encoding` when the server lists it, so the header check alone cannot catch this.
    installCache(new FakeCache())
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': '3' }))
    const { events, listener } = record()

    await fetchModelAsset(SPEC, listener)

    expect(events[0].totalBytes).toBe(3)
    expect(events.some((event) => event.totalBytes === null)).toBe(true)
    expect(events.every((event) => event.totalBytes === null || event.loadedBytes <= event.totalBytes)).toBe(true)
  })

  it('reports a cache hit as complete, so a part-cached multi-file load still totals', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchReturning(streamedResponse(CHUNKS, { 'content-length': String(TOTAL) }))
    await fetchModelAsset(SPEC)

    const { events, listener } = record()
    await fetchModelAsset(SPEC, listener)

    expect(events).toEqual([{ assetId: SPEC.id, loadedBytes: TOTAL, totalBytes: TOTAL }])
  })
})

describe('aggregateModelAssetProgress', () => {
  function collect(): { readings: (ModelLoadProgress | null)[]; emit: (p: ModelLoadProgress | null) => void } {
    const readings: (ModelLoadProgress | null)[] = []
    return { readings, emit: (progress) => readings.push(progress) }
  }

  it('sums several files into one reading', async () => {
    const { readings, emit } = collect()
    const listener = aggregateModelAssetProgress(emit)

    listener({ assetId: 'a', loadedBytes: 10, totalBytes: 100 })
    listener({ assetId: 'b', loadedBytes: 5, totalBytes: 50 })
    listener({ assetId: 'a', loadedBytes: 40, totalBytes: 100 })

    expect(readings).toEqual([
      { loadedBytes: 10, totalBytes: 100 },
      { loadedBytes: 15, totalBytes: 150 },
      { loadedBytes: 45, totalBytes: 150 },
    ])
  })

  it('goes indeterminate when ANY file s total is unknown', () => {
    const { readings, emit } = collect()
    const listener = aggregateModelAssetProgress(emit)

    listener({ assetId: 'a', loadedBytes: 10, totalBytes: 100 })
    listener({ assetId: 'b', loadedBytes: 5, totalBytes: null })

    // Summing only the totals that happen to be known would report a total that is not the total —
    // the same dishonesty as inventing one.
    expect(readings.at(-1)).toBeNull()
  })

  it('recovers a determinate reading once the unknown file finishes and names its size', () => {
    const { readings, emit } = collect()
    const listener = aggregateModelAssetProgress(emit)

    listener({ assetId: 'a', loadedBytes: 100, totalBytes: 100 })
    listener({ assetId: 'b', loadedBytes: 5, totalBytes: null })
    listener({ assetId: 'b', loadedBytes: 60, totalBytes: 60 })

    expect(readings.at(-1)).toEqual({ loadedBytes: 160, totalBytes: 160 })
  })

  it('accepts a total declared before the fetch starts', () => {
    // Seeding is supported for any caller that genuinely knows a size up front. MoveNet turned out
    // NOT to be one — its manifest declares per-weight shapes, not the per-shard split — so this
    // asserts the aggregate's contract, not a path `strides-utn.4` took.
    const { readings, emit } = collect()
    const listener = aggregateModelAssetProgress(emit)

    listener({ assetId: 'shard1', loadedBytes: 0, totalBytes: 4_194_304 })
    listener({ assetId: 'shard2', loadedBytes: 0, totalBytes: 455_912 })

    expect(readings.at(-1)).toEqual({ loadedBytes: 0, totalBytes: 4_650_216 })
  })
})
