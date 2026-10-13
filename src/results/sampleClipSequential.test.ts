import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoseDetector } from '../pose/detector'
import type { PoseFrame } from '../pose/types'
import type { DemuxedTrack } from '../video/mp4Demux'
import type { SelectedVideoFrame } from '../video/sequentialFrameSource'
import { stubCanvas2DContext } from '../test/canvasTestUtils'

const { demuxMp4Mock, openSequentialFrameSourceMock } = vi.hoisted(() => ({
  demuxMp4Mock: vi.fn(),
  openSequentialFrameSourceMock: vi.fn(),
}))

vi.mock('../video/mp4Demux', () => ({ demuxMp4: demuxMp4Mock }))
vi.mock('../video/sequentialFrameSource', () => ({
  openSequentialFrameSource: openSequentialFrameSourceMock,
}))

import { sampleClipSequential } from './sampleClipSequential'
import { yieldToEventLoop } from './yieldToEventLoop'
import { __resetForTests as resetClipBytesCache } from '../video/clipBytesCache'

const FAKE_TRACK: DemuxedTrack = {
  codec: 'avc1.640034',
  description: undefined,
  width: 640,
  height: 480,
  fps: 30,
  durationSec: 1,
  matrix: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
  samples: [],
}

function makeFakeBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])])
}

function makePoseFrame(overrides: Partial<PoseFrame> = {}): PoseFrame {
  return { keypoints: [], timestamp: 0, ...overrides }
}

function makeSelectedFrame(index: number, ptsSec: number): SelectedVideoFrame {
  return {
    frame: { displayWidth: 64, displayHeight: 64, close: vi.fn() } as unknown as VideoFrame,
    index,
    ptsSec,
  }
}

/**
 * A manually-driven async iterable standing in for `sequentialFrameSource.ts`'s real
 * `SequentialFrameSource.frames` — gives full test control over exactly when the next frame
 * becomes available, which the real backpressure-driven queue doesn't expose directly.
 */
function createControlledFrameStream() {
  const pending: SelectedVideoFrame[] = []
  let waitingResolve: ((result: IteratorResult<SelectedVideoFrame>) => void) | null = null
  let finished = false

  return {
    push(item: SelectedVideoFrame) {
      if (waitingResolve) {
        const resolve = waitingResolve
        waitingResolve = null
        resolve({ value: item, done: false })
        return
      }
      pending.push(item)
    },
    finish() {
      finished = true
      if (waitingResolve) {
        const resolve = waitingResolve
        waitingResolve = null
        resolve({ value: undefined, done: true })
      }
    },
    asyncIterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SelectedVideoFrame>> {
            const item = pending.shift()
            if (item) return Promise.resolve({ value: item, done: false })
            if (finished) return Promise.resolve({ value: undefined, done: true })
            return new Promise((resolve) => {
              waitingResolve = resolve
            })
          },
        }
      },
    },
  }
}

/** Enough microtask ticks and event-loop turns for this module's internal async chains (draw ->
 * await detection -> push -> progress -> yield) to settle between controlled test steps. */
async function flush() {
  // Three rounds of microtasks around two event-loop turns: the sampler yields a macrotask after
  // every frame (yieldToEventLoop), so draining microtasks alone stops at that yield.
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 30; i += 1) {
      await Promise.resolve()
    }
    if (round < 2) await yieldToEventLoop()
  }
}

