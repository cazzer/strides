import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipPoster } from './posterFrame'
import type { VideoSource } from './types'

const { deriveClipPosterMock } = vi.hoisted(() => ({ deriveClipPosterMock: vi.fn() }))

// Only the decode is mocked — `releaseClipPoster` stays real, because what this file is testing is
// that it gets CALLED at the right moments on the right object.
vi.mock('./posterFrame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./posterFrame')>()),
  deriveClipPoster: deriveClipPosterMock,
}))

import { useClipPoster } from './useClipPoster'

function makePoster(): ClipPoster {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 135
  return { canvas, width: 240, height: 135, timestamp: 0.8 }
}

function makeSource(overrides: Partial<VideoSource> = {}): VideoSource {
  return {
    videoRef: { current: null },
    status: 'ready',
    metadata: { durationSec: 8, width: 1920, height: 1080, frameRate: null },
    error: null,
    sourceBlob: new Blob(['clip-bytes']),
    load: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

/** Released == the backing store is gone. The recorded `width`/`height` deliberately survive. */
function isReleased(poster: ClipPoster): boolean {
  return poster.canvas.width === 0 && poster.canvas.height === 0
}

beforeEach(() => {
  deriveClipPosterMock.mockReset()
  deriveClipPosterMock.mockResolvedValue(null)
})

describe('useClipPoster', () => {
  it('derives from the blob and metadata, never from the clip’s own element', async () => {
    const poster = makePoster()
    deriveClipPosterMock.mockResolvedValue(poster)
    const source = makeSource()

    const { result } = renderHook(() => useClipPoster(source))

    await waitFor(() => expect(result.current).toBe(poster))
    // The non-disturbance guarantee, asserted at the seam: two arguments, neither of them the
    // canonical `<video>` the sampling loop reads frames off.
    expect(deriveClipPosterMock).toHaveBeenCalledWith(source.sourceBlob, source.metadata)
  })

  it('stays null, and decodes nothing, until the source is ready', async () => {
    const { result, rerender } = renderHook(({ source }) => useClipPoster(source), {
      initialProps: { source: makeSource({ status: 'loading', metadata: null }) },
    })

    expect(result.current).toBeNull()
    expect(deriveClipPosterMock).not.toHaveBeenCalled()

    const poster = makePoster()
    deriveClipPosterMock.mockResolvedValue(poster)
    rerender({ source: makeSource() })

    await waitFor(() => expect(result.current).toBe(poster))
  })

  it('releases the poster on unmount', async () => {
    const poster = makePoster()
    deriveClipPosterMock.mockResolvedValue(poster)
    // One stable source across renders, as a real `useVideoSource` gives (its blob and metadata
    // are state, not values rebuilt per render).
    const source = makeSource()
    const { result, unmount } = renderHook(() => useClipPoster(source))

    await waitFor(() => expect(result.current).toBe(poster))
    unmount()

    expect(isReleased(poster)).toBe(true)
  })

  it('releases and forgets the old poster when the source is reset', async () => {
    const poster = makePoster()
    deriveClipPosterMock.mockResolvedValue(poster)
    const { result, rerender } = renderHook(({ source }) => useClipPoster(source), {
      initialProps: { source: makeSource() },
    })
    await waitFor(() => expect(result.current).toBe(poster))

    rerender({ source: makeSource({ status: 'empty', sourceBlob: null, metadata: null }) })

    expect(result.current).toBeNull()
    expect(isReleased(poster)).toBe(true)
  })

  it('releases a poster that lands after the hook has already gone away', async () => {
    const poster = makePoster()
    let resolve: (value: ClipPoster) => void = () => {}
    deriveClipPosterMock.mockReturnValue(
      new Promise<ClipPoster>((r) => {
        resolve = r
      }),
    )
    const source = makeSource()
    const { unmount } = renderHook(() => useClipPoster(source))

    // The race the cleanup alone cannot cover: at unmount there is nothing to free yet, and the
    // decode is still in flight. Nothing will ever render what it produces.
    unmount()
    resolve(poster)
    await waitFor(() => expect(isReleased(poster)).toBe(true))
  })
})
