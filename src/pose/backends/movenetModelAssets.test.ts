import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MOVENET_MODEL_URLS,
  createMoveNetModelLoader,
  resolveMoveNetModelSource,
} from './movenetModelAssets'
import type { ModelAssetProgressEvent } from '../modelAssetCache'

/**
 * The installed package's OWN model URLs, deep-imported because they are not on its public entry
 * point. This is the assertion that keeps `MOVENET_MODEL_URLS` honest across dependency upgrades —
 * see that constant's doc, and `strides-8w2`.
 */
import * as movenetConstants from '@tensorflow-models/pose-detection/dist/movenet/constants'

/** Cache Storage stand-in: jsdom implements none of it. Mirrors `modelAssetCache.test.ts`'s. */
class FakeCache {
  readonly entries = new Map<string, Uint8Array<ArrayBuffer>>()

  async match(key: string): Promise<Response | undefined> {
    const stored = this.entries.get(key)
    return stored ? new Response(stored) : undefined
  }

  async put(key: string, response: Response): Promise<void> {
    this.entries.set(key, new Uint8Array(await response.arrayBuffer()))
  }

  async keys(): Promise<{ url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }))
  }

  async delete(request: { url: string }): Promise<boolean> {
    return this.entries.delete(request.url)
  }
}

function installCache(cache: FakeCache | null): void {
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
}

const MODEL_URL = 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4'
const ID_PREFIX = 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning'
const SUFFIX = '?tfjs-format=file'

const SHARD_1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const SHARD_2 = new Uint8Array([9, 10, 11, 12])

/**
 * A two-shard manifest whose specs really do describe the shard bytes above: 3 float32 values
 * (12 bytes) split 8/4 across two files, so `decodeWeights` would accept it unchanged.
 */
const MODEL_JSON = {
  format: 'graph-model',
  generatedBy: '2.7.0',
  convertedBy: 'TensorFlow.js Converter v3.9.0',
  modelTopology: { node: [], versions: { producer: 808, minConsumer: 12 } },
  weightsManifest: [
    {
      paths: ['group1-shard1of2.bin', 'group1-shard2of2.bin'],
      weights: [
        { name: 'a', shape: [2], dtype: 'float32' },
        { name: 'b', shape: [1], dtype: 'float32' },
      ],
    },
  ],
  signature: { inputs: {}, outputs: {} },
}

function jsonResponse(body: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  })
}

function binaryResponse(bytes: Uint8Array<ArrayBuffer>, declareLength = true): Response {
  return new Response(bytes, {
    status: 200,
    headers: declareLength ? { 'content-length': String(bytes.byteLength) } : {},
  })
}

/**
 * Answers by URL rather than by call order: the shards are fetched in parallel, so a
 * `mockResolvedValueOnce` queue would couple the test to `Promise.all`'s scheduling.
 */
