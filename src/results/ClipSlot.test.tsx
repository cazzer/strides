import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'

const {
  sampleClipMock,
  applyRobustnessMock,
  computeFormHeuristicsMock,
  getScalePassDetectorMock,
} = vi.hoisted(() => ({
  sampleClipMock: vi.fn(),
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
  getScalePassDetectorMock: vi.fn(),
}))

vi.mock('./sampleClip', () => ({
  sampleClip: sampleClipMock,
  DEFAULT_MAX_CONSECUTIVE_ERRORS: 30,
  DEFAULT_DETECTION_TIMEOUT_MS: 5000,
}))
vi.mock('../pose/robustness/interpolate', () => ({ applyRobustness: applyRobustnessMock }))
vi.mock('../heuristics/index', () => ({ computeFormHeuristics: computeFormHeuristicsMock }))
vi.mock('../pose/scalePassDetector', () => ({ getScalePassDetector: getScalePassDetectorMock }))

import { ClipSlot } from './ClipSlot'

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

function markVideoReady(video: HTMLVideoElement) {
  Object.defineProperty(video, 'duration', { value: 10, configurable: true })
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true })
  act(() => {
    video.dispatchEvent(new Event('loadedmetadata'))
  })
}

beforeEach(() => {
  sampleClipMock.mockReset()
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  getScalePassDetectorMock.mockReset()
  // Never resolves by default -- tests that don't care about sampling's outcome don't need to
  // supply their own implementation.
  sampleClipMock.mockImplementation(() => ({
    promise: new Promise(() => {}),
    handle: { stop: vi.fn() },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClipSlot', () => {
  it('shows a queued hint once the video is loaded but no detector is available yet', async () => {
    render(
      <ClipSlot
        clipId="a"
        pendingLoad={null}
        detector={null}
        onReport={() => {}}
        onRemove={() => {}}
        canRemove={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file = new File(['x'], 'run.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), { target: { files: [file] } })
    markVideoReady(document.querySelector('video[controls]')!)

    await waitFor(() =>
      expect(screen.getByText(/queued.*waiting for another clip/i)).toBeInTheDocument(),
    )
    expect(sampleClipMock).not.toHaveBeenCalled()
  })

  it('auto-starts sampling once the video is ready and a detector is supplied', async () => {
    const detector = makeFakeDetector()
    render(
      <ClipSlot
        clipId="a"
        pendingLoad={null}
        detector={detector}
        onReport={() => {}}
        onRemove={() => {}}
        canRemove={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file = new File(['x'], 'run.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), { target: { files: [file] } })
    markVideoReady(document.querySelector('video[controls]')!)

    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument()
  })

  it('loads a pendingLoad source once on mount, without requiring the picker', async () => {
    // Spying on useVideoSource itself would defeat the "unmodified hook" contract this test is
    // meant to prove, so instead this asserts through the DOM: pendingLoad drives the video
    // element's src directly, without the picker UI ever appearing.
    render(
      <ClipSlot
        clipId="a"
        pendingLoad={{ source: new File(['x'], 'run.mp4', { type: 'video/mp4' }) }}
        detector={null}
        onReport={() => {}}
        onRemove={() => {}}
        canRemove={false}
      />,
    )

    // The actual load() call is deferred one microtask (see ClipSlot.tsx's doc on why) — flush
    // it before asserting.
    await act(async () => {})

    expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument()
    expect(document.querySelector('video[controls]')?.getAttribute('src')).toMatch(/^blob:/)
  })

  it('hides the remove button when canRemove is false', () => {
    render(
      <ClipSlot
        clipId="a"
        pendingLoad={null}
        detector={null}
        onReport={() => {}}
        onRemove={() => {}}
        canRemove={false}
      />,
    )
    expect(screen.queryByRole('button', { name: /remove clip/i })).not.toBeInTheDocument()
  })

  it('shows the remove button and calls onRemove with its clipId when canRemove is true', () => {
    const onRemove = vi.fn()
    render(
      <ClipSlot
        clipId="clip-42"
        pendingLoad={null}
        detector={null}
        onReport={() => {}}
        onRemove={onRemove}
        canRemove
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove clip/i }))
    expect(onRemove).toHaveBeenCalledWith('clip-42')
  })

  it('reports its live session up on render', () => {
    const onReport = vi.fn()
    render(
      <ClipSlot
        clipId="a"
        pendingLoad={null}
        detector={null}
        onReport={onReport}
        onRemove={() => {}}
        canRemove={false}
      />,
    )
    expect(onReport).toHaveBeenCalled()
    const [clipId, session] = onReport.mock.calls[0]
    expect(clipId).toBe('a')
    expect(session.clipId).toBe('a')
    expect(session.analysis.phase).toBe('idle')
    expect(session.videoSource.status).toBe('empty')
  })
})
