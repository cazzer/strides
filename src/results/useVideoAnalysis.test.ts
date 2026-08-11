import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult } from '../heuristics/types'
import type { SampleClipHandle } from './sampleClip'

const { sampleClipMock, applyRobustnessMock, computeFormHeuristicsMock } = vi.hoisted(
  () => ({
    sampleClipMock: vi.fn(),
    applyRobustnessMock: vi.fn(),
    computeFormHeuristicsMock: vi.fn(),
  }),
)

vi.mock('./sampleClip', () => ({
  sampleClip: sampleClipMock,
}))

vi.mock('../pose/robustness/interpolate', () => ({
  applyRobustness: applyRobustnessMock,
}))

vi.mock('../heuristics/index', () => ({
  computeFormHeuristics: computeFormHeuristicsMock,
}))

import { useVideoAnalysis } from './useVideoAnalysis'

function makeMetadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return { durationSec: 10, width: 640, height: 480, frameRate: 30, ...overrides }
}

// IMPORTANT: callers must create this once per test and reuse the same reference across
// re-renders (never inline `makeVideoSource()` directly in a `renderHook(() => ...)` callback)
// — `useVideoAnalysis` auto-resets whenever `videoSource.metadata`'s *identity* changes, so a
// fresh object on every render would loop forever.
function makeVideoSource(overrides: Partial<VideoSource> = {}): VideoSource {
  const video = document.createElement('video')
  return {
    videoRef: { current: video },
    status: 'ready',
    metadata: makeMetadata(),
    error: null,
    load: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

const FAKE_ROBUST_FRAMES: RobustPoseFrame[] = [
  { timestamp: 0, keypoints: [], source: 'detected' },
]

const FAKE_HEURISTICS: FormHeuristicsResult = {
  view: {
    view: 'side',
    confidence: 1,
    diagnostics: {
      bilateralSpreadRatio: null,
      sagittalExcursionRatio: null,
      frameCoverage: 1,
    },
  },
  verticalOscillation: {
    metric: 'verticalOscillation',
    value: 0.1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
    series: [],
  },
  trunkLean: {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  overstriding: {
    metric: 'overstriding',
    value: 0.1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
}

function makeFakeHandle(): SampleClipHandle {
  return { stop: vi.fn() }
}

beforeEach(() => {
  sampleClipMock.mockReset()
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  applyRobustnessMock.mockReturnValue(FAKE_ROBUST_FRAMES)
  computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)
})

describe('useVideoAnalysis', () => {
  it('starts idle', () => {
    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))
    expect(result.current.phase).toBe('idle')
    expect(result.current.robustFrames).toBeNull()
    expect(result.current.heuristics).toBeNull()
  })

  it('start() reports a detector-unavailable error when detector is null', () => {
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, null))

    act(() => {
      result.current.start()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error?.kind).toBe('detector-unavailable')
  })

  it('start() reports an error when no video element is attached', () => {
    const videoSource = makeVideoSource({ videoRef: { current: null } })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    act(() => {
      result.current.start()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error?.kind).toBe('unknown')
  })

  it('transitions sampling -> processing -> ready, sorting samples before robustness', async () => {
    let resolveSampling!: (samples: unknown[]) => void
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise((resolve) => {
        resolveSampling = resolve
      }),
      handle: makeFakeHandle(),
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    act(() => {
      result.current.start()
    })
    expect(result.current.phase).toBe('sampling')

    const outOfOrderSamples = [
      { timestamp: 0.3, frame: null },
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: null },
    ]
    await act(async () => {
      resolveSampling(outOfOrderSamples)
    })

    await waitFor(() => expect(result.current.phase).toBe('ready'))

    expect(applyRobustnessMock).toHaveBeenCalledWith([
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: null },
      { timestamp: 0.3, frame: null },
    ])
    expect(computeFormHeuristicsMock).toHaveBeenCalledWith(FAKE_ROBUST_FRAMES)
    expect(result.current.robustFrames).toBe(FAKE_ROBUST_FRAMES)
    expect(result.current.heuristics).toBe(FAKE_HEURISTICS)
    expect(result.current.progress).toBe(1)
  })

  it('reports a detection-stalled error when sampleClip rejects', async () => {
    let rejectSampling!: (error: Error) => void
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise((_resolve, reject) => {
        rejectSampling = reject
      }),
      handle: makeFakeHandle(),
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    act(() => {
      result.current.start()
    })

    await act(async () => {
      rejectSampling(new Error('broken detector'))
    })

    await waitFor(() => expect(result.current.phase).toBe('error'))
    expect(result.current.error?.kind).toBe('detection-stalled')
  })

  it('reset() stops an active run and returns to idle', () => {
    const handle = makeFakeHandle()
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}), // never resolves
      handle,
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    act(() => {
      result.current.start()
    })
    expect(result.current.phase).toBe('sampling')

    act(() => {
      result.current.reset()
    })

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
    expect(result.current.robustFrames).toBeNull()
  })

  it('auto-resets to idle when videoSource.metadata identity changes mid-analysis', () => {
    const handle = makeFakeHandle()
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}),
      handle,
    }))

    const initialVideoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result, rerender } = renderHook(
      (props: { videoSource: VideoSource; detector: PoseDetector | null }) =>
        useVideoAnalysis(props.videoSource, props.detector),
      { initialProps: { videoSource: initialVideoSource, detector } },
    )

    act(() => {
      result.current.start()
    })
    expect(result.current.phase).toBe('sampling')

    const nextVideoSource = makeVideoSource({ metadata: makeMetadata({ width: 999 }) })
    act(() => {
      rerender({ videoSource: nextVideoSource, detector })
    })

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
  })

  it('stops the in-flight handle on unmount', () => {
    const handle = makeFakeHandle()
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}),
      handle,
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result, unmount } = renderHook(() => useVideoAnalysis(videoSource, detector))

    act(() => {
      result.current.start()
    })

    unmount()
    expect(handle.stop).toHaveBeenCalledTimes(1)
  })
})
