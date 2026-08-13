import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from './detector'

const { createDetectorMock } = vi.hoisted(() => ({
  createDetectorMock: vi.fn(),
}))

vi.mock('./detector', () => ({
  createDetector: createDetectorMock,
}))

import { getScalePassDetector, __disposeForTests } from './scalePassDetector'

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

    expect(createDetectorMock).toHaveBeenCalledWith({ backend: 'mediapipePoseLandmarker' })
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
