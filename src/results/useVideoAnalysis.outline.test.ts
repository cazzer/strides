import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { VideoSource } from '../video/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult, SwingFootOutlinePlan } from '../heuristics/types'
import type { SampleClipHandle } from './sampleClip'
import type { OutlineSegmenter } from '../pose/backends/mediapipePoseLandmarker'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import { makeHeuristics } from './__fixtures__/metricResult'
import { OUTLINE_FAILED_CAVEAT, OUTLINE_PLAYBACK_PATH_CAVEAT } from './swingFootOutlineGraft'

const {
  sampleClipMock,
  applyRobustnessMock,
  computeFormHeuristicsMock,
  getScalePassDetectorMock,
  getOutlineSegmenterMock,
  releaseOutlineSegmenterMock,
  canUseSequentialDecodeMock,
  sampleClipSequentialMock,
} = vi.hoisted(() => ({
  releaseOutlineSegmenterMock: vi.fn(),
  sampleClipMock: vi.fn(),
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
  getScalePassDetectorMock: vi.fn(),
  getOutlineSegmenterMock: vi.fn(),
  canUseSequentialDecodeMock: vi.fn(),
  sampleClipSequentialMock: vi.fn(),
}))

vi.mock('./sampleClip', () => ({
  sampleClip: sampleClipMock,
  DEFAULT_MAX_CONSECUTIVE_ERRORS: 30,
  DEFAULT_DETECTION_TIMEOUT_MS: 5000,
}))
vi.mock('./sampleClipSequential', () => ({ sampleClipSequential: sampleClipSequentialMock }))
vi.mock('../pose/robustness/interpolate', () => ({ applyRobustness: applyRobustnessMock }))
vi.mock('../heuristics/index', () => ({ computeFormHeuristics: computeFormHeuristicsMock }))
vi.mock('../pose/scalePassDetector', () => ({ getScalePassDetector: getScalePassDetectorMock }))
vi.mock('../pose/outlinePassDetector', () => ({
  getOutlineSegmenter: getOutlineSegmenterMock,
  releaseOutlineSegmenter: releaseOutlineSegmenterMock,
}))
vi.mock('../video/webCodecsSupport', () => ({ canUseSequentialDecode: canUseSequentialDecodeMock }))
vi.mock('../video/clipBytesCache', () => ({ releaseClipDemux: vi.fn() }))

import { __resetScaleDetectorCreationForTests, useVideoAnalysis } from './useVideoAnalysis'

const sourceBlob = new Blob([new Uint8Array([1, 2, 3])])

function makeVideoSource(): VideoSource {
  return {
    videoRef: { current: document.createElement('video') },
    status: 'ready',
    metadata: { durationSec: 2, width: 1000, height: 1000, frameRate: 60 },
    error: null,
    sourceBlob,
    load: vi.fn(),
    reset: vi.fn(),
  }
}

const detector: PoseDetector = { estimatePose: vi.fn(), dispose: vi.fn() }
const handle = (): SampleClipHandle => ({ stop: vi.fn() })

const ROBUST_FRAMES: RobustPoseFrame[] = [0, 0.1, 0.2].map((timestamp) => ({
  timestamp,
  keypoints: COMMON_KEYPOINT_NAMES.map((name) => ({ name, status: 'detected', x: 1, y: 1, score: 0.9 })),
  source: 'detected',
  pixelsPerMeter: null,
}))

const PLAN: SwingFootOutlinePlan = {
  viewFit: { fit: 'primary', multiplier: 1 },
  periodSeconds: 0.33,
  hipWidthMedianPx: 60,
  lastFrameTimestamp: 0.2,
  windows: [],
  frames: [{
    timestamp: 0.1,
    sides: ['left'],
    crop: { x: 0, y: 0, width: 420, height: 720 },
    keypoints: { left_hip: null, right_hip: null, left_knee: null, right_knee: null },
    quality: { left: 1, right: 1 },
  }],
}

function heuristicsWithPlan(plan: SwingFootOutlinePlan | null): FormHeuristicsResult {
  const base = makeHeuristics()
  return {
    ...base,
    swingFootLateralExcursion: {
      ...base.swingFootLateralExcursion,
      value: null,
      confidence: 0,
      caveat: 'Checking…',
      outlinePlan: plan,
    },
  }
}

const segmenter: OutlineSegmenter = { segment: vi.fn(), close: vi.fn() }

beforeEach(() => {
  for (const mock of [sampleClipMock, applyRobustnessMock, computeFormHeuristicsMock, getScalePassDetectorMock,
    getOutlineSegmenterMock, releaseOutlineSegmenterMock, canUseSequentialDecodeMock,
    sampleClipSequentialMock]) mock.mockReset()
  applyRobustnessMock.mockReturnValue(ROBUST_FRAMES)
  // The scale pass fails fast (no detector), so the lane reaches the outline pass at once.
  getScalePassDetectorMock.mockResolvedValue(null)
  getOutlineSegmenterMock.mockResolvedValue(segmenter)
  canUseSequentialDecodeMock.mockResolvedValue(true)
  sampleClipSequentialMock.mockImplementation(() => ({
    promise: Promise.resolve([{ timestamp: 0.1, frame: null }]),
    handle: handle(),
  }))
  sampleClipMock.mockImplementation(() => ({ promise: new Promise(() => {}), handle: handle() }))
})

