import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type {
  FormHeuristicsResult,
  ScaleCalibratedVerticalOscillation,
} from '../heuristics/types'
import type { SampleClipHandle } from './sampleClip'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import { DEFAULT_SAMPLING_ROBUSTNESS_CONFIG } from './samplingRobustnessConfig'
import { SCALE_PASS_PROVENANCE_CAVEAT } from './scalePassGraft'

const {
  sampleClipMock,
  applyRobustnessMock,
  computeFormHeuristicsMock,
  getScalePassDetectorMock,
  canUseSequentialDecodeMock,
} = vi.hoisted(() => ({
  sampleClipMock: vi.fn(),
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
  getScalePassDetectorMock: vi.fn(),
  canUseSequentialDecodeMock: vi.fn(),
}))

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

vi.mock('../pose/scalePassDetector', () => ({
  getScalePassDetector: getScalePassDetectorMock,
}))

// Mocked (rather than left real) specifically so the repair-round regression guard below can
// assert it's never CALLED under the default config -- a real `canUseSequentialDecode` would
// already resolve `false` in jsdom (no `VideoDecoder`), which is behaviorally identical for
// every OTHER test in this file, but tells you nothing about whether the probe was skipped
// entirely (the actual point of `SequentialSamplingConfig.enabled`) vs. called-and-happened-to-
// fail. Every other test in this file never overrides `sequentialSampling.enabled`, so under the
// real default-disabled gating this mock is never invoked for them either -- mocking it changes
// nothing about their behavior, only makes it observable.
vi.mock('../video/webCodecsSupport', () => ({
  canUseSequentialDecode: canUseSequentialDecodeMock,
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
    sourceBlob: null,
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
      "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres.",
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
  stepWidth: {
    metric: 'stepWidth',
    value: 0.15,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  stepWidthCm: {
    metric: 'stepWidthCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat:
      "No real-world scale could be measured for this clip, so step width can't be reported in centimetres.",
  },
}

function makeFakeHandle(): SampleClipHandle {
  return { stop: vi.fn() }
}

// A calibration as the scale pass would measure it — non-null is what makes a scale pass's
// result graftable (see useVideoAnalysis's graft rule).
const FAKE_SCALE_CALIBRATION: ScaleCalibratedVerticalOscillation = {
  verticalOscillationCm: 4.79,
  sampleSize: 3,
  observedCycles: 3.4,
  fit: {
    frequencyHz: 1.52,
    peakToPeakAmplitudeCm: 4.79,
    sinusoidR2: 0.49,
    totalR2: 0.9,
    secondPeakRatio: 0.5,
    sampleCount: 57,
    spanSeconds: 2.24,
    observedCycles: 3.4,
  },
  fitFailureReason: null,
  scaleDriftRatio: 1.01,
  medianPixelsPerMeter: 872,
  torsoMeters: 0.505,
  scaleCoverage: 0.9,
  integrationRuns: 1,
}

// What the scale pass's own computeFormHeuristics call returns: measured centimetre metrics for
// BOTH verticalOscillationCm and stepWidthCm (#45), plus a deliberately DIFFERENT trunkLean value
// (99 vs. the primary's 5) so a test can prove the graft discarded everything except those two.
const FAKE_SCALE_HEURISTICS: FormHeuristicsResult = {
  ...FAKE_HEURISTICS,
  trunkLean: { ...FAKE_HEURISTICS.trunkLean, value: 99 },
  verticalOscillationCm: {
    metric: 'verticalOscillationCm',
    value: 4.79,
    unit: 'centimeters',
    confidence: 0.5,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 3,
    caveat: null,
    calibration: FAKE_SCALE_CALIBRATION,
  },
  stepWidthCm: {
    metric: 'stepWidthCm',
    value: 8.2,
    unit: 'centimeters',
    confidence: 0.5,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
}

beforeEach(() => {
  sampleClipMock.mockReset()
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  getScalePassDetectorMock.mockReset()
  canUseSequentialDecodeMock.mockReset()
  applyRobustnessMock.mockReturnValue(FAKE_ROBUST_FRAMES)
  computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)
  getScalePassDetectorMock.mockResolvedValue(makeFakeDetector())
  // Matches what the REAL canUseSequentialDecode resolves to in jsdom anyway (no VideoDecoder
  // global) -- only matters for a test that explicitly opts into the sequential plane via a
  // config override; every other test never reaches this mock at all under the default-disabled
  // gating (see the regression-guard test below).
  canUseSequentialDecodeMock.mockResolvedValue(false)
  // Default: never resolves, so tests that don't care about sampling's outcome don't need to
  // supply their own implementation just to satisfy the auto-start effect firing on mount.
  // NOTE: since the background scale pass shipped, a run that reaches 'ready' calls sampleClip a
  // SECOND time (the scale pass) with this same implementation — with these default fixtures
  // (calibration: null) a resolving implementation concludes that pass 'failed' ("measured no
  // real-world scale"), leaving the primary result untouched.
  sampleClipMock.mockImplementation(() => ({
    promise: new Promise(() => {}),
    handle: makeFakeHandle(),
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__
  delete window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__
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

  it('auto-starts analysis once the video is ready and a detector is available', async () => {
    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    // Auto-start now waits for the sequential-decode feasibility probe to settle first (jsdom has
    // no VideoDecoder, so it resolves false — but still asynchronously, one tick later) before
    // firing start() — see useVideoAnalysis.ts's sequentialDecodeSupported doc.
    await waitFor(() => expect(result.current.phase).toBe('sampling'))
    expect(sampleClipMock).toHaveBeenCalledTimes(1)
  })

  it('never calls canUseSequentialDecode under the default config — the sequential path is unreachable without an explicit opt-in', async () => {
    // Regression guard for the repair round's must-fix #1: SequentialSamplingConfig.enabled
    // defaults to false, and the probe-kickoff effect is supposed to skip calling
    // canUseSequentialDecode ENTIRELY in that case (not call it and ignore the result) — a config-
    // value-only test (samplingRobustnessConfig.test.ts's "ships disabled by default") can't catch
    // a future edit that inverts the enabled ? ... : ... ternary, relaxes either
    // `sequentialDecodeSupported === true` check, or flips the default, since none of those would
    // fail a snapshot of the default object. This does: any of those edits would make this mock
    // get called, failing the assertion below.
    //
    // sourceBlob is deliberately a real, non-null Blob (not the default null) -- with a null
    // sourceBlob, sampleClipAdaptive.ts's own dispatch would use the playback path regardless of
    // whether the probe ran, which would make this guard weaker than it looks.
    const sourceBlob = new Blob([new Uint8Array([1, 2, 3])])
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const videoSource = makeVideoSource({ sourceBlob })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    // Wait out the background scale pass too (it reads the same probe result) so this assertion
    // covers the entire run, not just the point where the primary pass started sampling.
    await waitFor(() =>
      expect(['done', 'failed', 'skipped']).toContain(result.current.scalePass.status),
    )

    expect(canUseSequentialDecodeMock).not.toHaveBeenCalled()
    // And the corollary: every sample the mocked sampler actually received came through the
    // playback dispatch, i.e. sampleClip -- never sampleClipSequential (mocked away entirely at
    // the ./sampleClip module boundary shared by both call sites, so if the sequential path had
    // engaged, sampleClipMock would have been called fewer times than the two real passes below).
    expect(sampleClipMock).toHaveBeenCalledTimes(2)
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

    await waitFor(() => expect(result.current.phase).toBe('sampling'))

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

    // Auto-start (and therefore sampleClipMock's call that captures rejectSampling) waits on the
    // sequential-decode probe settling first.
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalled())

    await act(async () => {
      rejectSampling(new Error('broken detector'))
    })

    await waitFor(() => expect(result.current.phase).toBe('error'))
    expect(result.current.error?.kind).toBe('detection-stalled')
  })

  it('reset() stops an active run and returns to idle', async () => {
    const handle = makeFakeHandle()
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}), // never resolves
      handle,
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))
    await waitFor(() => expect(result.current.phase).toBe('sampling'))

    act(() => {
      result.current.reset()
    })

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
    expect(result.current.robustFrames).toBeNull()
  })

  it('abandons the old run and auto-starts a new one when videoSource.metadata identity changes mid-analysis', async () => {
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
    await waitFor(() => expect(result.current.phase).toBe('sampling'))

    // The new clip is also immediately 'ready' (as it would be for e.g. the demo video button),
    // so the old run is abandoned and a fresh one auto-starts for the new clip once ITS OWN
    // sequential-decode probe (kicked off fresh, keyed on the new clip's metadata identity)
    // settles.
    const nextVideoSource = makeVideoSource({ metadata: makeMetadata({ width: 999 }) })
    act(() => {
      rerender({ videoSource: nextVideoSource, detector })
    })

    expect(handle.stop).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.phase).toBe('sampling'))
  })

  it('loops the video, muted, once analysis reaches ready and the scale pass concludes', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const video = document.createElement('video')
    const videoSource = makeVideoSource({ videoRef: { current: video } })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    // With the default fixtures the scale pass runs and concludes 'failed' (no scale measured)
    // -- the loop arms the moment the pass reaches a terminal status, not at 'ready' itself.
    await waitFor(() => expect(video.loop).toBe(true))
    expect(video.muted).toBe(true)
  })

  it('mutes the video before restarting playback for the loop', async () => {
    sampleClipMock.mockImplementation(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: makeFakeHandle(),
    }))

    const video = document.createElement('video')
    const mutedAtPlay: boolean[] = []
    vi.spyOn(video, 'play').mockImplementation(() => {
      mutedAtPlay.push(video.muted)
      return Promise.resolve()
    })

    const videoSource = makeVideoSource({ videoRef: { current: video } })
    const detector = makeFakeDetector()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    // Three play() calls per run now: primary sampling's own (auto-start on mount), the scale
    // pass's replay, and -- once the pass concludes ('failed' with these default fixtures) --
    // the loop-restart. The loop-restart is the one whose muting this test is about.
    await waitFor(() => expect(video.loop).toBe(true))

    expect(mutedAtPlay.length).toBe(3)
    expect(mutedAtPlay[2]).toBe(true)
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
    // The loop arms once the scale pass concludes ('failed' with these default fixtures).
    await waitFor(() => expect(video.loop).toBe(true))

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

  it('stops the in-flight handle on unmount', async () => {
    const handle = makeFakeHandle()
    sampleClipMock.mockImplementation(() => ({
      promise: new Promise(() => {}),
      handle,
    }))

    const videoSource = makeVideoSource()
    const detector = makeFakeDetector()
    const { unmount } = renderHook(() => useVideoAnalysis(videoSource, detector))

    // Wait for auto-start (gated on the sequential-decode probe settling) to actually populate
    // handleRef before unmounting, or there is no in-flight handle for unmount's cleanup to stop.
    await waitFor(() => expect(sampleClipMock).toHaveBeenCalled())

    unmount()
    expect(handle.stop).toHaveBeenCalledTimes(1)
  })

  describe('background scale pass', () => {
    // Both passes resolve immediately with one sample each -- the shape most scale-pass tests
    // want. Tests needing to hold the scale pass open override the second call instead.
    function mockBothPassesResolving() {
      sampleClipMock.mockImplementation(() => ({
        promise: Promise.resolve([{ timestamp: 0, frame: null }]),
        handle: makeFakeHandle(),
      }))
    }

    it('runs after ready and grafts verticalOscillationCm AND stepWidthCm into the displayed heuristics', async () => {
      mockBothPassesResolving()
      computeFormHeuristicsMock
        .mockReturnValueOnce(FAKE_HEURISTICS)
        .mockReturnValueOnce(FAKE_SCALE_HEURISTICS)
      const scaleDetector = makeFakeDetector()
      getScalePassDetectorMock.mockResolvedValue(scaleDetector)

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.phase).toBe('ready'))
      await waitFor(() => expect(result.current.scalePass.status).toBe('done'))

      // Two sampling passes: the primary with the primary detector, the scale pass with the
      // dedicated one.
      expect(sampleClipMock).toHaveBeenCalledTimes(2)
      expect(sampleClipMock.mock.calls[0][1]).toBe(detector)
      expect(sampleClipMock.mock.calls[1][1]).toBe(scaleDetector)

      // Grafted: both centimetre metrics are the scale pass's, provenance appended, calibration
      // by reference (verticalOscillationCm only -- stepWidthCm has no such companion object)...
      const grafted = result.current.heuristics
      expect(grafted?.verticalOscillationCm.value).toBe(4.79)
      expect(grafted?.verticalOscillationCm.caveat).toBe(SCALE_PASS_PROVENANCE_CAVEAT)
      expect(grafted?.verticalOscillationCm.calibration).toBe(FAKE_SCALE_CALIBRATION)
      expect(grafted?.stepWidthCm.value).toBe(8.2)
      expect(grafted?.stepWidthCm.caveat).toBe(SCALE_PASS_PROVENANCE_CAVEAT)
      // ...and nothing else is: the scale pass's trunkLean (99) is discarded, the primary's (5)
      // survives by reference.
      expect(grafted?.trunkLean).toBe(FAKE_HEURISTICS.trunkLean)
      expect(grafted?.view).toBe(FAKE_HEURISTICS.view)

      // The run's diagnostics stay the PRIMARY pass's (whose backend measured no scale), while
      // the scale pass's own diagnostics carry the measured calibration by reference.
      expect(result.current.diagnostics).not.toBeNull()
      expect('scaleCalibration' in result.current.diagnostics!).toBe(false)
      expect(result.current.scalePass.diagnostics?.scaleCalibration).toBe(
        FAKE_SCALE_CALIBRATION,
      )
    })

    it('marks the pass failed and leaves the primary result untouched when scale sampling rejects', async () => {
      sampleClipMock
        .mockImplementationOnce(() => ({
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: makeFakeHandle(),
        }))
        .mockImplementationOnce(() => ({
          promise: Promise.reject(new Error('scale sampling broke')),
          handle: makeFakeHandle(),
        }))

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('failed'))
      expect(result.current.scalePass.error).toMatch(/scale sampling broke/)
      expect(result.current.phase).toBe('ready')
      expect(result.current.heuristics).toBe(FAKE_HEURISTICS)
      // Only the primary pass computed heuristics -- the failed scale pass never got there.
      expect(computeFormHeuristicsMock).toHaveBeenCalledTimes(1)
    })

    it('marks the pass failed when it completes without measuring any scale', async () => {
      mockBothPassesResolving()
      // Default fixtures: both passes yield FAKE_HEURISTICS, whose calibration is null -- the
      // graft rule refuses a scale pass that measured nothing.

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('failed'))
      expect(result.current.scalePass.error).toMatch(/measured no real-world scale/)
      expect(result.current.heuristics).toBe(FAKE_HEURISTICS)
    })

    it('marks the pass failed when the scale-pass detector cannot be created', async () => {
      mockBothPassesResolving()
      getScalePassDetectorMock.mockResolvedValue(null)

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('failed'))
      expect(result.current.scalePass.error).toMatch(/detector/i)
      // Sampling never started for the pass -- only the primary call happened.
      expect(sampleClipMock).toHaveBeenCalledTimes(1)
      expect(result.current.heuristics).toBe(FAKE_HEURISTICS)
    })

    it('fails the pass via the wall-clock watchdog when scale sampling never settles', async () => {
      // Only setTimeout/clearTimeout are faked: waitFor can't be used under fake timers (its
      // own polling uses them), so this test flushes microtasks with bounded act() loops
      // instead.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const scaleHandle = makeFakeHandle()
        sampleClipMock
          .mockImplementationOnce(() => ({
            promise: Promise.resolve([{ timestamp: 0, frame: null }]),
            handle: makeFakeHandle(),
          }))
          .mockImplementationOnce(() => ({
            promise: new Promise(() => {}),
            handle: scaleHandle,
          }))

        const videoSource = makeVideoSource()
        const detector = makeFakeDetector()
        const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

        for (let i = 0; i < 10 && result.current.scalePass.status !== 'running'; i += 1) {
          await act(async () => {})
        }
        expect(result.current.scalePass.status).toBe('running')

        // durationSec is 10 (makeMetadata), so the watchdog is max(30s, 3 x 10s) = 30s.
        await act(async () => {
          vi.advanceTimersByTime(30_000)
        })

        expect(result.current.scalePass.status).toBe('failed')
        expect(result.current.scalePass.error).toMatch(/watchdog/)
        expect(scaleHandle.stop).toHaveBeenCalledTimes(1)
        expect(result.current.heuristics).toBe(FAKE_HEURISTICS)
      } finally {
        vi.useRealTimers()
      }
    })

    it('skips the pass when the primary result already carries a measured scale', async () => {
      mockBothPassesResolving()
      computeFormHeuristicsMock.mockReturnValue(FAKE_SCALE_HEURISTICS)

      const video = document.createElement('video')
      const videoSource = makeVideoSource({ videoRef: { current: video } })
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.phase).toBe('ready'))

      expect(result.current.scalePass.status).toBe('skipped')
      expect(result.current.scalePass.reason).toBe('primary-scale')
      expect(sampleClipMock).toHaveBeenCalledTimes(1)
      expect(getScalePassDetectorMock).not.toHaveBeenCalled()
      expect(result.current.heuristics).toBe(FAKE_SCALE_HEURISTICS)
      // A skipped pass never blocks the loop -- it arms straight from the ready commit.
      expect(video.loop).toBe(true)
    })

    it('skips the pass when the kill switch is off', async () => {
      window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__ = { enabled: false }
      mockBothPassesResolving()

      const video = document.createElement('video')
      const videoSource = makeVideoSource({ videoRef: { current: video } })
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.phase).toBe('ready'))

      expect(result.current.scalePass.status).toBe('skipped')
      expect(result.current.scalePass.reason).toBe('disabled')
      expect(sampleClipMock).toHaveBeenCalledTimes(1)
      expect(getScalePassDetectorMock).not.toHaveBeenCalled()
      expect(video.loop).toBe(true)
    })

    it('reset() stops a running scale pass, and its late resolution writes nothing', async () => {
      const scaleHandle = makeFakeHandle()
      let resolveScale!: (samples: unknown[]) => void
      sampleClipMock
        .mockImplementationOnce(() => ({
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: makeFakeHandle(),
        }))
        .mockImplementationOnce(() => ({
          promise: new Promise((resolve) => {
            resolveScale = resolve
          }),
          handle: scaleHandle,
        }))
      computeFormHeuristicsMock
        .mockReturnValueOnce(FAKE_HEURISTICS)
        .mockReturnValueOnce(FAKE_SCALE_HEURISTICS)

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('running'))

      act(() => {
        result.current.reset()
      })
      expect(scaleHandle.stop).toHaveBeenCalledTimes(1)
      expect(result.current.phase).toBe('idle')
      expect(result.current.scalePass.status).toBe('idle')

      // A late resolution of the abandoned pass's promise must not write anything -- no graft,
      // no status change, no second heuristics computation.
      await act(async () => {
        resolveScale([{ timestamp: 0, frame: null }])
      })
      expect(result.current.phase).toBe('idle')
      expect(result.current.heuristics).toBeNull()
      expect(result.current.scalePass.status).toBe('idle')
      expect(computeFormHeuristicsMock).toHaveBeenCalledTimes(1)
    })

    it('start() mid-pass stops the scale handle so it cannot sample concurrently with the new run', async () => {
      const scaleHandle = makeFakeHandle()
      let resolveScale!: (samples: unknown[]) => void
      sampleClipMock
        .mockImplementationOnce(() => ({
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: makeFakeHandle(),
        }))
        .mockImplementationOnce(() => ({
          promise: new Promise((resolve) => {
            resolveScale = resolve
          }),
          handle: scaleHandle,
        }))
        // The re-analyze run's primary pass.
        .mockImplementationOnce(() => ({
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: makeFakeHandle(),
        }))
      computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('running'))

      act(() => {
        result.current.start()
      })
      // The old pass's sampler must be stopped BEFORE the new run samples -- a still-attached
      // MediaPipe loop would run inference concurrently with the new primary pass, silently
      // degrading its sampling density.
      expect(scaleHandle.stop).toHaveBeenCalledTimes(1)

      await waitFor(() => expect(result.current.phase).toBe('ready'))
      const heuristicsAfterRestart = result.current.heuristics

      // The abandoned pass's late resolution writes nothing into the new run.
      await act(async () => {
        resolveScale([{ timestamp: 0, frame: null }])
      })
      expect(result.current.heuristics).toBe(heuristicsAfterRestart)
    })

    it('fails fast when the user pauses playback mid-pass, and ignores the natural ended pause', async () => {
      const scaleHandle = makeFakeHandle()
      sampleClipMock
        .mockImplementationOnce(() => ({
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: makeFakeHandle(),
        }))
        .mockImplementationOnce(() => ({
          promise: new Promise(() => {}),
          handle: scaleHandle,
        }))
      computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)

      const video = document.createElement('video')
      const videoSource = makeVideoSource({ videoRef: { current: video } })
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('running'))
      const scaleCallOptions = sampleClipMock.mock.calls[1][3] as {
        onPausedChange?: (paused: boolean) => void
      }
      expect(scaleCallOptions.onPausedChange).toBeTypeOf('function')

      // A natural clip end also fires 'pause' -- with video.ended true it must NOT fail the pass.
      Object.defineProperty(video, 'ended', { configurable: true, value: true })
      act(() => scaleCallOptions.onPausedChange!(true))
      expect(result.current.scalePass.status).toBe('running')

      // A genuine user pause (video not ended) fails the pass immediately.
      Object.defineProperty(video, 'ended', { configurable: true, value: false })
      act(() => scaleCallOptions.onPausedChange!(true))
      expect(result.current.scalePass.status).toBe('failed')
      expect(result.current.scalePass.error).toMatch(/paused/i)
      expect(scaleHandle.stop).toHaveBeenCalledTimes(1)
      expect(result.current.heuristics).toBe(FAKE_HEURISTICS)
    })

    it('keeps the video un-looped while the pass runs, and loops it after done', async () => {
      let resolveScale!: (samples: unknown[]) => void
      sampleClipMock
        .mockImplementationOnce(() => ({
          promise: Promise.resolve([{ timestamp: 0, frame: null }]),
          handle: makeFakeHandle(),
        }))
        .mockImplementationOnce(() => ({
          promise: new Promise((resolve) => {
            resolveScale = resolve
          }),
          handle: makeFakeHandle(),
        }))
      computeFormHeuristicsMock
        .mockReturnValueOnce(FAKE_HEURISTICS)
        .mockReturnValueOnce(FAKE_SCALE_HEURISTICS)

      const video = document.createElement('video')
      const videoSource = makeVideoSource({ videoRef: { current: video } })
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('running'))
      // The pass replays the clip for sampling: muted, and NOT looping (sampleClip needs the
      // natural 'ended' event to resolve).
      expect(video.loop).toBe(false)
      expect(video.muted).toBe(true)

      await act(async () => {
        resolveScale([{ timestamp: 0, frame: null }])
      })
      await waitFor(() => expect(result.current.scalePass.status).toBe('done'))
      expect(video.loop).toBe(true)
    })

    it('logs exactly one primary diagnostics line and one scale-pass line per run, in a dev build', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockBothPassesResolving()
      computeFormHeuristicsMock
        .mockReturnValueOnce(FAKE_HEURISTICS)
        .mockReturnValueOnce(FAKE_SCALE_HEURISTICS)

      const videoSource = makeVideoSource()
      const detector = makeFakeDetector()
      const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

      await waitFor(() => expect(result.current.scalePass.status).toBe('done'))

      const primaryLines = logSpy.mock.calls.filter(
        (args) => args[0] === '[analysis-diagnostics]',
      )
      const scaleLines = logSpy.mock.calls.filter(
        (args) => args[0] === '[analysis-diagnostics:scale-pass]',
      )
      expect(primaryLines.length).toBe(1)
      expect(scaleLines.length).toBe(1)

      // The primary line's payload is byte-identical to what it was before the scale pass
      // existed: primary metrics, no scaleCalibration key (its backend measured none).
      const primaryPayload = JSON.parse(primaryLines[0][1] as string)
      expect('scaleCalibration' in primaryPayload).toBe(false)
      expect(primaryPayload.metrics.trunkLean.value).toBe(5)

      const scalePayload = JSON.parse(scaleLines[0][1] as string)
      expect(scalePayload.status).toBe('done')
      expect(scalePayload.reason).toBeUndefined()
      expect(scalePayload.error).toBeUndefined()
      expect(scalePayload.diagnostics.scaleCalibration.verticalOscillationCm).toBe(4.79)

      logSpy.mockRestore()
    })
  })
})
