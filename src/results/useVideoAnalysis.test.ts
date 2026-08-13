import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult } from '../heuristics/types'
import type { SampleClipHandle } from './sampleClip'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import { DEFAULT_SAMPLING_ROBUSTNESS_CONFIG } from './samplingRobustnessConfig'

const { sampleClipMock, applyRobustnessMock, computeFormHeuristicsMock } = vi.hoisted(
  () => ({
    sampleClipMock: vi.fn(),
    applyRobustnessMock: vi.fn(),
    computeFormHeuristicsMock: vi.fn(),
  }),
)

vi.mock('./sampleClip', () => ({
  sampleClip: sampleClipMock,
  // samplingRobustnessConfig.ts imports these two constants directly from this module for its
  // default -- mocking the module wholesale drops them unless re-provided here, with the same
  // real values sampleClip.ts itself exports.
  DEFAULT_MAX_CONSECUTIVE_ERRORS: 30,
  DEFAULT_DETECTION_TIMEOUT_MS: 5000,
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
//
// NOTE: `status: 'ready'` is the default — combined with a non-null `detector`, this means the
// hook's auto-start effect (see `useVideoAnalysis.ts`) fires `start()` on mount for most tests
// below. Tests exercising `start()`/`reset()` mechanics directly rely on that auto-fire instead
// of calling `start()` manually; tests specifically about the *pre-ready* state pass
// `status: 'empty'` to keep it from firing.
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

// A full, valid frame (every COMMON_KEYPOINT_NAMES entry resolvable) -- `trimToPresenceWindow`
// runs for real against this (it's cheap/pure, not mocked like sampleClip/applyRobustness/
// computeFormHeuristics are), so this fixture must satisfy RobustPoseFrame's documented
// "one entry per COMMON_KEYPOINT_NAMES name, never sparse" contract or `resolveMidpoint` throws
// on a missing keypoint.
function makeFakeKeypoints(): RobustKeypoint[] {
  return COMMON_KEYPOINT_NAMES.map((name) => ({
    name,
    status: 'detected',
    x: 1,
    y: 1,
    score: 0.9,
  }))
}

// At least `presenceMinConsecutiveFrames` (3, the default) frames, all present, so
// `trimToPresenceWindow` is a no-op on this fixture -- tests asserting exactly what
// computeFormHeuristics was called with need the trim to not have changed anything.
const FAKE_ROBUST_FRAMES: RobustPoseFrame[] = [
  { timestamp: 0, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.1, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.2, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
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
    fit: null,
  },
  verticalRatio: {
    metric: 'verticalRatio',
    value: 0.08,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  verticalOscillationCm: {
    metric: 'verticalOscillationCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat:
      "No real-world scale was measured for this clip, so bounce can't be reported in centimetres.",
    // null: this hook's fixture frames carry no pixelsPerMeter, mirroring a real MoveNet run --
    // computeAnalysisDiagnostics (not mocked in this file) derives the absent scaleCalibration key
    // from this field.
    calibration: null,
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
  cadence: {
    metric: 'cadence',
    value: 170,
    unit: 'stepsPerMinute',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  kneeFlexion: {
    metric: 'kneeFlexion',
    value: 110,
    unit: 'degrees',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  armSwingSymmetry: {
    metric: 'armSwingSymmetry',
    value: 0.9,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  footStrikePattern: {
    metric: 'footStrikePattern',
    value: 0.01,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: 'Approximated from ankle position relative to the knee at footstrike.',
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
  // Default: never resolves, so tests that don't care about sampling's outcome don't need to
  // supply their own implementation just to satisfy the auto-start effect firing on mount.
  sampleClipMock.mockImplementation(() => ({
    promise: new Promise(() => {}),
    handle: makeFakeHandle(),
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__
})

describe('useVideoAnalysis', () => {
  it('starts idle when the video is not yet ready', () => {
    const videoSource = makeVideoSource({ status: 'empty' })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))
    expect(result.current.phase).toBe('idle')
    expect(result.current.robustFrames).toBeNull()
    expect(result.current.heuristics).toBeNull()
  })

  it('auto-starts analysis once the video is ready and a detector is available', () => {
    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    expect(result.current.phase).toBe('sampling')
    expect(sampleClipMock).toHaveBeenCalledTimes(1)
  })

  it('does not auto-start while no detector is available', () => {
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, null))

    expect(result.current.phase).toBe('idle')
    expect(sampleClipMock).not.toHaveBeenCalled()
  })

  it('start() reports a detector-unavailable error when detector is null', () => {
    const videoSource = makeVideoSource({ status: 'empty' })
    const { result } = renderHook(() => useVideoAnalysis(videoSource, null))

    act(() => {
      result.current.start()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error?.kind).toBe('detector-unavailable')
  })

  it('start() reports an error when no video element is attached', () => {
    const videoSource = makeVideoSource({ status: 'empty', videoRef: { current: null } })
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

    expect(applyRobustnessMock).toHaveBeenCalledWith(
      [
        { timestamp: 0.1, frame: null },
        { timestamp: 0.2, frame: null },
        { timestamp: 0.3, frame: null },
      ],
      DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.robustness,
    )
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
    expect(result.current.phase).toBe('sampling')

    act(() => {
      result.current.reset()
    })

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
    expect(result.current.robustFrames).toBeNull()
  })

  it('abandons the old run and auto-starts a new one when videoSource.metadata identity changes mid-analysis', () => {
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
    expect(result.current.phase).toBe('sampling')

    // The new clip is also immediately 'ready' (as it would be for e.g. the demo video button),
    // so the old run is abandoned and a fresh one auto-starts for the new clip in the same tick.
    const nextVideoSource = makeVideoSource({ metadata: makeMetadata({ width: 999 }) })
    act(() => {
      rerender({ videoSource: nextVideoSource, detector })
    })

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('sampling')
  })

  it('loops the video, muted, once analysis reaches ready', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const video = document.createElement('video')
    const videoSource = makeVideoSource({ videoRef: { current: video } })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))

    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
  })

  it('mutes the video before restarting playback for the loop', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const video = document.createElement('video')
    let mutedAtLoopRestart: boolean | undefined
    let playCallCount = 0
    vi.spyOn(video, 'play').mockImplementation(() => {
      playCallCount += 1
      // The first play() call is sampling's own (the auto-start effect firing on mount); the
      // loop-restart is the second.
      if (playCallCount === 2) mutedAtLoopRestart = video.muted
      return Promise.resolve()
    })

    const videoSource = makeVideoSource({ videoRef: { current: video } })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))

    expect(playCallCount).toBe(2)
    expect(mutedAtLoopRestart).toBe(true)
  })

  it('clears the loop before a new run starts, so sampling can detect ended', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const video = document.createElement('video')
    const videoSource = makeVideoSource({ videoRef: { current: video } })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(video.loop).toBe(true)

    act(() => {
      result.current.start()
    })
    expect(video.loop).toBe(false)
  })

  it('populates diagnostics once ready, null before', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    expect(result.current.diagnostics).toBeNull()

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.diagnostics).not.toBeNull()
    expect(result.current.diagnostics?.metrics.trunkLean.value).toBe(5)
  })

  it('logs diagnostics to the console once ready, in a dev build', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    const call = logSpy.mock.calls.find((args) => args[0] === '[analysis-diagnostics]')
    expect(call).toBeDefined()
    expect(() => JSON.parse(call![1] as string)).not.toThrow()

    logSpy.mockRestore()
  })

  it('does not log diagnostics outside a dev build', async () => {
    vi.stubEnv('DEV', false)
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    const call = logSpy.mock.calls.find((args) => args[0] === '[analysis-diagnostics]')
    expect(call).toBeUndefined()

    logSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  it('uses the default sampling/robustness config when no override is present', async () => {
    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(sampleClipMock).toHaveBeenCalled())
    const [, , , opts] = sampleClipMock.mock.calls[0]
    expect(opts.maxConsecutiveErrors).toBe(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.maxConsecutiveErrors)
    expect(opts.detectionTimeoutMs).toBe(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.detectionTimeoutMs)
  })

  it('honors a dev-only window override for the sampling/robustness config', async () => {
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = {
      maxConsecutiveErrors: 7,
      detectionTimeoutMs: 1234,
      robustness: { minKeypointConfidence: 0.9 },
    }

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(sampleClipMock).toHaveBeenCalled())
    const [, , , opts] = sampleClipMock.mock.calls[0]
    expect(opts.maxConsecutiveErrors).toBe(7)
    expect(opts.detectionTimeoutMs).toBe(1234)
  })

  it('ignores the window override outside a dev build', async () => {
    vi.stubEnv('DEV', false)
    window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { maxConsecutiveErrors: 7 }

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(sampleClipMock).toHaveBeenCalled())
    const [, , , opts] = sampleClipMock.mock.calls[0]
    expect(opts.maxConsecutiveErrors).toBe(DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.maxConsecutiveErrors)
  })

  it('stops the in-flight handle on unmount', () => {
    const handle = makeFakeHandle()
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}),
      handle,
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { unmount } = renderHook(() => useVideoAnalysis(videoSource, detector))

    unmount()
    expect(handle.stop).toHaveBeenCalledTimes(1)
  })
})