afterEach(() => {
  __resetScaleDetectorCreationForTests()
  delete window.__STRIDES_OUTLINE_PASS_CONFIG_OVERRIDE__
})

describe('the background outline pass (strides-uz48)', () => {
  it('runs after the scale pass and grafts only swingFootLateralExcursion: pending → running → done', async () => {
    const primary = heuristicsWithPlan(PLAN)
    computeFormHeuristicsMock.mockReturnValue(primary)
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.outlinePass?.status).toBe('done'))
    // The fixture carries a primary-pass scale, so the scale pass is skipped and the lane goes
    // straight to the outline pass: primary, then outline.
    expect(result.current.scalePass.status).toBe('skipped')
    expect(sampleClipSequentialMock).toHaveBeenCalledTimes(2)
    const metric = result.current.heuristics!.swingFootLateralExcursion
    expect(metric.outline).not.toBeNull()
    expect(metric.outline?.usableCount).toBe(0)
    for (const key of Object.keys(primary) as Array<keyof FormHeuristicsResult>) {
      if (key !== 'swingFootLateralExcursion') expect(result.current.heuristics![key], key).toBe(primary[key])
    }
    // The pass's hold on the shared segmenter is released once it is over.
    await waitFor(() => expect(releaseOutlineSegmenterMock).toHaveBeenCalledTimes(1))
    expect(getOutlineSegmenterMock).toHaveBeenCalledTimes(1)
  })

  it('fails with the unavailable caveat when the segmenter cannot be created', async () => {
    getOutlineSegmenterMock.mockResolvedValue(null)
    computeFormHeuristicsMock.mockReturnValue(heuristicsWithPlan(PLAN))
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.outlinePass?.status).toBe('failed'))
    expect(result.current.heuristics!.swingFootLateralExcursion).toMatchObject({
      value: null,
      caveat: OUTLINE_FAILED_CAVEAT,
    })
    await waitFor(() => expect(releaseOutlineSegmenterMock).toHaveBeenCalledTimes(1))
  })

  it('skips a clip with no plan as not-front, leaving the metric as planned', async () => {
    const primary = heuristicsWithPlan(null)
    computeFormHeuristicsMock.mockReturnValue(primary)
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.outlinePass).toEqual({ status: 'skipped', reason: 'not-front' })
    expect(result.current.heuristics!.swingFootLateralExcursion).toBe(primary.swingFootLateralExcursion)
    expect(getOutlineSegmenterMock).not.toHaveBeenCalled()
  })

  it('skips a playback-path clip with the frame-by-frame caveat', async () => {
    canUseSequentialDecodeMock.mockResolvedValue(false)
    sampleClipMock.mockImplementationOnce(() => ({
      promise: Promise.resolve([{ timestamp: 0, frame: null }]),
      handle: handle(),
    }))
    computeFormHeuristicsMock.mockReturnValue(heuristicsWithPlan(PLAN))
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.outlinePass).toEqual({ status: 'skipped', reason: 'playback-path' })
    expect(result.current.heuristics!.swingFootLateralExcursion.caveat).toBe(OUTLINE_PLAYBACK_PATH_CAVEAT)
    expect(getOutlineSegmenterMock).not.toHaveBeenCalled()
  })

  it('reset() during a running outline pass stops it, and its late resolution writes nothing', async () => {
    computeFormHeuristicsMock.mockReturnValue(heuristicsWithPlan(PLAN))
    let resolveOutline!: (samples: unknown[]) => void
    const outlineHandle = handle()
    sampleClipSequentialMock
      .mockImplementationOnce(() => ({
        promise: Promise.resolve([{ timestamp: 0.1, frame: null }]),
        handle: handle(),
      }))
      .mockImplementationOnce(() => ({
        promise: new Promise((resolve) => {
          resolveOutline = resolve
        }),
        handle: outlineHandle,
      }))
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))

    await waitFor(() => expect(sampleClipSequentialMock).toHaveBeenCalledTimes(2))
    expect(result.current.outlinePass?.status).toBe('running')
    act(() => result.current.reset())
    expect(outlineHandle.stop).toHaveBeenCalled()
    await act(async () => {
      resolveOutline([])
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.heuristics).toBeNull()
    await waitFor(() => expect(releaseOutlineSegmenterMock).toHaveBeenCalledTimes(1))
  })

  it('logs one outline-pass diagnostics line on done, in a dev build', async () => {
    computeFormHeuristicsMock.mockReturnValue(heuristicsWithPlan(PLAN))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const videoSource = makeVideoSource()
    const { result } = renderHook(() => useVideoAnalysis(videoSource, detector))
    await waitFor(() => expect(result.current.outlinePass?.status).toBe('done'))
    const lines = logSpy.mock.calls.filter((args) => args[0] === '[analysis-diagnostics:outline-pass]')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0][1] as string)).toMatchObject({
      status: 'done',
      value: null,
      framesSegmented: 0,
      reading: expect.objectContaining({ usableCount: 0 }),
    })
    logSpy.mockRestore()
  })
})
