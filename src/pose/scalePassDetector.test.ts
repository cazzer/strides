import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from './detector'

const { createDetectorMock } = vi.hoisted(() => ({
  createDetectorMock: vi.fn(),
}))

vi.mock('./detector', () => ({
  createDetector: createDetectorMock,
}))

import {
  getScalePassDetector,
  getScalePassDetectorLoadState,
  subscribeToScalePassDetectorLoad,
  __disposeForTests,
} from './scalePassDetector'
import type { ModelLoadState } from './modelLoadState'

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

beforeEach(() => {
  createDetectorMock.mockReset()
  __disposeForTests()
})

afterEach(() => {
  delete window.__STRIDES_POSE_BACKEND_OVERRIDE__
})

describe('getScalePassDetector', () => {
  it('creates the detector lazily, only on first request', async () => {
    const fakeDetector = makeFakeDetector()
    createDetectorMock.mockResolvedValue(fakeDetector)

    expect(createDetectorMock).not.toHaveBeenCalled()
    await expect(getScalePassDetector()).resolves.toBe(fakeDetector)
    expect(createDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('caches the instance — one createDetector call across two gets', async () => {
    const fakeDetector = makeFakeDetector()
    createDetectorMock.mockResolvedValue(fakeDetector)

    const first = await getScalePassDetector()
    const second = await getScalePassDetector()

    expect(first).toBe(fakeDetector)
    expect(second).toBe(fakeDetector)
    expect(createDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('hardcodes the mediapipePoseLandmarker backend even with the pose backend override set', async () => {
    // The __STRIDES_POSE_BACKEND_OVERRIDE__ global selects the PRIMARY pass's backend only —
    // the scale pass must never read it (its whole reason to exist is that MediaPipe is the one
    // backend measuring a real-world scale).
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'movenet' }
    createDetectorMock.mockResolvedValue(makeFakeDetector())

    await getScalePassDetector()

    // Asserted on the CONFIG argument specifically, not the whole call: `createDetector` also
    // takes per-creation wiring (the model-asset progress sink, `strides-utn.3`), and what this
    // test is about is that no part of the override reaches the backend selection.
    expect(createDetectorMock.mock.calls[0][0]).toEqual({
      backend: 'mediapipePoseLandmarker',
    })
  })

  it('resolves to null on creation failure, then retries on the next request', async () => {
    const fakeDetector = makeFakeDetector()
    createDetectorMock
      .mockRejectedValueOnce(new Error('wasm fetch failed'))
      .mockResolvedValueOnce(fakeDetector)

    await expect(getScalePassDetector()).resolves.toBeNull()
    // The failed promise was reset, so the next request attempts creation again rather than
    // returning a cached rejection.
    await expect(getScalePassDetector()).resolves.toBe(fakeDetector)
    expect(createDetectorMock).toHaveBeenCalledTimes(2)
  })
})

describe('the scale-pass detector load channel', () => {
  function recordPhases(): { phases: string[]; unsubscribe: () => void } {
    const phases: string[] = []
    const unsubscribe = subscribeToScalePassDetectorLoad((state: ModelLoadState) => {
      phases.push(state.phase)
    })
    return { phases, unsubscribe }
  }

  it('reads idle until something first requests the detector', () => {
    expect(getScalePassDetectorLoadState()).toEqual({ phase: 'idle', progress: null })
  })

  it('does not create a detector merely because something subscribed', () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())

    const { unsubscribe } = recordPhases()

    // An observation channel that triggered the thing it observes would turn this lazy 9.4 MB
    // fetch into an eager one on every page load — the exact cost `strides-utn` declined to take.
    expect(createDetectorMock).not.toHaveBeenCalled()
    expect(getScalePassDetectorLoadState().phase).toBe('idle')
    unsubscribe()
  })

  it('delivers loading then ready to its subscribers', async () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())
    const { phases, unsubscribe } = recordPhases()

    await getScalePassDetector()

    expect(phases).toEqual(['loading', 'ready'])
    expect(getScalePassDetectorLoadState()).toEqual({ phase: 'ready', progress: null })
    unsubscribe()
  })

  it('delivers error on a failed creation, then loading again on the retry', async () => {
    createDetectorMock
      .mockRejectedValueOnce(new Error('wasm fetch failed'))
      .mockResolvedValueOnce(makeFakeDetector())
    const { phases, unsubscribe } = recordPhases()

    await getScalePassDetector()
    expect(phases).toEqual(['loading', 'error'])

    await getScalePassDetector()
    expect(phases).toEqual(['loading', 'error', 'loading', 'ready'])
    unsubscribe()
  })

  it('announces one loading transition when two callers race the same creation', async () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())
    const { phases, unsubscribe } = recordPhases()

    await Promise.all([getScalePassDetector(), getScalePassDetector()])

    // Both callers reach the success branch and both announce 'ready'; the channel publishes by
    // value, so the second one is dropped rather than handed out under a fresh identity. Under
    // `useSyncExternalStore`'s `Object.is` comparison a duplicate would cost a redundant render.
    expect(phases).toEqual(['loading', 'ready'])
    unsubscribe()
  })

  it('delivers the model asset s byte progress while loading, and drops it on ready', async () => {
    // The `.task` is 9.4 MB and GitHub Pages caps its max-age at 600s, so this is the download the
    // reader was previously left waiting on with nothing on screen (`strides-utn.3`).
    let resolveDetector: (detector: PoseDetector) => void = () => {}
    createDetectorMock.mockImplementation(
      () => new Promise<PoseDetector>((resolve) => (resolveDetector = resolve)),
    )
    const states: ModelLoadState[] = []
    const unsubscribe = subscribeToScalePassDetectorLoad((state) => states.push(state))

    const pending = getScalePassDetector()
    const { onAssetProgress } = createDetectorMock.mock.calls[0][1]
    onAssetProgress({ assetId: 'task', loadedBytes: 2_000_000, totalBytes: 9_398_198 })

    expect(getScalePassDetectorLoadState()).toEqual({
      phase: 'loading',
      progress: { loadedBytes: 2_000_000, totalBytes: 9_398_198 },
    })

    resolveDetector(makeFakeDetector())
    await pending

    expect(getScalePassDetectorLoadState()).toEqual({ phase: 'ready', progress: null })
    expect(states.map((state) => state.phase)).toEqual(['loading', 'loading', 'ready'])
    unsubscribe()
  })

  it('ignores a straggling progress report from a superseded attempt', async () => {
    createDetectorMock
      .mockRejectedValueOnce(new Error('wasm fetch failed'))
      .mockResolvedValueOnce(makeFakeDetector())

    await getScalePassDetector()
    const { onAssetProgress: staleSink } = createDetectorMock.mock.calls[0][1]

    const retry = getScalePassDetector()
    // The abandoned attempt's in-flight fetch can still deliver. Repainting the fresh attempt's
    // reading with the old one's byte counts would be a bar that jumps backwards for no reason.
    staleSink({ assetId: 'task', loadedBytes: 8_000_000, totalBytes: 9_398_198 })

    expect(getScalePassDetectorLoadState()).toEqual({ phase: 'loading', progress: null })
    await retry
  })

  it('stops delivering once unsubscribed', async () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())
    const { phases, unsubscribe } = recordPhases()

    unsubscribe()
    await getScalePassDetector()

    expect(phases).toEqual([])
  })

  it('keeps the page-lifetime cache and the backend-override exemption while observed', async () => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: 'movenet' }
    const fakeDetector = makeFakeDetector()
    createDetectorMock.mockResolvedValue(fakeDetector)
    const { unsubscribe } = recordPhases()

    const first = await getScalePassDetector()
    const second = await getScalePassDetector()

    expect(first).toBe(fakeDetector)
    expect(second).toBe(fakeDetector)
    expect(createDetectorMock).toHaveBeenCalledTimes(1)
    expect(createDetectorMock.mock.calls[0][0]).toEqual({
      backend: 'mediapipePoseLandmarker',
    })
    unsubscribe()
  })
})
