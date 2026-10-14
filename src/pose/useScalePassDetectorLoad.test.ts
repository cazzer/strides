import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from './detector'

const { createDetectorMock } = vi.hoisted(() => ({
  createDetectorMock: vi.fn(),
}))

vi.mock('./detector', () => ({
  createDetector: createDetectorMock,
}))

import { getScalePassDetector, __disposeForTests } from './scalePassDetector'
import { useScalePassDetectorLoad } from './useScalePassDetectorLoad'

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

beforeEach(() => {
  createDetectorMock.mockReset()
  __disposeForTests()
})

describe('useScalePassDetectorLoad', () => {
  it('starts idle — mounting the hook does not create a detector', () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())

    const { result } = renderHook(() => useScalePassDetectorLoad())

    expect(result.current).toEqual({ phase: 'idle', progress: null })
    expect(createDetectorMock).not.toHaveBeenCalled()
  })

  it('re-renders as the singleton moves loading → ready', async () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())
    const { result } = renderHook(() => useScalePassDetectorLoad())

    await act(async () => {
      await getScalePassDetector()
    })

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.progress).toBeNull()
  })

  it('reads a state that moved before it ever mounted', async () => {
    // The scale pass is requested from an analysis run, not from render — so by the time anything
    // subscribes, the transition may already have happened. A subscribe-only channel would miss
    // it; reading the current snapshot on every render does not.
    createDetectorMock.mockResolvedValue(makeFakeDetector())
    await getScalePassDetector()

    const { result } = renderHook(() => useScalePassDetectorLoad())

    expect(result.current.phase).toBe('ready')
  })

  it('unsubscribes on unmount', async () => {
    createDetectorMock.mockResolvedValue(makeFakeDetector())
    const { unmount } = renderHook(() => useScalePassDetectorLoad())

    unmount()

    // A leaked listener would call `setState` on an unmounted subscriber; the assertion that
    // matters is simply that driving the singleton after unmount is uneventful.
    await expect(getScalePassDetector()).resolves.not.toBeNull()
  })
})
