import { createRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('shows the Record tab by default with tab controls', () => {
    render(<VideoInputPanel videoSource={makeVideoSource()} />)
    expect(
      screen.getByRole('button', { name: /start recording/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/choose a video file/i),
    ).not.toBeInTheDocument()
  })

  it('switches to the Upload tab', () => {
    render(<VideoInputPanel videoSource={makeVideoSource()} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    expect(screen.getByLabelText(/choose a video file/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /start recording/i }),
    ).not.toBeInTheDocument()
  })

  it('calls videoSource.load with the fetched blob when the demo video button is used', async () => {
    const blob = new Blob(['content'], { type: 'video/mp4' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) }),
    )

    const videoSource = makeVideoSource()
    render(<VideoInputPanel videoSource={videoSource} />)
    fireEvent.click(screen.getByRole('button', { name: /demo 1 \(side view\)/i }))

    await waitFor(() => expect(videoSource.load).toHaveBeenCalledWith(blob))
  })

  it('calls videoSource.load when a file is selected on the Upload tab', () => {
    const videoSource = makeVideoSource()
    render(<VideoInputPanel videoSource={videoSource} />)
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    const file = new File(['content'], 'run.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file] },
    })

    expect(videoSource.load).toHaveBeenCalledWith(file)
  })

  it('shows a processing indicator and hides tabs while loading', () => {
    render(
      <VideoInputPanel videoSource={makeVideoSource({ status: 'loading' })} />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/processing/i)
    expect(
      screen.queryByRole('button', { name: /start recording/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the error message and a working try-again button', () => {
    const videoSource = makeVideoSource({
      status: 'error',
      error: { kind: 'unsupported-format', message: 'Format not supported.' },
    })
    render(<VideoInputPanel videoSource={videoSource} />)

    expect(screen.getByRole('alert').textContent).toMatch(
      /format not supported/i,
    )

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(videoSource.reset).toHaveBeenCalledTimes(1)
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
})
