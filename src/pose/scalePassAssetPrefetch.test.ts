import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveUrlsMock } = vi.hoisted(() => ({ resolveUrlsMock: vi.fn() }))

vi.mock('./backends/mediapipePoseLandmarker', () => ({
  resolveMediaPipePoseLandmarkerAssetUrls: resolveUrlsMock,
}))

import {
  cancelScalePassAssetPrefetch,
  prefetchScalePassAssets,
  resetScalePassAssetPrefetchForTests,
} from './scalePassAssetPrefetch'

const URLS = ['loader.js', 'binary.wasm', 'model.task']

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('prefetchScalePassAssets', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetScalePassAssetPrefetchForTests()
    resolveUrlsMock.mockResolvedValue(URLS)
    fetchMock = vi.fn(async () => new Response('bytes'))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches every asset URL detector creation will request, at low priority', async () => {
    prefetchScalePassAssets()
    await flush()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(URLS)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ priority: 'low' })
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('runs at most once per page', async () => {
    prefetchScalePassAssets()
    prefetchScalePassAssets()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(URLS.length)
  })

  it('aborts in-flight requests when cancelled', async () => {
    let seenSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      seenSignal = init.signal ?? undefined
      return new Promise(() => {})
    })
    prefetchScalePassAssets()
    await flush()
    cancelScalePassAssetPrefetch()
    expect(seenSignal?.aborted).toBe(true)
  })

  it('issues no request when cancelled before the URLs resolve', async () => {
    prefetchScalePassAssets()
    cancelScalePassAssetPrefetch()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows failures', async () => {
    resolveUrlsMock.mockRejectedValue(new Error('no wasm'))
    prefetchScalePassAssets()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
