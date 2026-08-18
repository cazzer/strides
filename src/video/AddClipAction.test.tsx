import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddClipAction } from './AddClipAction'

/**
 * Copied from `WebcamCapture.test.tsx` — the record path is the headline of this component (it was
 * unreachable for clips 2..N before it existed), so it is driven end to end here rather than
 * mocked away into "a Start button rendered".
 */
function makeFakeStream(frameRate: number | undefined = 30) {
  const track = {
    stop: vi.fn(),
    onended: null as (() => void) | null,
    getSettings: () => ({ frameRate }),
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  return { stream: stream as unknown as MediaStream, track }
}

class FakeMediaRecorder {
  static isTypeSupported: (type: string) => boolean = vi.fn(
    (type: string) => type === 'video/webm;codecs=vp9',
  )

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? ''
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(10)], { type: this.mimeType }),
    })
    this.onstop?.()
  }
}

function mockGetUserMedia(stream: MediaStream) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream) },
    configurable: true,
  })
}

const trigger = () => screen.getByRole('button', { name: /add a clip/i })

beforeEach(() => {
  FakeMediaRecorder.isTypeSupported = vi.fn(
    (type: string): boolean => type === 'video/webm;codecs=vp9',
  )
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: undefined,
    configurable: true,
  })
})

describe('AddClipAction', () => {
  it('is a labeled, collapsed disclosure until it is activated', () => {
    render(<AddClipAction onSource={vi.fn()} />)

    // A real button, so it is in the tab order and activates from the keyboard for free — and its
    // accessible name says what it does, not where it is.
    const button = trigger()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toBeDisabled()

    // Nothing of the picker is on the page yet.
    expect(screen.queryByRole('button', { name: /start recording/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /demo 1 \(side view\)/i })).not.toBeInTheDocument()
  })

  it('offers record, upload AND the demo clips — the paths that were unreachable for clips 2..N', () => {
    render(<AddClipAction onSource={vi.fn()} />)
    fireEvent.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(trigger()).toHaveAttribute('aria-controls', screen.getByRole('group', { name: /add a clip/i }).id)

    // Record is the DEFAULT tab, so the path the old upload-only block could not reach is the one
    // presented first.
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /demo 1 \(side view\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /demo 2 \(front view\)/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    expect(screen.getByLabelText(/choose a video file/i)).toBeInTheDocument()
  })

  it('reports one source per file, so one picker interaction still creates one clip per file', () => {
    const onSource = vi.fn()
    render(<AddClipAction onSource={onSource} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))

    const files = [
      new File(['a'], 'run1.mp4', { type: 'video/mp4' }),
      new File(['b'], 'run2.mp4', { type: 'video/mp4' }),
      new File(['c'], 'run3.mp4', { type: 'video/mp4' }),
    ]
    fireEvent.change(screen.getByLabelText(/choose a video file/i), { target: { files } })

    // The panel closes on the FIRST file. All three still land: `FileUpload` loops synchronously
    // inside one change event and React batches the close until that handler returns. A close that
    // truncated the fan-out would read here as 1 call, and downstream as "three files, one clip".
    expect(onSource).toHaveBeenCalledTimes(3)
    expect(onSource).toHaveBeenNthCalledWith(1, files[0], undefined)
    expect(onSource).toHaveBeenNthCalledWith(3, files[2], undefined)
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('hands over a recording and collapses, returning focus to the trigger', async () => {
    const { stream } = makeFakeStream(24)
    mockGetUserMedia(stream)
    const onSource = vi.fn()

    render(<AddClipAction onSource={onSource} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    const stop = await screen.findByRole('button', { name: /stop recording/i })
    // Mid-recording the disclosure refuses to collapse — doing so unmounts `WebcamCapture`, which
    // stops the tracks and discards the take.
    expect(trigger()).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('group', { name: /add a clip/i }), { key: 'Escape' })
    expect(screen.getByRole('group', { name: /add a clip/i })).toBeInTheDocument()

    fireEvent.click(stop)

    await waitFor(() => expect(onSource).toHaveBeenCalledTimes(1))
    const [blob, opts] = onSource.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(opts).toEqual({ frameRateHint: 24 })

    await waitFor(() => expect(trigger()).toHaveAttribute('aria-expanded', 'false'))
    // Re-enabled, and holding focus. `WebcamCapture` reports `false` on mount but never on
    // unmount, so a flag left set here would strand the reader on a permanently disabled trigger.
    expect(trigger()).not.toBeDisabled()
    expect(document.activeElement).toBe(trigger())
  })

  it('collapses on Escape and on a second activation, both times restoring focus', () => {
    render(<AddClipAction onSource={vi.fn()} />)

    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('group', { name: /add a clip/i }), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: /add a clip/i })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger())

    fireEvent.click(trigger())
    expect(screen.getByRole('group', { name: /add a clip/i })).toBeInTheDocument()
    fireEvent.click(trigger())
    expect(screen.queryByRole('group', { name: /add a clip/i })).not.toBeInTheDocument()
  })
})
