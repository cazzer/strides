import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoInputPanel } from './VideoInputPanel'
import type { VideoSource } from './types'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeVideoSource(overrides: Partial<VideoSource> = {}): VideoSource {
  return {
    videoRef: createRef<HTMLVideoElement | null>(),
    status: 'empty',
    metadata: null,
    error: null,
    sourceBlob: null,
    load: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

describe('VideoInputPanel', () => {
  it('never renders a picker — choosing a source moved to ClipPicker, which the session owns', () => {
    render(<VideoInputPanel videoSource={makeVideoSource({ status: 'empty' })} />)
    expect(
      screen.queryByRole('button', { name: /start recording/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/choose a video file/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /demo 1 \(side view\)/i }),
    ).not.toBeInTheDocument()
  })

  // The loading line and the load-error alert moved to `ClipLoadStatus` (see its own test file)
  // when this component's element moved into a 96x72 header strip entry — a message nobody can
  // read is not a message. What must NOT come with it is anything readable at all:
  it('renders nothing but the element host — no readable text can live inside a strip entry', () => {
    const { container } = render(
      <VideoInputPanel
        videoSource={makeVideoSource({
          status: 'error',
          error: { kind: 'unsupported-format', message: 'Format not supported.' },
        })}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(container.textContent).toBe('')
  })

  it('renders no reset button when ready -- "Choose a different video" moved to the results column', () => {
    const videoSource = makeVideoSource({
      status: 'ready',
      metadata: { durationSec: 10, width: 640, height: 480, frameRate: null },
    })
    render(<VideoInputPanel videoSource={videoSource} />)

    expect(
      screen.queryByRole('button', { name: /choose a different video/i }),
    ).not.toBeInTheDocument()
  })

  it('always renders the canonical video element with the given ref', () => {
    const videoSource = makeVideoSource({ status: 'ready' })
    const { container } = render(<VideoInputPanel videoSource={videoSource} />)
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toBe(videoSource.videoRef.current)
  })

  it('hides the video element while empty', () => {
    const { container } = render(
      <VideoInputPanel videoSource={makeVideoSource({ status: 'empty' })} />,
    )
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('hidden')
  })

  it('shows the video element once not empty', () => {
    const { container } = render(
      <VideoInputPanel videoSource={makeVideoSource({ status: 'ready' })} />,
    )
    const video = container.querySelector('video')
    expect(video).not.toHaveAttribute('hidden')
  })

  /**
   * The hard constraint (`results-view`, "Clip video elements stay mounted and playable while
   * hidden"), to the extent jsdom can see it at all. It cannot see the important half: there is no
   * media pipeline and no `requestVideoFrameCallback` here, so an element that never presents a
   * frame is indistinguishable from a working one — that half is measured live (G1a) and can only
   * be measured live. What IS observable is that the loaded host uses none of the mechanisms the
   * spec forbids, which is the regression a future refactor is most likely to introduce by
   * reaching for the nearest Tailwind utility.
   */
  it('uses none of the forbidden hiding mechanisms on a loaded clip', () => {
    const { container } = render(
      <VideoInputPanel videoSource={makeVideoSource({ status: 'ready' })} />,
    )
    const video = container.querySelector('video')!
    const host = video.parentElement!

    // `hidden` is the lever `status === 'empty'` owns; extending it to a loaded clip is precisely
    // what the requirement forbids.
    expect(video).not.toHaveAttribute('hidden')
    expect(host).not.toHaveAttribute('hidden')

    const hostClasses = host.className.split(/\s+/)
    for (const forbidden of ['hidden', 'invisible', 'collapse', 'w-0', 'h-0', 'size-0']) {
      expect(hostClasses).not.toContain(forbidden)
    }
    expect(host.getAttribute('style') ?? '').not.toMatch(
      /display\s*:\s*none|visibility\s*:\s*hidden/,
    )

    // Positive half: the shipped mechanism is the full-size box moved out of the viewport, and
    // `inert` keeps an off-screen `<video controls>` out of the tab order and the a11y tree.
    expect(hostClasses).toContain('fixed')
    expect(host).toHaveAttribute('inert')

    // Still one element, still mounted, still the node the pipeline's ref points at.
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(video.isConnected).toBe(true)
  })

  it('drops the off-viewport offset when the element has to be on screen', () => {
    const { container } = render(
      <VideoInputPanel videoSource={makeVideoSource({ status: 'ready' })} onScreen />,
    )
    const host = container.querySelector('video')!.parentElement!
    const hostClasses = host.className.split(/\s+/)

    // The whole point: nothing pushes it out of the viewport, and it fills its strip entry
    // instead. `strides-kyu.13` measured a ~20-24% sampled-frame loss for the concealed
    // placement on the playback path, with no size threshold — on screen or not is the only
    // variable, so `onScreen` must not be cosmetically different, it must be genuinely visible.
    expect(hostClasses).not.toContain('fixed')
    expect(hostClasses).not.toContain('left-[-200vw]')
    expect(hostClasses).toContain('absolute')
    expect(hostClasses).toContain('inset-0')

    // Everything the concealed placement guarantees still holds here.
    for (const forbidden of ['hidden', 'invisible', 'collapse', 'w-0', 'h-0', 'size-0']) {
      expect(hostClasses).not.toContain(forbidden)
    }
    expect(host).toHaveAttribute('inert')
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('keeps the same element across the concealed <-> on-screen transition', () => {
    // The one thing that would make all of the above moot: a placement change that remounts the
    // node. `results-view`'s "Clip video elements stay mounted and playable while hidden" requires
    // the DOM element the pipeline holds to survive every visibility transition, and only a CSS
    // change can do that.
    const videoSource = makeVideoSource({ status: 'ready' })
    const { container, rerender } = render(
      <VideoInputPanel videoSource={videoSource} />,
    )
    const before = container.querySelector('video')!

    rerender(<VideoInputPanel videoSource={videoSource} onScreen />)
    expect(container.querySelector('video')).toBe(before)

    rerender(<VideoInputPanel videoSource={videoSource} />)
    expect(container.querySelector('video')).toBe(before)
    expect(before.isConnected).toBe(true)
  })
})
