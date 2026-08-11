import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVideoSource } from './useVideoSource'

function attachDetachedVideo(videoRef: { current: HTMLVideoElement | null }) {
  const video = document.createElement('video')
  videoRef.current = video
  return video
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useVideoSource', () => {
  it('starts in the empty state', () => {
    const { result } = renderHook(() => useVideoSource())
    expect(result.current.status).toBe('empty')
    expect(result.current.metadata).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('does nothing if load() is called with no video element attached', () => {
    const { result } = renderHook(() => useVideoSource())
    act(() => {
      result.current.load(new Blob(['x']))
    })
    expect(result.current.status).toBe('empty')
  })

  it('transitions to loading, then ready, once metadata loads', () => {
    const { result } = renderHook(() => useVideoSource())
    const video = attachDetachedVideo(result.current.videoRef)

    act(() => {
      result.current.load(new Blob(['x'], { type: 'video/webm' }))
    })
    expect(result.current.status).toBe('loading')
    expect(result.current.metadata).toBeNull()
    expect(result.current.error).toBeNull()
    expect(video.src).toContain('blob:')

    Object.defineProperty(video, 'duration', {
      value: 12.5,
      configurable: true,
    })
    Object.defineProperty(video, 'videoWidth', {
      value: 1280,
      configurable: true,
    })
    Object.defineProperty(video, 'videoHeight', {
      value: 720,
      configurable: true,
    })

    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.metadata).toEqual({
      durationSec: 12.5,
      width: 1280,
      height: 720,
      frameRate: null,
    })
  })

  it('threads frameRateHint through to metadata when provided', () => {
    const { result } = renderHook(() => useVideoSource())
    const video = attachDetachedVideo(result.current.videoRef)

    act(() => {
      result.current.load(new Blob(['x']), { frameRateHint: 30 })
    })

    Object.defineProperty(video, 'duration', { value: 5, configurable: true })
    Object.defineProperty(video, 'videoWidth', {
      value: 640,
      configurable: true,
    })
    Object.defineProperty(video, 'videoHeight', {
      value: 480,
      configurable: true,
    })

    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(result.current.metadata?.frameRate).toBe(30)
  })

  it('transitions to the error state on a native error event', () => {
    const { result } = renderHook(() => useVideoSource())
    const video = attachDetachedVideo(result.current.videoRef)

    act(() => {
      result.current.load(new Blob(['x']))
    })

    Object.defineProperty(video, 'error', {
      value: { code: 4 },
      configurable: true,
    })

    act(() => {
      video.dispatchEvent(new Event('error'))
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error?.kind).toBe('unsupported-format')
    expect(result.current.error?.message.length).toBeGreaterThan(0)
  })

  it('clears srcObject defensively when loading', () => {
    const { result } = renderHook(() => useVideoSource())
    const video = attachDetachedVideo(result.current.videoRef)
    video.srcObject = {} as MediaStream

    act(() => {
      result.current.load(new Blob(['x']))
    })

    expect(video.srcObject).toBeNull()
  })

  it('revokes the previous object URL when load is called again', () => {
    const { result } = renderHook(() => useVideoSource())
    attachDetachedVideo(result.current.videoRef)
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')

    act(() => {
      result.current.load(new Blob(['first']))
    })
    act(() => {
      result.current.load(new Blob(['second']))
    })

    expect(revokeSpy).toHaveBeenCalledTimes(1)
  })

  it('reset() returns to empty and clears metadata/error', () => {
    const { result } = renderHook(() => useVideoSource())
    const video = attachDetachedVideo(result.current.videoRef)

    act(() => {
      result.current.load(new Blob(['x']))
    })
    Object.defineProperty(video, 'duration', { value: 1, configurable: true })
    Object.defineProperty(video, 'videoWidth', { value: 1, configurable: true })
    Object.defineProperty(video, 'videoHeight', {
      value: 1,
      configurable: true,
    })
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(result.current.status).toBe('ready')

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('empty')
    expect(result.current.metadata).toBeNull()
    expect(result.current.error).toBeNull()
    expect(revokeSpy).toHaveBeenCalledTimes(1)
  })

  it('revokes the object URL on unmount', () => {
    const { result, unmount } = renderHook(() => useVideoSource())
    attachDetachedVideo(result.current.videoRef)

    act(() => {
      result.current.load(new Blob(['x']))
    })

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    unmount()

    expect(revokeSpy).toHaveBeenCalledTimes(1)
  })
})
