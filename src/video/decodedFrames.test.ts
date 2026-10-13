import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContainerVideoTrackTiming } from './containerTiming'
import type { DemuxedSample, DemuxedTrack } from './mp4Demux'
import {
  decodeFramesForward,
  decodeRange,
  frameShownAt,
  presentationEndSeconds,
  presentationShiftSeconds,
  presentationTimeline,
  sampleTimestampUs,
} from './decodedFrames'

function timing(overrides: Partial<ContainerVideoTrackTiming> = {}): ContainerVideoTrackTiming {
  return {
    trackId: 1,
    mediaTimescaleHz: 15360,
    movieTimescaleHz: 1000,
    nominalFps: 60,
    elst: [{ segmentDuration: 3884, mediaTime: 512, mediaRateInteger: 1, mediaRateFraction: 0 }],
    stretchFactor: null,
    stretchFactorSource: null,
    ...overrides,
  } as ContainerVideoTrackTiming
}

/** Samples in PRESENTATION order on a 15360 timescale, `ticks[i]` long each, starting at `start`. */
function samples(ticks: number[], start = 512, timescale = 15360): DemuxedSample[] {
  let cts = start
  return ticks.map((duration, index) => {
    const sample: DemuxedSample = {
      data: new Uint8Array([index]),
      ptsSec: cts / timescale,
      durationSec: duration / timescale,
      isKeyframe: index === 0,
    }
    cts += duration
    return sample
  })
}

const SHIFT = 512 / 15360

describe('presentationShiftSeconds', () => {
  it('is the plain shift a single unity-rate edit makes', () => {
    expect(presentationShiftSeconds(timing())).toBe(SHIFT)
  })

  it('is zero with no edit list at all', () => {
    expect(presentationShiftSeconds(timing({ elst: [] }))).toBe(0)
  })

  it('refuses every edit list that is not one plain shift', () => {
    const entry = { segmentDuration: 1000, mediaTime: 512, mediaRateInteger: 1, mediaRateFraction: 0 }
    expect(presentationShiftSeconds(timing({ elst: [entry, entry] }))).toBeNull()
    expect(presentationShiftSeconds(timing({ elst: [{ ...entry, mediaTime: -1 }] }))).toBeNull()
    // 0.5x: mp4box reads the 0x8000 fraction half back as a negative int16.
    expect(
      presentationShiftSeconds(
        timing({ elst: [{ ...entry, mediaRateInteger: 0, mediaRateFraction: -32768 }] }),
      ),
    ).toBeNull()
    expect(presentationShiftSeconds(timing({ mediaTimescaleHz: 0 }))).toBeNull()
  })
})

describe('presentationEndSeconds', () => {
  it("reads the edit's own duration off the movie timescale", () => {
    expect(presentationEndSeconds(timing(), { durationSec: 99 }, SHIFT)).toBe(3.884)
  })

  it('falls back to the media duration less the shift with no edit list', () => {
    expect(presentationEndSeconds(timing({ elst: [] }), { durationSec: 2 }, 0)).toBe(2)
  })
})

