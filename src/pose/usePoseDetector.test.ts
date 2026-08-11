import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from './detector'

const { createDetectorMock } = vi.hoisted(() => ({
  createDetectorMock: vi.fn(),
}))

vi.mock('./detector', () => ({
  createDetector: createDetectorMock,
}))

import { usePoseDetector } from './usePoseDetector'

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

beforeEach(() => {
  createDetectorMock.mockReset()
})

describe('usePoseDetector', () => {
  it('starts loading and transitions to ready once the detector resolves', async () => {
    const fakeDetector = makeFakeDetector()
    createDetectorMock.mockResolvedValue(fakeDetector)

    const { result } = renderHook(() => usePoseDetector())

    expect(result.current.status).toBe('loading')
    expect(result.current.detector).toBeNull()

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.detector).toBe(fakeDetector)
  })

  it('reports status: "error" and detector: null when creation fails', async () => {
    createDetectorMock.mockRejectedValue(new Error('no webgl'))

    const { result } = renderHook(() => usePoseDetector())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.detector).toBeNull()
  })

  it('creates the detector only once even under re-renders', async () => {
    const fakeDetector = makeFakeDetector()
    createDetectorMock.mockResolvedValue(fakeDetector)

    const { result, rerender } = renderHook(() => usePoseDetector())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    rerender()
    rerender()

    expect(createDetectorMock).toHaveBeenCalledTimes(1)
  })

  it('disposes the cached detector on unmount', async () => {
    const fakeDetector = makeFakeDetector()
    createDetectorMock.mockResolvedValue(fakeDetector)

    const { result, unmount } = renderHook(() => usePoseDetector())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    unmount()

    expect(fakeDetector.dispose).toHaveBeenCalledTimes(1)
  })
})
