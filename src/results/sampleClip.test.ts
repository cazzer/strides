import { describe, expect, it, vi } from 'vitest'
import { sampleClip } from './sampleClip'
import { stubRequestVideoFrameCallback } from '../test/videoFrameCallbackTestUtils'
import type { PoseDetector } from '../pose/detector'
import type { PoseFrame } from '../pose/types'

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeFrame(timestamp: number): PoseFrame {
  return { keypoints: [], timestamp }
}

interface QueuedCall {
  resolve: (frame: PoseFrame | null) => void
  reject: (error: unknown) => void
}

function makeQueuedDetector() {
  const calls: QueuedCall[] = []
  const estimatePose = vi.fn(
    () =>
      new Promise<PoseFrame | null>((resolve, reject) => {
        calls.push({ resolve, reject })
      }),
  )
  return {
    detector: { estimatePose, dispose: vi.fn() } as PoseDetector,
    resolveNext(frame: PoseFrame | null) {
      calls.shift()?.resolve(frame)
    },
    rejectNext(error: unknown = new Error('detect failed')) {
      calls.shift()?.reject(error)
    },
    pendingCount: () => calls.length,
  }
}

function makeResolvingDetector(): PoseDetector {
  return {
    estimatePose: vi.fn((video: HTMLVideoElement) =>
      Promise.resolve(makeFrame(video.currentTime)),
    ),
    dispose: vi.fn(),
  }
}

describe('sampleClip', () => {
  it('kicks off detection for each presented frame and accumulates samples', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const detector = makeResolvingDetector()

    const { promise } = sampleClip(video, detector, 10)

    controller.fire(0.1)
    await flush()
    controller.fire(0.2)
    await flush()

    expect(detector.estimatePose).toHaveBeenCalledTimes(2)

    video.dispatchEvent(new Event('ended'))
    const samples = await promise

    expect(samples).toHaveLength(2)
    expect(samples[0].timestamp).toBe(0.1)
    expect(samples[1].timestamp).toBe(0.2)
  })

  it('re-arms for the next frame after each detection completes', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const detector = makeResolvingDetector()

    sampleClip(video, detector, 10)
    expect(controller.registrationCount()).toBe(1)

    controller.fire(0.1)
    await flush()

    expect(controller.registrationCount()).toBe(2)
  })

  it('drops the presented frame (does not start a new detection) while the previous one is still in flight', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const { detector, resolveNext, pendingCount } = makeQueuedDetector()

    const { promise } = sampleClip(video, detector, 10)

    controller.fire(0.1) // starts detection #1, still pending
    controller.fire(0.2) // should be dropped — detection #1 hasn't resolved yet
    await flush()

    expect(detector.estimatePose).toHaveBeenCalledTimes(1)
    expect(pendingCount()).toBe(1)

    resolveNext(makeFrame(0.1))
    await flush()

    // Now that #1 resolved, the next presented frame starts a new detection.
    controller.fire(0.3)
    await flush()
    expect(detector.estimatePose).toHaveBeenCalledTimes(2)
    resolveNext(makeFrame(0.3))
    await flush()

    video.dispatchEvent(new Event('ended'))
    const samples = await promise
    // Frame at 0.2 was dropped entirely — never recorded.
    expect(samples.map((s) => s.timestamp)).toEqual([0.1, 0.3])
  })

  it('records a per-frame detection error as frame: null and keeps sampling', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const { detector, resolveNext, rejectNext } = makeQueuedDetector()

    const { promise } = sampleClip(video, detector, 10)

    controller.fire(0.1)
    await flush()
    rejectNext(new Error('transient failure'))
    await flush()

    controller.fire(0.2)
    await flush()
    resolveNext(makeFrame(0.2))
    await flush()

    video.dispatchEvent(new Event('ended'))
    const samples = await promise

    expect(samples).toEqual([
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: expect.objectContaining({ timestamp: 0.2 }) },
    ])
  })

  it('aborts via the circuit breaker after maxConsecutiveErrors consecutive failures, rejecting the promise', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const { detector, rejectNext } = makeQueuedDetector()

    const { promise } = sampleClip(video, detector, 10, {
      maxConsecutiveErrors: 3,
    })
    const onRejected = vi.fn()
    promise.catch(onRejected)

    for (let i = 0; i < 3; i += 1) {
      controller.fire(i * 0.1)
      await flush()
      rejectNext(new Error('broken detector'))
      await flush()
    }

    await expect(promise).rejects.toThrow(/3 times in a row/)
    expect(onRejected).toHaveBeenCalled()
    // Circuit breaker tripped — no further re-arming.
    expect(controller.hasPendingCallback()).toBe(false)
  })

  it('does not abort on isolated misses below the circuit-breaker threshold', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const { detector, resolveNext, rejectNext } = makeQueuedDetector()

    const { promise } = sampleClip(video, detector, 10, {
      maxConsecutiveErrors: 3,
    })

    // Error, then success, then error — never 3 in a row.
    controller.fire(0.1)
    await flush()
    rejectNext()
    await flush()

    controller.fire(0.2)
    await flush()
    resolveNext(makeFrame(0.2))
    await flush()

    controller.fire(0.3)
    await flush()
    rejectNext()
    await flush()

    video.dispatchEvent(new Event('ended'))
    const samples = await promise
    expect(samples).toHaveLength(3)
  })

  it('reports progress as a fraction of durationSec after each completed detection', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const detector = makeResolvingDetector()
    const onProgress = vi.fn()

    sampleClip(video, detector, 10, { onProgress })

    controller.fire(5)
    await flush()

    expect(onProgress).toHaveBeenCalledWith(0.5)
  })

  it('invokes onPausedChange on pause and play events', () => {
    const video = document.createElement('video')
    stubRequestVideoFrameCallback(video)
    const detector = makeResolvingDetector()
    const onPausedChange = vi.fn()

    sampleClip(video, detector, 10, { onPausedChange })

    video.dispatchEvent(new Event('pause'))
    expect(onPausedChange).toHaveBeenCalledWith(true)

    video.dispatchEvent(new Event('play'))
    expect(onPausedChange).toHaveBeenCalledWith(false)
  })

  it('resolves with accumulated samples when the video ends', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const detector = makeResolvingDetector()

    const { promise } = sampleClip(video, detector, 10)

    controller.fire(1)
    await flush()
    video.dispatchEvent(new Event('ended'))

    const samples = await promise
    expect(samples).toHaveLength(1)
  })

  it('handle.stop() prevents further re-arming and resolves with samples collected so far', async () => {
    const video = document.createElement('video')
    const controller = stubRequestVideoFrameCallback(video)
    const detector = makeResolvingDetector()

    const { promise, handle } = sampleClip(video, detector, 10)

    controller.fire(0.1)
    await flush()

    handle.stop()
    const samples = await promise
    expect(samples).toHaveLength(1)

    // The already-armed callback (from re-arming after the 0.1 frame) is a no-op once stopped.
    const callsBefore = vi.mocked(detector.estimatePose).mock.calls.length
    controller.fire(0.2)
    await flush()
    expect(vi.mocked(detector.estimatePose).mock.calls.length).toBe(callsBefore)
  })
})
