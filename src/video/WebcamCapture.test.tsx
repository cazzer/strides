import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebcamCapture } from './WebcamCapture'

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
  onended: (() => void) | null
  getSettings: () => { frameRate: number | undefined }
}

function makeFakeStream(frameRate: number | undefined = 30) {
  const track: FakeTrack = {
    stop: vi.fn(),
    onended: null,
    getSettings: () => ({ frameRate }),
  }
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  }
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
  private hasData: boolean

  constructor(
    _stream: MediaStream,
    options?: { mimeType?: string },
    hasData = true,
  ) {
    this.mimeType = options?.mimeType ?? ''
    this.hasData = hasData
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    const size = this.hasData ? 10 : 0
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(size)], { type: this.mimeType }),
    })
    this.onstop?.()
  }
}

function mockGetUserMedia(impl: (...args: unknown[]) => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(impl) },
    configurable: true,
  })
}

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

describe('WebcamCapture', () => {
  it('records and calls onRecorded with the resulting blob and frameRateHint', async () => {
    const { stream } = makeFakeStream(24)
    mockGetUserMedia(async () => stream)
    const onRecorded = vi.fn()

    render(<WebcamCapture onRecorded={onRecorded} />)

    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    const stopButton = await screen.findByRole('button', {
      name: /stop recording/i,
    })

    fireEvent.click(stopButton)

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1))
    const [blob, opts] = onRecorded.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
    expect(opts).toEqual({ frameRateHint: 24 })
  })

  it('stops every track once recording stops normally', async () => {
    const { stream, track } = makeFakeStream()
    mockGetUserMedia(async () => stream)

    render(<WebcamCapture onRecorded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    const stopButton = await screen.findByRole('button', {
      name: /stop recording/i,
    })
    fireEvent.click(stopButton)

    await waitFor(() => expect(track.stop).toHaveBeenCalled())
  })

  it('stops every track on unmount while recording', async () => {
    const { stream, track } = makeFakeStream()
    mockGetUserMedia(async () => stream)

    const { unmount } = render(<WebcamCapture onRecorded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    await screen.findByRole('button', { name: /stop recording/i })

    unmount()

    expect(track.stop).toHaveBeenCalled()
  })

  it('shows a permission-denied message and allows retrying', async () => {
    mockGetUserMedia(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })

    render(<WebcamCapture onRecorded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/denied/i)
    expect(alert.textContent).toMatch(/upload/i)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(
      screen.getByRole('button', { name: /start recording/i }),
    ).toBeInTheDocument()
  })

  it('shows a clear message when getUserMedia is unavailable, without prompting', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    })

    render(<WebcamCapture onRecorded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    expect(screen.getByRole('alert').textContent).toMatch(/upload/i)
  })

  it('shows a recorder-unsupported message when no codec is supported', () => {
    FakeMediaRecorder.isTypeSupported = vi.fn(() => false)
    mockGetUserMedia(async () => makeFakeStream().stream)

    render(<WebcamCapture onRecorded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    expect(screen.getByRole('alert').textContent).toMatch(
      /recording isn't supported/i,
    )
  })

  it('notifies the parent of recording state changes', async () => {
    const { stream } = makeFakeStream()
    mockGetUserMedia(async () => stream)
    const onRecordingStateChange = vi.fn()

    render(
      <WebcamCapture
        onRecorded={() => {}}
        onRecordingStateChange={onRecordingStateChange}
      />,
    )
    expect(onRecordingStateChange).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    await waitFor(() =>
      expect(onRecordingStateChange).toHaveBeenCalledWith(true),
    )
  })

  it('disables the start button when disabled is true', () => {
    render(<WebcamCapture onRecorded={() => {}} disabled />)
    expect(
      screen.getByRole('button', { name: /start recording/i }),
    ).toBeDisabled()
  })

  it('finalizes a mid-recording device disconnect when data was captured', async () => {
    const { stream, track } = makeFakeStream()
    mockGetUserMedia(async () => stream)
    const onRecorded = vi.fn()

    render(<WebcamCapture onRecorded={onRecorded} />)
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
    await screen.findByRole('button', { name: /stop recording/i })

    act(() => {
      track.onended?.()
    })

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1))
  })
})
