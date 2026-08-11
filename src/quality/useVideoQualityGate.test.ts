import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'

const { assessVideoQualityMock } = vi.hoisted(() => ({
  assessVideoQualityMock: vi.fn(),
}))

vi.mock('./assessVideoQuality', () => ({
  assessVideoQuality: assessVideoQualityMock,
}))

import { useVideoQualityGate } from './useVideoQualityGate'
import type { VideoQualityAssessment, QualityCheckResult } from './types'

function makeMetadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    durationSec: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    ...overrides,
  }
}

function makeVideoSource(overrides: Partial<VideoSource> = {}): VideoSource {
  const video = document.createElement('video')
  return {
    videoRef: { current: video },
    status: 'empty',
    metadata: null,
    error: null,
    load: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

function makeCheck(
  id: QualityCheckResult['id'],
  status: QualityCheckResult['status'],
): QualityCheckResult {
  return {
    id,
    status,
    value: null,
    threshold: null,
    message: status === 'fail' ? `${id} failed` : null,
  }
}

function passAssessment(): VideoQualityAssessment {
  return {
    overall: 'pass',
    checks: {
      resolution: makeCheck('resolution', 'pass'),
      frameRate: makeCheck('frameRate', 'pass'),
      confidence: makeCheck('confidence', 'pass'),
    },
  }
}

function warnAssessment(): VideoQualityAssessment {
  return {
    overall: 'warn',
    checks: {
      resolution: makeCheck('resolution', 'fail'),
      frameRate: makeCheck('frameRate', 'pass'),
      confidence: makeCheck('confidence', 'pass'),
    },
  }
}

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

beforeEach(() => {
  assessVideoQualityMock.mockReset()
})

describe('useVideoQualityGate', () => {
  it('starts idle when the video source is not ready', () => {
    const { result } = renderHook(() =>
      useVideoQualityGate(makeVideoSource(), makeFakeDetector(), 'ready'),
    )
    expect(result.current.status).toBe('idle')
    expect(result.current.assessment).toBeNull()
    expect(result.current.dismissed).toBe(false)
  })

  it('transitions to assessing then ready once the assessment resolves', async () => {
    let resolveAssessment!: (v: VideoQualityAssessment) => void
    assessVideoQualityMock.mockImplementation(
      () =>
        new Promise<VideoQualityAssessment>((resolve) => {
          resolveAssessment = resolve
        }),
    )

    const { result, rerender } = renderHook(
      (props: { videoSource: VideoSource; detector: PoseDetector | null }) =>
        useVideoQualityGate(props.videoSource, props.detector, 'ready'),
      {
        initialProps: {
          videoSource: makeVideoSource(),
          detector: makeFakeDetector(),
        },
      },
    )

    act(() => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata(),
        }),
        detector: makeFakeDetector(),
      })
    })

    expect(result.current.status).toBe('assessing')
    await waitFor(() => expect(assessVideoQualityMock).toHaveBeenCalledTimes(1))

    const assessment = passAssessment()
    await act(async () => {
      resolveAssessment(assessment)
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.assessment).toEqual(assessment)
  })

  it('resets dismissed to false when a new clip is loaded', async () => {
    assessVideoQualityMock.mockResolvedValue(passAssessment())

    const { result, rerender } = renderHook(
      (props: { videoSource: VideoSource; detector: PoseDetector | null }) =>
        useVideoQualityGate(props.videoSource, props.detector, 'ready'),
      {
        initialProps: {
          videoSource: makeVideoSource(),
          detector: makeFakeDetector(),
        },
      },
    )

    await act(async () => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata({ width: 100 }),
        }),
        detector: makeFakeDetector(),
      })
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => {
      result.current.proceedAnyway()
    })
    expect(result.current.dismissed).toBe(true)

    act(() => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata({ width: 200 }),
        }),
        detector: makeFakeDetector(),
      })
    })

    expect(result.current.dismissed).toBe(false)
  })

  it('proceedAnyway() sets dismissed to true', () => {
    const { result } = renderHook(() =>
      useVideoQualityGate(makeVideoSource(), makeFakeDetector(), 'ready'),
    )
    act(() => {
      result.current.proceedAnyway()
    })
    expect(result.current.dismissed).toBe(true)
  })

  it('discards a stale assessment when a second clip loads before the first resolves', async () => {
    const resolvers: Array<(v: VideoQualityAssessment) => void> = []
    assessVideoQualityMock.mockImplementation(
      () =>
        new Promise<VideoQualityAssessment>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const { result, rerender } = renderHook(
      (props: { videoSource: VideoSource; detector: PoseDetector | null }) =>
        useVideoQualityGate(props.videoSource, props.detector, 'ready'),
      {
        initialProps: {
          videoSource: makeVideoSource(),
          detector: makeFakeDetector(),
        },
      },
    )

    act(() => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata({ width: 100 }),
        }),
        detector: makeFakeDetector(),
      })
    })
    await waitFor(() => expect(assessVideoQualityMock).toHaveBeenCalledTimes(1))

    act(() => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata({ width: 200 }),
        }),
        detector: makeFakeDetector(),
      })
    })
    await waitFor(() => expect(assessVideoQualityMock).toHaveBeenCalledTimes(2))

    const staleAssessment = warnAssessment()
    const currentAssessment = passAssessment()

    // Resolve the *current* (second) run first, then the stale (first) run — the
    // worst-case ordering for a naive "last write wins" implementation.
    await act(async () => {
      resolvers[1](currentAssessment)
    })
    await act(async () => {
      resolvers[0](staleAssessment)
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.assessment).toEqual(currentAssessment)
  })

  it('passes a null detector through to assessVideoQuality without blocking the assessment, once detector loading has failed', async () => {
    assessVideoQualityMock.mockResolvedValue(passAssessment())

    const { result, rerender } = renderHook(
      (props: { videoSource: VideoSource; detector: PoseDetector | null }) =>
        useVideoQualityGate(props.videoSource, props.detector, 'error'),
      {
        initialProps: {
          videoSource: makeVideoSource(),
          detector: null,
        },
      },
    )

    await act(async () => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata(),
        }),
        detector: null,
      })
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(assessVideoQualityMock).toHaveBeenCalledWith(
      expect.objectContaining({ detector: null }),
    )
  })

  it('waits out detectorStatus === "loading" instead of assessing with a not-yet-ready detector', async () => {
    assessVideoQualityMock.mockResolvedValue(passAssessment())

    interface Props {
      videoSource: VideoSource
      detector: PoseDetector | null
      detectorStatus: 'loading' | 'ready' | 'error'
    }
    const initialProps: Props = {
      videoSource: makeVideoSource(),
      detector: null,
      detectorStatus: 'loading',
    }

    const { result, rerender } = renderHook(
      (props: Props) =>
        useVideoQualityGate(
          props.videoSource,
          props.detector,
          props.detectorStatus,
        ),
      { initialProps },
    )

    act(() => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata(),
        }),
        detector: null,
        detectorStatus: 'loading',
      })
    })

    // Video is ready, but the shared detector is still loading -- must not fire yet, and
    // must not show a spurious "no detector" result in the meantime.
    expect(result.current.status).toBe('idle')
    expect(assessVideoQualityMock).not.toHaveBeenCalled()

    const detector = makeFakeDetector()
    await act(async () => {
      rerender({
        videoSource: makeVideoSource({
          status: 'ready',
          metadata: makeMetadata(),
        }),
        detector,
        detectorStatus: 'ready',
      })
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(assessVideoQualityMock).toHaveBeenCalledTimes(1)
    expect(assessVideoQualityMock).toHaveBeenCalledWith(
      expect.objectContaining({ detector }),
    )
  })
})
