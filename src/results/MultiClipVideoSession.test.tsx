import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult } from '../heuristics/types'

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

import { MultiClipVideoSession } from './MultiClipVideoSession'

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

function makeFakeKeypoints(): RobustKeypoint[] {
  return COMMON_KEYPOINT_NAMES.map((name) => ({
    name,
    status: 'detected',
    x: 1,
    y: 1,
    score: 0.9,
  }))
}

const FAKE_ROBUST_FRAMES: RobustPoseFrame[] = [
  { timestamp: 0, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.1, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.2, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
]

function makeMetric(metric: string, overrides: Record<string, unknown> = {}) {
  return {
    metric,
    value: 1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
    ...overrides,
  }
}

const FAKE_HEURISTICS = {
  view: {
    view: 'side',
    confidence: 1,
    diagnostics: { bilateralSpreadRatio: null, sagittalExcursionRatio: null, frameCoverage: 1 },
  },
  verticalOscillation: { ...makeMetric('verticalOscillation'), series: [], fit: null },
  verticalRatio: makeMetric('verticalRatio', { unit: 'percent' }),
  verticalOscillationCm: {
    ...makeMetric('verticalOscillationCm', { unit: 'centimeters', value: null, confidence: 0 }),
    calibration: null,
  },
  trunkLean: makeMetric('trunkLean', { unit: 'degrees' }),
  overstriding: makeMetric('overstriding'),
  cadence: makeMetric('cadence', { unit: 'stepsPerMinute' }),
  kneeFlexion: makeMetric('kneeFlexion', { unit: 'degrees' }),
  armSwingSymmetry: makeMetric('armSwingSymmetry', { unit: 'percent' }),
  footStrikePattern: makeMetric('footStrikePattern'),
} as unknown as FormHeuristicsResult

function markVideoReady(video: HTMLVideoElement) {
  Object.defineProperty(video, 'duration', { value: 10, configurable: true })
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true })
  act(() => {
    video.dispatchEvent(new Event('loadedmetadata'))
  })
}

function canonicalVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll('video[controls]'))
}

beforeEach(() => {
  sampleClipMock.mockReset()
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  getScalePassDetectorMock.mockReset()
  applyRobustnessMock.mockReturnValue(FAKE_ROBUST_FRAMES)
  computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)
  getScalePassDetectorMock.mockResolvedValue(makeFakeDetector())
  // Resolves every sampling call (primary or scale pass, either clip) immediately with one
  // null-frame sample -- with FAKE_HEURISTICS' calibration: null, every scale pass concludes
  // 'failed' ("measured no real-world scale"), a terminal status, same as
  // useVideoAnalysis.test.ts's own default fixtures.
  sampleClipMock.mockImplementation(() => ({
    promise: Promise.resolve([{ timestamp: 0, frame: null }]),
    handle: { stop: vi.fn() },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MultiClipVideoSession', () => {
  it('renders exactly one clip slot initially', () => {
    const headingRef = createRef<HTMLHeadingElement>()
    render(<MultiClipVideoSession detector={null} headingRef={headingRef} />)
    expect(canonicalVideos()).toHaveLength(1)
  })

  it('single clip (N=1): auto-starts and reaches Analysis complete once ready', async () => {
    const headingRef = createRef<HTMLHeadingElement>()
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} headingRef={headingRef} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file = new File(['x'], 'run.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), { target: { files: [file] } })

    markVideoReady(canonicalVideos()[0])

    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
    expect(sampleClipMock).toHaveBeenCalled()
  })

  it('serializes the shared detector: the second clip stays queued until the first clip fully finishes', async () => {
    // Clip 1's primary sampling pass hangs until resolved manually -- every OTHER sampleClip
    // call (clip 1's scale pass, clip 2's primary and scale pass) resolves immediately, so the
    // only thing gating progress is this one controlled promise.
    let resolveClip1Primary!: (samples: unknown[]) => void
    sampleClipMock
      .mockImplementationOnce(() => ({
        promise: new Promise((resolve) => {
          resolveClip1Primary = resolve
        }),
        handle: { stop: vi.fn() },
      }))
      .mockImplementation(() => ({
        promise: Promise.resolve([{ timestamp: 0, frame: null }]),
        handle: { stop: vi.fn() },
      }))

    const headingRef = createRef<HTMLHeadingElement>()
    const detector = makeFakeDetector()
    render(<MultiClipVideoSession detector={detector} headingRef={headingRef} />)

    // Load clip 1 through its own picker -- its primary pass starts sampling and hangs.
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file1 = new File(['x'], 'run1.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file1] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalledTimes(1))

    // Add clip 2 via the session-level "Add another clip" picker while clip 1 is still sampling.
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())
    const file2 = new File(['y'], 'run2.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file2] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))
    markVideoReady(canonicalVideos()[1])

    // Clip 2 is loaded and would be eligible to auto-start, but the shared detector is still
    // held by clip 1 (still mid-sampling) -- it must show the queued hint, not start sampling.
    await waitFor(() =>
      expect(screen.getByText(/queued.*waiting for another clip/i)).toBeInTheDocument(),
    )
    expect(sampleClipMock).toHaveBeenCalledTimes(1)

    // Let clip 1's primary pass resolve -- its scale pass (also mocked) runs to a terminal
    // ('failed': no scale measured) status right after.
    await act(async () => {
      resolveClip1Primary([{ timestamp: 0, frame: null }])
    })
    await waitFor(() => expect(sampleClipMock.mock.calls.length).toBeGreaterThanOrEqual(2))

    // Once clip 1's ENTIRE pipeline (primary AND scale pass) is terminal, clip 2 is handed the
    // detector and auto-starts -- the queued hint disappears and clip 2's own primary sampling
    // call happens.
    await waitFor(() => {
      expect(screen.queryByText(/queued.*waiting for another clip/i)).not.toBeInTheDocument()
    })
    await waitFor(() => expect(sampleClipMock.mock.calls.length).toBeGreaterThanOrEqual(3))

    // Both clips eventually finish; the aggregate reaches ready.
    await waitFor(() => expect(screen.getByText(/analysis complete/i)).toBeInTheDocument())
  })

  it('removes a clip via its Remove button, keeping at least one slot', async () => {
    const headingRef = createRef<HTMLHeadingElement>()
    render(<MultiClipVideoSession detector={null} headingRef={headingRef} />)

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    const file1 = new File(['x'], 'run1.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file1] },
    })
    markVideoReady(canonicalVideos()[0])
    await waitFor(() => expect(screen.getByText(/add another clip/i)).toBeInTheDocument())

    const file2 = new File(['y'], 'run2.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByLabelText(/choose a video file/i), {
      target: { files: [file2] },
    })
    await waitFor(() => expect(canonicalVideos()).toHaveLength(2))

    const removeButtons = screen.getAllByRole('button', { name: /remove clip/i })
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[0])

    await waitFor(() => expect(canonicalVideos()).toHaveLength(1))
    // A lone remaining clip has nothing left to remove itself from.
    expect(screen.queryByRole('button', { name: /remove clip/i })).not.toBeInTheDocument()
  })
})