function fetchByUrl(
  routes: Record<string, () => Response>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn((url: string) => {
    const make = routes[url]
    if (!make) throw new Error(`unexpected fetch: ${url}`)
    return Promise.resolve(make())
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function defaultRoutes(options: { declareShardLength?: boolean } = {}): Record<
  string,
  () => Response
> {
  const declare = options.declareShardLength ?? true
  return {
    [`${MODEL_URL}/model.json${SUFFIX}`]: () => jsonResponse(MODEL_JSON),
    [`${MODEL_URL}/group1-shard1of2.bin${SUFFIX}`]: () =>
      binaryResponse(SHARD_1, declare),
    [`${MODEL_URL}/group1-shard2of2.bin${SUFFIX}`]: () =>
      binaryResponse(SHARD_2, declare),
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MOVENET_MODEL_URLS', () => {
  it('matches the installed pose-detection package own model URLs', () => {
    expect(MOVENET_MODEL_URLS['singlepose-lightning']).toBe(
      movenetConstants.MOVENET_SINGLEPOSE_LIGHTNING_URL,
    )
    expect(MOVENET_MODEL_URLS['singlepose-thunder']).toBe(
      movenetConstants.MOVENET_SINGLEPOSE_THUNDER_URL,
    )
    expect(MOVENET_MODEL_URLS['multipose-lightning']).toBe(
      movenetConstants.MOVENET_MULTIPOSE_LIGHTNING_URL,
    )
  })
})

describe('resolveMoveNetModelSource', () => {
  it('splits the published version out of the identity, and reproduces tfjs own URLs', () => {
    const source = resolveMoveNetModelSource(MODEL_URL)

    expect(source.assetIdPrefix).toBe(ID_PREFIX)
    expect(source.version).toBe('4')
    expect(source.modelJsonUrl).toBe(`${MODEL_URL}/model.json${SUFFIX}`)
    expect(source.weightUrl('group1-shard1of2.bin')).toBe(
      `${MODEL_URL}/group1-shard1of2.bin${SUFFIX}`,
    )
  })

  it('tolerates a trailing slash the way getTFHubUrl does', () => {
    const slashed = resolveMoveNetModelSource(`${MODEL_URL}/`)
    const bare = resolveMoveNetModelSource(MODEL_URL)

    expect(slashed.assetIdPrefix).toBe(bare.assetIdPrefix)
    expect(slashed.version).toBe(bare.version)
    expect(slashed.modelJsonUrl).toBe(bare.modelJsonUrl)
    expect(slashed.weightUrl('group1-shard1of2.bin')).toBe(
      bare.weightUrl('group1-shard1of2.bin'),
    )
  })

  it('does not read a bare origin host as a version segment', () => {
    // `lastIndexOf('/')` on `https://example.test` lands inside `//`, so a naive split yields
    // identity `https:/` — every bare-origin URL would then share one cache key.
    const source = resolveMoveNetModelSource('https://example.test/model')

    expect(source.assetIdPrefix).toBe('https://example.test/model')
    expect(source.version).toBe('url')
  })

  it('keeps the whole URL as the identity when there is no version segment to split', () => {
    const source = resolveMoveNetModelSource('https://example.test')

    expect(source.assetIdPrefix).toBe('https://example.test')
    expect(source.version).toBe('url')
  })
})

describe('createMoveNetModelLoader', () => {
  it('assembles ModelArtifacts from model.json plus one buffer per manifest shard', async () => {
    installCache(new FakeCache())
    fetchByUrl(defaultRoutes())

    const artifacts = await createMoveNetModelLoader(MODEL_URL).load!()

    expect(artifacts.modelTopology).toEqual(MODEL_JSON.modelTopology)
    expect(artifacts.format).toBe('graph-model')
    expect(artifacts.signature).toEqual(MODEL_JSON.signature)
    // Flattened from the manifest exactly as tfjs `getWeightSpecs` does.
    expect(artifacts.weightSpecs).toEqual([
      { name: 'a', shape: [2], dtype: 'float32' },
      { name: 'b', shape: [1], dtype: 'float32' },
    ])
    // One ArrayBuffer per shard, in manifest order — the shape `decodeWeights` reads.
    expect(Array.isArray(artifacts.weightData)).toBe(true)
    const buffers = artifacts.weightData as ArrayBuffer[]
    expect(buffers).toHaveLength(2)
    expect(new Uint8Array(buffers[0])).toEqual(SHARD_1)
    expect(new Uint8Array(buffers[1])).toEqual(SHARD_2)
  })

  it('fetches the manifest before the shards it names', async () => {
    installCache(new FakeCache())
    const fetchMock = fetchByUrl(defaultRoutes())

    await createMoveNetModelLoader(MODEL_URL).load!()

    const urls = fetchMock.mock.calls.map((call) => call[0] as string)
    expect(urls[0]).toBe(`${MODEL_URL}/model.json${SUFFIX}`)
    expect(urls.slice(1).sort()).toEqual([
      `${MODEL_URL}/group1-shard1of2.bin${SUFFIX}`,
      `${MODEL_URL}/group1-shard2of2.bin${SUFFIX}`,
    ])
  })

  it('caches every file under a version-free, signature-free identity', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchByUrl(defaultRoutes())

    await createMoveNetModelLoader(MODEL_URL).load!()

    expect([...cache.entries.keys()].sort()).toEqual([
      `https://model-asset.strides.invalid/asset/${encodeURIComponent(`${ID_PREFIX}/group1-shard1of2.bin`)}?v=4`,
      `https://model-asset.strides.invalid/asset/${encodeURIComponent(`${ID_PREFIX}/group1-shard2of2.bin`)}?v=4`,
      `https://model-asset.strides.invalid/asset/${encodeURIComponent(`${ID_PREFIX}/model.json`)}?v=4`,
    ])
  })

  it('serves a second load entirely from the cache, with no request at all', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchByUrl(defaultRoutes())

    const first = await createMoveNetModelLoader(MODEL_URL).load!()

    const secondFetch = vi.fn(() => {
      throw new Error('a warm load must not fetch')
    })
    vi.stubGlobal('fetch', secondFetch)

    const second = await createMoveNetModelLoader(MODEL_URL).load!()

    expect(secondFetch).not.toHaveBeenCalled()
    expect(second.weightSpecs).toEqual(first.weightSpecs)
    expect(new Uint8Array((second.weightData as ArrayBuffer[])[0])).toEqual(SHARD_1)
    expect(new Uint8Array((second.weightData as ArrayBuffer[])[1])).toEqual(SHARD_2)
    expect(second.modelTopology).toEqual(first.modelTopology)
  })

  it('hits the cache even though the URL a request resolves to differs every time', async () => {
    // The measured MoveNet reality: two 302s to a per-request V4-signed GCS URL. Keying on
    // anything the network returned would miss here, so the fetched URL is varied deliberately
    // while the caller-supplied identity is held fixed.
    const cache = new FakeCache()
    installCache(cache)
    let signature = 0
    const signedFetch = vi.fn((url: string) => {
      signature += 1
      const routes = defaultRoutes()
      const make = routes[url]
      if (!make) throw new Error(`unexpected fetch: ${url}`)
      const response = make()
      Object.defineProperty(response, 'url', {
        value: `https://storage.googleapis.com/kagglesdsdata/models/1035/1205/x?X-Goog-Signature=${signature}`,
      })
      Object.defineProperty(response, 'redirected', { value: true })
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', signedFetch)

    await createMoveNetModelLoader(MODEL_URL).load!()
    expect(signedFetch).toHaveBeenCalledTimes(3)

    await createMoveNetModelLoader(MODEL_URL).load!()
    expect(signedFetch).toHaveBeenCalledTimes(3)
  })

  it('evicts every file of the superseded model version when the URL version moves', async () => {
    const cache = new FakeCache()
    installCache(cache)
    fetchByUrl(defaultRoutes())

    await createMoveNetModelLoader(MODEL_URL).load!()
    expect([...cache.entries.keys()].every((key) => key.endsWith('?v=4'))).toBe(true)

    const bumpedUrl = `${ID_PREFIX}/5`
    fetchByUrl({
      [`${bumpedUrl}/model.json${SUFFIX}`]: () => jsonResponse(MODEL_JSON),
      [`${bumpedUrl}/group1-shard1of2.bin${SUFFIX}`]: () => binaryResponse(SHARD_1),
      [`${bumpedUrl}/group1-shard2of2.bin${SUFFIX}`]: () => binaryResponse(SHARD_2),
    })
    await createMoveNetModelLoader(bumpedUrl).load!()

    expect([...cache.entries.keys()].every((key) => key.endsWith('?v=5'))).toBe(true)
    expect(cache.entries.size).toBe(3)
  })

  it('reports byte progress per file, tagged with that file identity', async () => {
    installCache(new FakeCache())
    fetchByUrl(defaultRoutes())
    const events: ModelAssetProgressEvent[] = []

    await createMoveNetModelLoader(MODEL_URL, (event) => events.push(event)).load!()

    const byAsset = new Map<string, ModelAssetProgressEvent>()
    for (const event of events) byAsset.set(event.assetId, event)

    expect([...byAsset.keys()].sort()).toEqual([
      `${ID_PREFIX}/group1-shard1of2.bin`,
      `${ID_PREFIX}/group1-shard2of2.bin`,
      `${ID_PREFIX}/model.json`,
    ])
    expect(byAsset.get(`${ID_PREFIX}/group1-shard1of2.bin`)).toEqual({
      assetId: `${ID_PREFIX}/group1-shard1of2.bin`,
      loadedBytes: SHARD_1.byteLength,
      totalBytes: SHARD_1.byteLength,
    })
  })

  it('reports a shard with no readable Content-Length as indeterminate while it downloads', async () => {
    installCache(new FakeCache())
    fetchByUrl(defaultRoutes({ declareShardLength: false }))
    const events: ModelAssetProgressEvent[] = []

    await createMoveNetModelLoader(MODEL_URL, (event) => events.push(event)).load!()

    const shardEvents = events.filter((event) => event.assetId.endsWith('shard1of2.bin'))
    // Indeterminate throughout the download, then closing with the measured size — never an
    // invented total partway through.
    expect(shardEvents.slice(0, -1).every((event) => event.totalBytes === null)).toBe(true)
    expect(shardEvents.at(-1)).toEqual({
      assetId: `${ID_PREFIX}/group1-shard1of2.bin`,
      loadedBytes: SHARD_1.byteLength,
      totalBytes: SHARD_1.byteLength,
    })
  })

  it('still loads with no cache available', async () => {
    installCache(null)
    const fetchMock = fetchByUrl(defaultRoutes())

    const artifacts = await createMoveNetModelLoader(MODEL_URL).load!()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(new Uint8Array((artifacts.weightData as ArrayBuffer[])[0])).toEqual(SHARD_1)
  })

  it('names the manifest URL when the model JSON is not JSON at all', async () => {
    installCache(new FakeCache())
    fetchByUrl({
      [`${MODEL_URL}/model.json${SUFFIX}`]: () =>
        new Response(new TextEncoder().encode('<html>bot check</html>'), { status: 200 }),
    })

    await expect(createMoveNetModelLoader(MODEL_URL).load!()).rejects.toThrow(
      /Failed to parse MoveNet model JSON from .*model\.json/,
    )
  })

  it('rejects a manifest carrying neither topology nor weights', async () => {
    installCache(new FakeCache())
    fetchByUrl({
      [`${MODEL_URL}/model.json${SUFFIX}`]: () => jsonResponse({ format: 'graph-model' }),
    })

    await expect(createMoveNetModelLoader(MODEL_URL).load!()).rejects.toThrow(
      /neither model topology nor a weights manifest/,
    )
  })
})
