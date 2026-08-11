import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkeletonOverlay } from './SkeletonOverlay'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import type { VideoMetadata } from '../video/types'

const METADATA: VideoMetadata = {
  durationSec: 4,
  width: 640,
  height: 480,
  frameRate: 30,
}

describe('SkeletonOverlay', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>
  let cafSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    rafSpy.mockRestore()
    cafSpy.mockRestore()
  })

  it('draws points and edges from the nearest frame on mount while paused', () => {
    const ctx = stubCanvas2DContext()
    const video = document.createElement('video')
    const videoRef = { current: video }
    const frames = [
      buildFrame(
        { left_shoulder: { x: 10, y: 20 }, left_hip: { x: 10, y: 100 } },
        0,
      ),
    ]

    render(<SkeletonOverlay videoRef={videoRef} frames={frames} metadata={METADATA} />)

    expect(ctx.clearRect).toHaveBeenCalled()
    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.lineTo).toHaveBeenCalled()
  })

  it('sets canvas width/height from metadata (native pixel space)', () => {
    stubCanvas2DContext()
    const video = document.createElement('video')
    const videoRef = { current: video }

    const { container } = render(
      <SkeletonOverlay videoRef={videoRef} frames={[]} metadata={METADATA} />,
    )
    const canvas = container.querySelector('canvas')
    expect(canvas).toHaveAttribute('width', '640')
    expect(canvas).toHaveAttribute('height', '480')
  })

  it('starts an rAF loop on play and stops it (drawing once more) on pause', () => {
    const ctx = stubCanvas2DContext()
    const video = document.createElement('video')
    const videoRef = { current: video }

    render(<SkeletonOverlay videoRef={videoRef} frames={[]} metadata={METADATA} />)

    rafSpy.mockClear()
    act(() => {
      video.dispatchEvent(new Event('play'))
    })
    expect(rafSpy).toHaveBeenCalledTimes(1)

    const drawCallsBeforePause = ctx.clearRect.mock.calls.length
    act(() => {
      video.dispatchEvent(new Event('pause'))
    })
    expect(cafSpy).toHaveBeenCalledTimes(1)
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(drawCallsBeforePause)
  })

  it('stops the rAF loop on ended too', () => {
    stubCanvas2DContext()
    const video = document.createElement('video')
    const videoRef = { current: video }

    render(<SkeletonOverlay videoRef={videoRef} frames={[]} metadata={METADATA} />)

    act(() => {
      video.dispatchEvent(new Event('play'))
    })
    act(() => {
      video.dispatchEvent(new Event('ended'))
    })
    expect(cafSpy).toHaveBeenCalledTimes(1)
  })

  it('redraws on seeked and timeupdate', () => {
    const ctx = stubCanvas2DContext()
    const video = document.createElement('video')
    const videoRef = { current: video }

    render(<SkeletonOverlay videoRef={videoRef} frames={[]} metadata={METADATA} />)

    const before = ctx.clearRect.mock.calls.length
    act(() => {
      video.dispatchEvent(new Event('timeupdate'))
    })
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(before)

    const beforeSeek = ctx.clearRect.mock.calls.length
    act(() => {
      video.dispatchEvent(new Event('seeked'))
    })
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(beforeSeek)
  })

  it('does not throw when getContext returns null (no canvas support in the environment)', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
    const video = document.createElement('video')
    const videoRef = { current: video }

    expect(() =>
      render(<SkeletonOverlay videoRef={videoRef} frames={[]} metadata={METADATA} />),
    ).not.toThrow()
  })
})