beforeEach(() => {
  resetClipBytesCache()
  demuxMp4Mock.mockReset()
  openSequentialFrameSourceMock.mockReset()
  demuxMp4Mock.mockResolvedValue(FAKE_TRACK)
  stubCanvas2DContext()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sampleClipSequential', () => {
  it('collects samples in order and resolves once the frame stream ends naturally', async () => {
    const stream = createControlledFrameStream()
    const stopMock = vi.fn()
    openSequentialFrameSourceMock.mockResolvedValue({ frames: stream.asyncIterable, stop: stopMock })

    const frameA = makePoseFrame({ timestamp: 0 })
    const frameB = makePoseFrame({ timestamp: 0.1 })
    const detector: PoseDetector = {
      estimatePose: vi
        .fn()
        .mockResolvedValueOnce(frameA)
        .mockResolvedValueOnce(frameB),
      dispose: vi.fn(),
    }

    const { promise } = sampleClipSequential(makeFakeBlob(), detector, 1, {}, {
      enabled: true,
      targetSamplesPerSecond: null,
    })

    stream.push(makeSelectedFrame(0, 0))
    await flush()
    stream.push(makeSelectedFrame(1, 0.1))
    await flush()
    stream.finish()

    const samples = await promise
    expect(samples).toEqual([
      { timestamp: 0, frame: frameA },
      { timestamp: 0.1, frame: frameB },
    ])
  })

  it('reports its stage timings once when the frame stream ends naturally', async () => {
    const stream = createControlledFrameStream()
    openSequentialFrameSourceMock.mockResolvedValue({ frames: stream.asyncIterable, stop: vi.fn() })
    const detector: PoseDetector = {
      estimatePose: vi.fn().mockResolvedValue(makePoseFrame()),
      dispose: vi.fn(),
    }
    const onTimings = vi.fn()

    const { promise } = sampleClipSequential(makeFakeBlob(), detector, 1, { onTimings }, {
      enabled: true,
      targetSamplesPerSecond: null,
    })

    stream.push(makeSelectedFrame(0, 0))
    stream.push(makeSelectedFrame(1, 0.1))
    await flush()
    stream.finish()
    await promise

    expect(onTimings).toHaveBeenCalledTimes(1)
    const timings = onTimings.mock.calls[0][0]
    expect(timings).toMatchObject({
      path: 'sequential',
      drawMs: { count: 2 },
      detectMs: { count: 2 },
      decodeWaitMs: { count: 2 },
    })
    for (const stage of ['arrayBufferMs', 'demuxMs', 'decoderOpenMs', 'totalMs']) {
      expect(timings[stage]).toBeTypeOf('number')
    }
  })

  it('yields to the event loop between frames, so a run of ready frames never runs as one microtask chain', async () => {
    const stream = createControlledFrameStream()
    openSequentialFrameSourceMock.mockResolvedValue({ frames: stream.asyncIterable, stop: vi.fn() })
    const detector: PoseDetector = {
      estimatePose: vi.fn(async () => makePoseFrame()),
      dispose: vi.fn(),
    }

    sampleClipSequential(makeFakeBlob(), detector, 1, {}, { enabled: true, targetSamplesPerSecond: null })
    stream.push(makeSelectedFrame(0, 0))
    stream.push(makeSelectedFrame(1, 0.1))
    stream.push(makeSelectedFrame(2, 0.2))

    // Microtasks alone: the loop detects frame 0 and then parks on its yield.
    for (let i = 0; i < 200; i += 1) await Promise.resolve()
    expect(detector.estimatePose).toHaveBeenCalledTimes(1)

    // Each event-loop turn lets exactly one more frame through.
    await yieldToEventLoop()
    for (let i = 0; i < 200; i += 1) await Promise.resolve()
    expect(detector.estimatePose).toHaveBeenCalledTimes(2)
  })

  it('stop() resolves with only the samples already collected — a detection that settles after stop() is not appended', async () => {
    const stream = createControlledFrameStream()
    openSequentialFrameSourceMock.mockResolvedValue({ frames: stream.asyncIterable, stop: vi.fn() })

    const collectedFrame = makePoseFrame({ timestamp: 0 })
    const lateFrame = makePoseFrame({ timestamp: 0.1 })
    const detectResolvers: Array<(frame: PoseFrame) => void> = []
    const detector: PoseDetector = {
      estimatePose: vi.fn(
        () =>
          new Promise<PoseFrame>((resolve) => {
            detectResolvers.push(resolve)
          }),
      ),
      dispose: vi.fn(),
    }

    const { promise, handle } = sampleClipSequential(makeFakeBlob(), detector, 1, {}, {
      enabled: true,
      targetSamplesPerSecond: null,
    })

    // Frame 1: detection resolves normally, before stop().
    stream.push(makeSelectedFrame(0, 0))
    await flush()
    expect(detectResolvers).toHaveLength(1)
    detectResolvers[0](collectedFrame)
    await flush()

    // Frame 2: pushed and detection started, but still in flight when stop() runs.
    stream.push(makeSelectedFrame(1, 0.1))
    await flush()
    expect(detectResolvers).toHaveLength(2)

    handle.stop()
    const samples = await promise
    // Only frame 1 made it in -- frame 2's detection hadn't settled when stop() ran.
    expect(samples).toEqual([{ timestamp: 0, frame: collectedFrame }])

    // The in-flight detection now resolves AFTER stop() already settled the promise -- must not
    // mutate the array the caller already received.
    detectResolvers[1](lateFrame)
    await flush()
    expect(samples).toEqual([{ timestamp: 0, frame: collectedFrame }])
  })

  it('stop() calls through to the underlying frame source so the decoder actually releases resources', async () => {
    const stream = createControlledFrameStream()
    const stopMock = vi.fn()
    openSequentialFrameSourceMock.mockResolvedValue({ frames: stream.asyncIterable, stop: stopMock })

    const detector: PoseDetector = {
      estimatePose: vi.fn(() => new Promise<PoseFrame>(() => {})),
      dispose: vi.fn(),
    }

    const { handle } = sampleClipSequential(makeFakeBlob(), detector, 1, {}, {
      enabled: true,
      targetSamplesPerSecond: null,
    })
    await flush()

    handle.stop()
    await flush()

    expect(stopMock).toHaveBeenCalledTimes(1)
  })

  it('aborts the promise when demuxing the clip fails, rather than hanging', async () => {
    demuxMp4Mock.mockRejectedValue(new Error('malformed clip'))
    const detector: PoseDetector = { estimatePose: vi.fn(), dispose: vi.fn() }

    const { promise } = sampleClipSequential(makeFakeBlob(), detector, 1, {}, {
      enabled: true,
      targetSamplesPerSecond: null,
    })

    await expect(promise).rejects.toThrow('malformed clip')
    expect(openSequentialFrameSourceMock).not.toHaveBeenCalled()
  })

  it('a second pass over the same clip reuses the first pass\'s demuxed track instead of reading it again', async () => {
    const blob = makeFakeBlob()
    const readSpy = vi.spyOn(blob, 'arrayBuffer')
    const detector: PoseDetector = {
      estimatePose: vi.fn().mockResolvedValue(makePoseFrame()),
      dispose: vi.fn(),
    }
    const config = { enabled: true, targetSamplesPerSecond: null }

    const runPass = async () => {
      const stream = createControlledFrameStream()
      openSequentialFrameSourceMock.mockResolvedValueOnce({
        frames: stream.asyncIterable,
        stop: vi.fn(),
      })
      const onTimings = vi.fn()
      const { promise } = sampleClipSequential(blob, detector, 1, { onTimings }, config)
      await flush()
      stream.finish()
      await promise
      return onTimings.mock.calls[0][0]
    }

    await runPass()
    const second = await runPass()

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
    expect(openSequentialFrameSourceMock.mock.calls[1][0]).toBe(
      openSequentialFrameSourceMock.mock.calls[0][0],
    )
    expect(second.arrayBufferMs).toBe(0)
    expect(second.demuxMs).toBeTypeOf('number')
  })
})
