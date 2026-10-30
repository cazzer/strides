import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('./backends/mediapipePoseLandmarker', () => ({
  createMediaPipeOutlineSegmenter: createMock,
}))

import {
  OUTLINE_SEGMENTER_IDLE_CLOSE_MS,
  __disposeOutlineSegmenterForTests,
  getOutlineSegmenter,
  releaseOutlineSegmenter,
} from './outlinePassDetector'

function fakeSegmenter() {
  return { segment: vi.fn(), close: vi.fn() }
}

beforeEach(() => {
  vi.useFakeTimers()
  createMock.mockReset()
  createMock.mockImplementation(async () => fakeSegmenter())
})

afterEach(() => {
  __disposeOutlineSegmenterForTests()
  vi.useRealTimers()
})

describe('the outline-pass segmenter (strides-uz48)', () => {
  it('shares one instance between back-to-back passes', async () => {
    const first = await getOutlineSegmenter()
    releaseOutlineSegmenter()
    vi.advanceTimersByTime(OUTLINE_SEGMENTER_IDLE_CLOSE_MS - 1)
    const second = await getOutlineSegmenter()
    releaseOutlineSegmenter()
    expect(second).toBe(first)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('closes the second GPU graph once idle, and recreates it on demand', async () => {
    const first = await getOutlineSegmenter()
    releaseOutlineSegmenter()
    expect(first!.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(OUTLINE_SEGMENTER_IDLE_CLOSE_MS)
    expect(first!.close).toHaveBeenCalledTimes(1)
    const again = await getOutlineSegmenter()
    expect(again).not.toBe(first)
    expect(createMock).toHaveBeenCalledTimes(2)
    releaseOutlineSegmenter()
  })

  it('never closes while a pass still holds it', async () => {
    const held = await getOutlineSegmenter()
    await getOutlineSegmenter()
    releaseOutlineSegmenter()
    vi.advanceTimersByTime(10 * OUTLINE_SEGMENTER_IDLE_CLOSE_MS)
    expect(held!.close).not.toHaveBeenCalled()
    releaseOutlineSegmenter()
    vi.advanceTimersByTime(OUTLINE_SEGMENTER_IDLE_CLOSE_MS)
    expect(held!.close).toHaveBeenCalledTimes(1)
  })

  it('resolves null on a failed creation, and retries on the next pass', async () => {
    createMock.mockRejectedValueOnce(new Error('wasm'))
    expect(await getOutlineSegmenter()).toBeNull()
    releaseOutlineSegmenter()
    expect(await getOutlineSegmenter()).not.toBeNull()
    releaseOutlineSegmenter()
    expect(createMock).toHaveBeenCalledTimes(2)
  })
})
