import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClipLoadStatus } from './ClipLoadStatus'
import type { VideoSource } from './types'

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

// These two moved here from `VideoInputPanel.test.tsx` when the clip's element moved into the
// header strip: the surface they cover has to stay in the page body, because `video-input`'s
// "Clear error messages for permission and format failures" requires it be visible and a 96x72
// thumbnail cannot show a sentence.
describe('ClipLoadStatus', () => {
  it('shows a processing indicator while loading', () => {
    render(<ClipLoadStatus videoSource={makeVideoSource({ status: 'loading' })} />)
    expect(screen.getByRole('status').textContent).toMatch(/processing/i)
  })

  it('shows the error message and a working try-again button', () => {
    const videoSource = makeVideoSource({
      status: 'error',
      error: { kind: 'unsupported-format', message: 'Format not supported.' },
    })
    render(<ClipLoadStatus videoSource={videoSource} />)

    expect(screen.getByRole('alert').textContent).toMatch(/format not supported/i)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(videoSource.reset).toHaveBeenCalledTimes(1)
  })

  it('renders nothing at all for a clip that is neither loading nor broken', () => {
    // It is rendered once per clip in the page body, so a healthy session must not accumulate
    // empty wrappers — and, more importantly, must not accumulate empty live regions.
    const { container } = render(
      <ClipLoadStatus videoSource={makeVideoSource({ status: 'ready' })} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
