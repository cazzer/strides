import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DemuxedTrack } from './mp4Demux'

/**
 * A minimal, fully-synchronous fake `VideoDecoder`: `decode()` "outputs" a frame for the chunk
 * just fed immediately, with no real async reordering. This module's own decode-vs-presentation-
 * order contract is exercised for real against `mp4box` in `mp4Demux.test.ts`; this file is about
 * `sequentialFrameSource.ts`'s OWN frame lifecycle/backpressure/cancellation contract (#41's gate
 * 6, and the D3 backpressure bug this commit fixed), which is independent of decode reordering.
 * Every emitted frame is tracked module-wide so tests can assert on `close()` calls without a
 * real `VideoFrame` implementation (unavailable in jsdom).
 */
class FakeVideoFrame {
  closed = false
  timestamp: number
  close = vi.fn(() => {
    this.closed = true
  })
  constructor(timestamp: number) {
    this.timestamp = timestamp
  }
}

let framesEmitted: FakeVideoFrame[] = []

class FakeVideoDecoder {
  static isConfigSupported = vi.fn().mockResolvedValue({ supported: true })
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
  decodeQueueSize = 0
  private readonly output: (frame: FakeVideoFrame) => void

  constructor({ output }: { output: (frame: FakeVideoFrame) => void; error: (err: Error) => void }) {
    this.output = output
  }
  configure() {
    this.state = 'configured'
  }
  decode(chunk: { timestamp: number }) {
    const frame = new FakeVideoFrame(chunk.timestamp)
    framesEmitted.push(frame)
    this.output(frame)
  }
  async flush() {}
  close() {
    this.state = 'closed'
  }
  addEventListener() {
    // No test below ever fills the decoder's OWN queue (decode() is synchronous, so
    // decodeQueueSize never rises above 0) -- the 'dequeue' listener this module registers is
    // therefore never the thing that needs to fire; only SelectedFrameQueue's own waitForRoom
    // path is exercised. A no-op keeps the fake decoder simple without breaking the real feed
    // loop's control flow (it still awaits the OTHER race member in that case).
  }
  removeEventListener() {}
}

class FakeEncodedVideoChunk {
  type: string
  timestamp: number
  duration: number
  data: Uint8Array
  constructor(init: { type: string; timestamp: number; duration: number; data: Uint8Array }) {
    this.type = init.type
    this.timestamp = init.timestamp
    this.duration = init.duration
    this.data = init.data
  }
}

function makeTrack(samples: Array<{ ptsSec: number }>): DemuxedTrack {
  return {
    codec: 'avc1.640034',
    description: undefined,
    width: 640,
    height: 480,
    fps: 30,
    durationSec: samples.length / 30,
    matrix: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
    samples: samples.map((s, i) => ({
      data: new Uint8Array([i]),
      ptsSec: s.ptsSec,
      durationSec: 1 / 30,
      isKeyframe: i === 0,
    })),
  }
}

beforeEach(() => {
  framesEmitted = []
  vi.stubGlobal('VideoDecoder', FakeVideoDecoder)
  vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Imported after the global stubs are declared (not strictly required by hoisting, but keeps the
// module's own top-level `VideoDecoder`/`EncodedVideoChunk` references consistent with how the
// rest of this file reads).
import { openSequentialFrameSource } from './sequentialFrameSource'

describe('openSequentialFrameSource', () => {
  it('closes every unselected frame immediately, and never yields it to the consumer', async () => {
    const track = makeTrack([{ ptsSec: 0 }, { ptsSec: 0.1 }, { ptsSec: 0.2 }, { ptsSec: 0.3 }])
    // Selects only the frames at pts 0 and 0.2 -- 0.1 and 0.3 must close immediately, unselected.
    const selectFrame = (ptsSec: number) => ptsSec === 0 || ptsSec === 0.2

    const source = await openSequentialFrameSource(track, selectFrame)
    const selectedPts: number[] = []
    for await (const { frame, ptsSec } of source.frames) {
      selectedPts.push(ptsSec)
      frame.close()
    }

    expect(selectedPts).toEqual([0, 0.2])
    expect(framesEmitted).toHaveLength(4)
    // Every frame -- selected and unselected alike -- ends up closed: the two unselected ones by
    // the module itself (inside its VideoDecoder output callback), the two selected ones by this
    // consumer loop.
    expect(framesEmitted.every((f) => f.closed)).toBe(true)
  })

  it('never has more than one selected frame open at a time when consumed one at a time', async () => {
    const track = makeTrack([
      { ptsSec: 0 },
      { ptsSec: 0.1 },
      { ptsSec: 0.2 },
      { ptsSec: 0.3 },
      { ptsSec: 0.4 },
    ])
    const source = await openSequentialFrameSource(track, () => true)

    let openCount = 0
    let maxOpenCount = 0
    for await (const { frame } of source.frames) {
      openCount += 1
      maxOpenCount = Math.max(maxOpenCount, openCount)
      // Mirrors sampleClipSequential.ts's own documented discipline: draw + close before pulling
      // the next frame, never holding one open across an await.
      frame.close()
      openCount -= 1
    }

    expect(maxOpenCount).toBe(1)
  })

  it('bounds the number of decoded-but-unconsumed frames even when the consumer never closes them', async () => {
    // The REAL backpressure guarantee (not just consumer discipline): even a slow/misbehaving
    // consumer that never calls close() can't make this module decode the whole clip eagerly --
    // #41's gate 6 (no VideoFrame pool exhaustion), and a permanent regression guard for the
    // exact live-hang bug design.md's D3 records (an unconditional Promise.race that never
    // actually waited for backpressure).
    const track = makeTrack(Array.from({ length: 12 }, (_, i) => ({ ptsSec: i * 0.1 })))
    const source = await openSequentialFrameSource(track, () => true)
    const iterator = source.frames[Symbol.asyncIterator]()

    for (let i = 0; i < 3; i += 1) {
      const result = await iterator.next()
      expect(result.done).toBe(false)
      // Deliberately never close()d -- a misbehaving/slow consumer.
    }

    // Far fewer than all 12 samples should have been decoded by this point.
    expect(framesEmitted.length).toBeLessThan(12)

    source.stop()
  })

  it('stop() mid-stream closes every frame still queued, unconsumed, and ends the iterator', async () => {
    const track = makeTrack([{ ptsSec: 0 }, { ptsSec: 0.1 }, { ptsSec: 0.2 }, { ptsSec: 0.3 }])
    const source = await openSequentialFrameSource(track, () => true)
    const iterator = source.frames[Symbol.asyncIterator]()

    // Pull exactly one frame -- deliberately never closing it -- then stop() before pulling any
    // more. Any other selected frame the decoder already produced sits in the internal queue,
    // unconsumed; stop() must close all of them (SelectedFrameQueue.drainAndCloseAll's contract).
    const first = await iterator.next()
    expect(first.done).toBe(false)
    const firstFrame = first.value!.frame

    source.stop()

    const leaked = framesEmitted.filter((f) => f !== firstFrame && !f.closed)
    expect(leaked).toEqual([])

    // The iterator itself must also terminate -- a stopped source can't keep yielding.
    const afterStop = await iterator.next()
    expect(afterStop.done).toBe(true)
  })

  it('is idempotent -- calling stop() twice does not throw', async () => {
    const track = makeTrack([{ ptsSec: 0 }])
    const source = await openSequentialFrameSource(track, () => true)
    source.stop()
    expect(() => source.stop()).not.toThrow()
  })
})
