import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { SampleClipHandle } from './sampleClip'

const { sampleClipMock, sampleClipSequentialMock } = vi.hoisted(() => ({
  sampleClipMock: vi.fn(),
  sampleClipSequentialMock: vi.fn(),
}))

vi.mock('./sampleClip', () => ({ sampleClip: sampleClipMock }))
vi.mock('./sampleClipSequential', () => ({ sampleClipSequential: sampleClipSequentialMock }))

import { sampleClipAdaptive } from './sampleClipAdaptive'

function makeFakeHandle(): SampleClipHandle {
  return { stop: vi.fn() }
}

function makeFakeDetector(): PoseDetector {
  return { estimatePose: vi.fn(), dispose: vi.fn() }
}

beforeEach(() => {
  sampleClipMock.mockReset()
  sampleClipSequentialMock.mockReset()
  sampleClipMock.mockReturnValue({ promise: Promise.resolve([]), handle: makeFakeHandle() })
  sampleClipSequentialMock.mockReturnValue({
    promise: Promise.resolve([]),
    handle: makeFakeHandle(),
  })
})

describe('sampleClipAdaptive', () => {
  it('dispatches to sampleClip (the <video>-playback path) when sourceBlob is null', () => {
    const video = document.createElement('video')
    const detector = makeFakeDetector()
    const opts = { maxConsecutiveErrors: 5 }
    const sequentialSamplingConfig = { enabled: true, targetSamplesPerSecond: 15 }

    sampleClipAdaptive(video, null, detector, 10, opts, sequentialSamplingConfig)

    expect(sampleClipMock).toHaveBeenCalledTimes(1)
    expect(sampleClipMock).toHaveBeenCalledWith(video, detector, 10, opts)
    expect(sampleClipSequentialMock).not.toHaveBeenCalled()
  })

  it('dispatches to sampleClipSequential (the WebCodecs path) when sourceBlob is non-null', () => {
    const video = document.createElement('video')
    const detector = makeFakeDetector()
    const opts = { maxConsecutiveErrors: 5 }
    const sequentialSamplingConfig = { enabled: true, targetSamplesPerSecond: 15 }
    const sourceBlob = new Blob([new Uint8Array([1, 2, 3])])

    sampleClipAdaptive(video, sourceBlob, detector, 10, opts, sequentialSamplingConfig)

    expect(sampleClipSequentialMock).toHaveBeenCalledTimes(1)
    expect(sampleClipSequentialMock).toHaveBeenCalledWith(
      sourceBlob,
      detector,
      10,
      opts,
      sequentialSamplingConfig,
    )
    expect(sampleClipMock).not.toHaveBeenCalled()
  })

  it('returns whichever sampler\'s { promise, handle } it dispatched to, unwrapped', () => {
    const video = document.createElement('video')
    const detector = makeFakeDetector()
    const sequentialHandle = makeFakeHandle()
    const sequentialPromise = Promise.resolve([])
    sampleClipSequentialMock.mockReturnValue({ promise: sequentialPromise, handle: sequentialHandle })
    const sourceBlob = new Blob([new Uint8Array([1, 2, 3])])

    const result = sampleClipAdaptive(video, sourceBlob, detector, 10, {}, {
      enabled: true,
      targetSamplesPerSecond: null,
    })

    expect(result.promise).toBe(sequentialPromise)
    expect(result.handle).toBe(sequentialHandle)
  })
})