describe('frameShownAt', () => {
  const cfr = presentationTimeline({ samples: samples([256, 256, 256, 256]) }, SHIFT, 1)!
  const key = (index: number) => sampleTimestampUs((512 + 256 * index) / 15360)

  it("names the frame whose interval holds the target on a constant-rate track", () => {
    // Frame 2 presents over [512, 768) ticks = [33333.3, 50000) µs.
    expect(frameShownAt(cfr, 0.04)).toBe(key(2))
    expect(frameShownAt(cfr, 0)).toBe(key(0))
  })

  it('truncates the target to whole microseconds the way the seek API does', () => {
    // 1/60 s is 16666.67 µs and frame 0 ends at the rounded 16667. A target a third of a microsecond
    // past the true boundary truncates to 16666 — inside the guard band, so it is refused rather
    // than guessed; ten microseconds before it is unambiguous.
    expect(frameShownAt(cfr, 1 / 60 + 3e-7)).toBeNull()
    expect(frameShownAt(cfr, 1 / 60 - 1e-5)).toBe(key(0))
  })

  it('refuses a target within a microsecond of a deciding frame end', () => {
    expect(frameShownAt(cfr, 0.0333334)).toBeNull()
    expect(frameShownAt(cfr, 0.0333320)).toBeNull()
  })

  it("lets a long sample cover the frames after it, as Chromium's seek does (park-side-portrait)", () => {
    // Presentation spacing 512 ticks throughout, but frame 1 carries a 1536-tick sample duration:
    // a seek into frame 2's or frame 3's interval shows frame 1.
    const vfr = presentationTimeline(
      {
        samples: samples([512, 512, 512, 512, 512]).map((sample, index) =>
          index === 1 ? { ...sample, durationSec: 1536 / 15360 } : sample,
        ),
      },
      SHIFT,
      1,
    )!
    const vfrKey = (index: number) => sampleTimestampUs((512 + 512 * index) / 15360)
    const midOf = (index: number) => (512 * index + 256) / 15360
    expect(frameShownAt(vfr, midOf(0))).toBe(vfrKey(0))
    expect(frameShownAt(vfr, midOf(1))).toBe(vfrKey(1))
    expect(frameShownAt(vfr, midOf(2))).toBe(vfrKey(1))
    expect(frameShownAt(vfr, midOf(3))).toBe(vfrKey(1))
    expect(frameShownAt(vfr, midOf(4))).toBe(vfrKey(4))
  })

  it('refuses a target at or past the presented end, and any non-finite or negative one', () => {
    expect(frameShownAt(cfr, 1)).toBeNull()
    expect(frameShownAt(cfr, Number.NaN)).toBeNull()
    expect(frameShownAt(cfr, -0.1)).toBeNull()
  })
})

describe('decodeRange', () => {
  function track(keyframes: number[], ptsOrder: number[]): Pick<DemuxedTrack, 'samples'> {
    return {
      samples: ptsOrder.map((pts, index) => ({
        data: new Uint8Array(),
        ptsSec: pts,
        durationSec: 0.1,
        isKeyframe: keyframes.includes(index),
      })),
    }
  }
  const us = (seconds: number) => sampleTimestampUs(seconds)

  it('starts at the keyframe before the earliest wanted sample and ends at the latest', () => {
    const t = track([0, 3], [0, 0.1, 0.2, 0.3, 0.4, 0.5])
    expect(decodeRange(t, new Set([us(0.4), us(0.5)]))).toEqual({ start: 3, end: 5 })
    expect(decodeRange(t, new Set([us(0.2), us(0.4)]))).toEqual({ start: 0, end: 4 })
  })

  it('steps back a keyframe for a leading picture that presents before its own keyframe', () => {
    // Decode order: K(0.0) P(0.2) B(0.1) K(0.4) B(0.3) — the B at 0.3 is an open-GOP leading picture.
    const t = track([0, 3], [0, 0.2, 0.1, 0.4, 0.3])
    expect(decodeRange(t, new Set([us(0.3)]))).toEqual({ start: 0, end: 4 })
  })

  it('refuses a timestamp the track does not have', () => {
    const t = track([0], [0, 0.1])
    expect(decodeRange(t, new Set([us(0.05)]))).toBeNull()
    expect(decodeRange(t, new Set())).toBeNull()
  })
})

/**
 * A `VideoDecoder` that outputs every chunk it is fed, as a frame carrying that chunk's timestamp,
 * on a microtask — enough of the real one's contract (async output, `decodeQueueSize`, `dequeue`,
 * `flush`, `close`) to drive the pass.
 */
class FakeVideoDecoder extends EventTarget {
  static instances: FakeVideoDecoder[] = []
  static fail = false
  state: CodecState = 'unconfigured'
  decodeQueueSize = 0
  fed: number[] = []
  readonly closedFrames: number[] = []
  private readonly init: VideoDecoderInit

  constructor(init: VideoDecoderInit) {
    super()
    this.init = init
    FakeVideoDecoder.instances.push(this)
  }

  configure(): void {
    this.state = 'configured'
  }

  decode(chunk: EncodedVideoChunk): void {
    this.fed.push(chunk.timestamp)
    this.decodeQueueSize += 1
    queueMicrotask(() => {
      this.decodeQueueSize -= 1
      this.dispatchEvent(new Event('dequeue'))
      if (this.state === 'closed') return
      if (FakeVideoDecoder.fail) {
        this.init.error(new DOMException('decode failed'))
        return
      }
      const timestamp = chunk.timestamp
      const frame = {
        timestamp,
        displayWidth: 64,
        displayHeight: 32,
        close: () => this.closedFrames.push(timestamp),
      } as unknown as VideoFrame
      this.init.output(frame)
    })
  }

  flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  close(): void {
    this.state = 'closed'
  }
}

class FakeEncodedVideoChunk {
  readonly timestamp: number
  constructor(init: EncodedVideoChunkInit) {
    this.timestamp = init.timestamp
  }
}

function stubWebCodecs() {
  FakeVideoDecoder.instances = []
  FakeVideoDecoder.fail = false
  vi.stubGlobal('VideoDecoder', FakeVideoDecoder)
  vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk)
}

const TRACK: DemuxedTrack = {
  codec: 'avc1.640034',
  description: undefined,
  width: 64,
  height: 32,
  fps: 60,
  durationSec: 4 / 60,
  matrix: [],
  samples: samples([256, 256, 256, 256], 0),
}
const keyOf = (index: number) => sampleTimestampUs(TRACK.samples[index].ptsSec)

describe('decodeFramesForward', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands over exactly the wanted frames, closes every frame, and feeds no further than needed', async () => {
    stubWebCodecs()
    const seen: number[] = []
    const outcome = await decodeFramesForward(
      TRACK,
      new Set([keyOf(1), keyOf(2)]),
      (_frame, key) => seen.push(key),
      { stallTimeoutMs: 1000 },
    )
    expect(outcome).toBe('completed')
    expect(seen).toEqual([keyOf(1), keyOf(2)])
    const [decoder] = FakeVideoDecoder.instances
    expect(decoder.fed).toEqual([keyOf(0), keyOf(1), keyOf(2)])
    expect(decoder.closedFrames).toEqual([keyOf(0), keyOf(1), keyOf(2)])
    expect(decoder.state).toBe('closed')
  })

  it('fails, rather than completing short, when the decoder errors', async () => {
    stubWebCodecs()
    FakeVideoDecoder.fail = true
    const onFrame = vi.fn()
    const outcome = await decodeFramesForward(TRACK, new Set([keyOf(1)]), onFrame, {
      stallTimeoutMs: 1000,
    })
    expect(outcome).toBe('failed')
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('fails when the frame consumer throws, and still closes the frame', async () => {
    stubWebCodecs()
    const outcome = await decodeFramesForward(
      TRACK,
      new Set([keyOf(0)]),
      () => {
        throw new Error('draw failed')
      },
      { stallTimeoutMs: 1000 },
    )
    expect(outcome).toBe('failed')
    expect(FakeVideoDecoder.instances[0].closedFrames).toContain(keyOf(0))
  })

  it('is aborted, not failed, by its signal — and opens nothing when already aborted', async () => {
    stubWebCodecs()
    const controller = new AbortController()
    controller.abort()
    expect(
      await decodeFramesForward(TRACK, new Set([keyOf(0)]), vi.fn(), {
        signal: controller.signal,
        stallTimeoutMs: 1000,
      }),
    ).toBe('aborted')
    expect(FakeVideoDecoder.instances).toHaveLength(0)

    const midway = new AbortController()
    const seen: number[] = []
    const outcome = await decodeFramesForward(
      TRACK,
      new Set([keyOf(0), keyOf(3)]),
      (_frame, key) => {
        seen.push(key)
        midway.abort()
      },
      { signal: midway.signal, stallTimeoutMs: 1000 },
    )
    expect(outcome).toBe('aborted')
    expect(seen).toEqual([keyOf(0)])
  })

  it('fails on a decoder that stops making progress', async () => {
    stubWebCodecs()
    class StalledDecoder extends FakeVideoDecoder {
      override decode(chunk: EncodedVideoChunk): void {
        this.fed.push(chunk.timestamp)
        this.decodeQueueSize += 1
      }
    }
    vi.stubGlobal('VideoDecoder', StalledDecoder)
    const outcome = await decodeFramesForward(TRACK, new Set([keyOf(3)]), vi.fn(), {
      stallTimeoutMs: 20,
    })
    expect(outcome).toBe('failed')
  })

  it('fails without a VideoDecoder at all', async () => {
    expect(await decodeFramesForward(TRACK, new Set([keyOf(0)]), vi.fn(), { stallTimeoutMs: 1 })).toBe(
      'failed',
    )
  })
})
