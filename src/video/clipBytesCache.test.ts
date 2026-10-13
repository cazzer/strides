/// <reference types="node" />
// Node types for the real-clip case only (reading a demo clip off disk) — see mp4Demux.test.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContainerTimingProbe } from './containerTiming'
import type { DemuxedTrack } from './mp4Demux'

const { demuxMp4Mock, probeContainerTimingMock, logPerfTimingsMock } = vi.hoisted(() => ({
  demuxMp4Mock: vi.fn(),
  probeContainerTimingMock: vi.fn(),
  logPerfTimingsMock: vi.fn(),
}))

vi.mock('./mp4Demux', async () => {
  const actual = await vi.importActual<typeof import('./mp4Demux')>('./mp4Demux')
  return { ...actual, demuxMp4: demuxMp4Mock }
})
vi.mock('./containerTiming', async () => {
  const actual = await vi.importActual<typeof import('./containerTiming')>('./containerTiming')
  return { ...actual, probeContainerTiming: probeContainerTimingMock }
})

vi.mock('../results/perfTimings', async () => {
  const actual =
    await vi.importActual<typeof import('../results/perfTimings')>('../results/perfTimings')
  return { ...actual, logPerfTimings: logPerfTimingsMock }
})

import {
  __resetForTests,
  borrowClipDemux,
  demuxClip,
  probeClipContainerTiming,
  releaseClipDemux,
} from './clipBytesCache'
import type { ClipDemuxTimings } from './clipBytesCache'

function makeTrack(): DemuxedTrack {
  return {
    codec: 'avc1.640034',
    description: undefined,
    width: 640,
    height: 480,
    fps: 30,
    durationSec: 1,
    matrix: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
    samples: [],
  }
}

const OK_PROBE: ContainerTimingProbe = { parseStatus: 'ok', videoTracks: [] }

/** A blob whose `arrayBuffer()` is a spy, so reads can be counted and the buffer instance
 * handed to each parse identified. */
function makeBlob() {
  const blob = new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'video/mp4' })
  const bytes = new ArrayBuffer(4)
  const arrayBuffer = vi.spyOn(blob, 'arrayBuffer').mockResolvedValue(bytes)
  return { blob, bytes, arrayBuffer }
}

beforeEach(() => {
  __resetForTests()
  demuxMp4Mock.mockReset()
  probeContainerTimingMock.mockReset()
  logPerfTimingsMock.mockReset()
  demuxMp4Mock.mockImplementation(async () => makeTrack())
  probeContainerTimingMock.mockResolvedValue(OK_PROBE)
})

// The demux's container probe runs a macrotask after the demux settles; let any a test left
// queued finish before the next test resets the mocks it would otherwise count against.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('demuxClip', () => {
  it('reads and demuxes a clip once, returning the identical track to every later caller', async () => {
    const { blob, arrayBuffer } = makeBlob()

    const first = await demuxClip(blob)
    const second = await demuxClip(blob)

    expect(second).toBe(first)
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight demux between concurrent callers', async () => {
    const { blob, arrayBuffer } = makeBlob()

    const [first, second] = await Promise.all([demuxClip(blob), demuxClip(blob)])

    expect(second).toBe(first)
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed read: the next call reads again and succeeds', async () => {
    const { blob, bytes, arrayBuffer } = makeBlob()
    arrayBuffer.mockRejectedValueOnce(new Error('gone'))

    await expect(demuxClip(blob)).rejects.toThrow('gone')
    await expect(demuxClip(blob)).resolves.toEqual(makeTrack())

    expect(arrayBuffer).toHaveBeenCalledTimes(2)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
    expect(demuxMp4Mock).toHaveBeenCalledWith(bytes)
  })

  it('does not cache a failed read for the container probe either', async () => {
    const { blob, arrayBuffer } = makeBlob()
    arrayBuffer.mockRejectedValueOnce(new Error('gone'))

    await expect(demuxClip(blob)).rejects.toThrow('gone')
    await expect(probeClipContainerTiming(blob)).resolves.toBe(OK_PROBE)

    expect(arrayBuffer).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed demux: the next call demuxes again and succeeds', async () => {
    const { blob, arrayBuffer } = makeBlob()
    demuxMp4Mock.mockRejectedValueOnce(new Error('malformed'))

    await expect(demuxClip(blob)).rejects.toThrow('malformed')
    await expect(demuxClip(blob)).resolves.toEqual(makeTrack())

    expect(demuxMp4Mock).toHaveBeenCalledTimes(2)
    expect(arrayBuffer).toHaveBeenCalledTimes(2)
    // The container probe the first attempt took is still good — the bytes did not change.
    await probeClipContainerTiming(blob)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
  })

  it('takes the container probe from the very buffer it demuxes, so the probe never reads again', async () => {
    const { blob, bytes, arrayBuffer } = makeBlob()

    await demuxClip(blob)
    await expect(probeClipContainerTiming(blob)).resolves.toBe(OK_PROBE)

    expect(arrayBuffer).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock.mock.calls[0][0]).toBe(bytes)
    expect(demuxMp4Mock.mock.calls[0][0]).toBe(bytes)
  })

  it('a container probe asked for while the demux is still reading shares that read', async () => {
    const { blob, arrayBuffer } = makeBlob()

    const demuxed = demuxClip(blob)
    const probed = probeClipContainerTiming(blob)
    await Promise.all([demuxed, probed])

    expect(arrayBuffer).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
  })

  it('parses the container only after the demux has settled and its callers have resumed', async () => {
    const { blob, bytes } = makeBlob()
    let finishDemux!: (track: DemuxedTrack) => void
    demuxMp4Mock.mockImplementationOnce(
      () => new Promise<DemuxedTrack>((resolve) => (finishDemux = resolve)),
    )

    const demuxed = demuxClip(blob)
    // Asked for mid-demux: shares the one read rather than starting its own.
    const probed = probeClipContainerTiming(blob)
    await vi.waitFor(() => expect(demuxMp4Mock).toHaveBeenCalledTimes(1))
    expect(probeContainerTimingMock).not.toHaveBeenCalled()

    finishDemux(makeTrack())
    await demuxed
    expect(probeContainerTimingMock).not.toHaveBeenCalled()

    await expect(probed).resolves.toBe(OK_PROBE)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock).toHaveBeenCalledWith(bytes)
    expect(blob.arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('reports the container probe on its own perf line, naming which read it came from', async () => {
    const seeded = makeBlob()
    const own = makeBlob()

    await demuxClip(seeded.blob)
    await probeClipContainerTiming(seeded.blob)
    await probeClipContainerTiming(own.blob)

    expect(logPerfTimingsMock).toHaveBeenCalledTimes(2)
    expect(logPerfTimingsMock).toHaveBeenCalledWith('container-probe', {
      bytes: 4,
      source: 'demux-read',
      containerProbeMs: expect.any(Number),
    })
    expect(logPerfTimingsMock).toHaveBeenCalledWith('container-probe', {
      bytes: 4,
      source: 'own-read',
      containerProbeMs: expect.any(Number),
    })
  })

  it('a demux released mid-flight that later rejects does not evict the newer entry', async () => {
    const { blob } = makeBlob()
    let failFirst!: (error: Error) => void
    demuxMp4Mock.mockImplementationOnce(
      () => new Promise<DemuxedTrack>((_resolve, reject) => (failFirst = reject)),
    )

    const first = demuxClip(blob)
    await vi.waitFor(() => expect(demuxMp4Mock).toHaveBeenCalledTimes(1))
    releaseClipDemux(blob)
    const second = await demuxClip(blob)

    failFirst(new Error('stale'))
    await expect(first).rejects.toThrow('stale')

    await expect(demuxClip(blob)).resolves.toBe(second)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(2)
  })

  it('release drops the track so the next demux reads afresh, while the container probe stays', async () => {
    const { blob, arrayBuffer } = makeBlob()

    const first = await demuxClip(blob)
    releaseClipDemux(blob)
    const second = await demuxClip(blob)
    await probeClipContainerTiming(blob)

    expect(second).not.toBe(first)
    expect(arrayBuffer).toHaveBeenCalledTimes(2)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(2)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
  })

  it('keeps independent clips independent', async () => {
    const a = makeBlob()
    const b = makeBlob()

    const trackA = await demuxClip(a.blob)
    const trackB = await demuxClip(b.blob)
    releaseClipDemux(a.blob)
    await demuxClip(b.blob)

    expect(trackB).not.toBe(trackA)
    expect(a.arrayBuffer).toHaveBeenCalledTimes(1)
    expect(b.arrayBuffer).toHaveBeenCalledTimes(1)
    expect(demuxMp4Mock).toHaveBeenCalledTimes(2)
  })

  it('reports every stage on the call that does the work, and only the wait on a cache hit', async () => {
    const { blob } = makeBlob()
    const miss: ClipDemuxTimings = {}
    const hit: ClipDemuxTimings = {}

    await demuxClip(blob, miss)
    await demuxClip(blob, hit)

    for (const stage of ['arrayBufferMs', 'demuxMs'] as const) {
      expect(miss[stage]).toBeGreaterThanOrEqual(0)
    }
    expect(hit.arrayBufferMs).toBe(0)
    expect(hit.demuxMs).toBeGreaterThanOrEqual(0)
  })
})

describe('borrowClipDemux (strides-6i6.4)', () => {
  it('shares the cached track while a sampling pass still holds it', async () => {
    const { blob, arrayBuffer } = makeBlob()
    const cached = await demuxClip(blob)
    expect(await borrowClipDemux(blob)).toBe(cached)
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('reads its own after releaseClipDemux, and does not put the entry back', async () => {
    const { blob, arrayBuffer } = makeBlob()
    await demuxClip(blob)
    releaseClipDemux(blob)

    const borrowed = await borrowClipDemux(blob)
    expect(arrayBuffer).toHaveBeenCalledTimes(2)
    // A later borrow reads AGAIN: the first one was never cached.
    expect(await borrowClipDemux(blob)).not.toBe(borrowed)
    expect(arrayBuffer).toHaveBeenCalledTimes(3)
    // And a sampling pass after the release demuxes afresh rather than receiving the borrowed one.
    expect(await demuxClip(blob)).not.toBe(borrowed)
    expect(arrayBuffer).toHaveBeenCalledTimes(4)
  })
})

describe('probeClipContainerTiming', () => {
  it('reads the clip itself when nothing demuxed it, and only once', async () => {
    const { blob, bytes, arrayBuffer } = makeBlob()

    await probeClipContainerTiming(blob)
    await probeClipContainerTiming(blob)

    expect(arrayBuffer).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock).toHaveBeenCalledWith(bytes)
    expect(demuxMp4Mock).not.toHaveBeenCalled()
  })

  it('is not re-taken by a later demux of the same clip', async () => {
    const { blob } = makeBlob()

    await probeClipContainerTiming(blob)
    await demuxClip(blob)

    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
  })
})

describe('against a real clip (no parse mocked)', () => {
  const PARK_APPROACH_PATH = join(process.cwd(), 'src/video/demo-clips/park-approach.mp4')

  function readAsArrayBuffer(): ArrayBuffer {
    const buffer = readFileSync(PARK_APPROACH_PATH)
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer
  }

  it('returns exactly what a fresh demux and a fresh container probe return', async () => {
    const actualDemux = await vi.importActual<typeof import('./mp4Demux')>('./mp4Demux')
    const actualTiming =
      await vi.importActual<typeof import('./containerTiming')>('./containerTiming')
    demuxMp4Mock.mockImplementation(actualDemux.demuxMp4)
    probeContainerTimingMock.mockImplementation(actualTiming.probeContainerTiming)

    const blob = new Blob([readAsArrayBuffer()], { type: 'video/mp4' })
    const cachedTrack = await demuxClip(blob)
    const cachedProbe = await probeClipContainerTiming(blob)

    const freshTrack = await actualDemux.demuxMp4(readAsArrayBuffer())
    const freshProbe = await actualTiming.probeContainerTiming(readAsArrayBuffer())

    expect(cachedTrack.samples).toHaveLength(99)
    // Sample bytes compared with Buffer.equals: a per-element deep equality over ~12 MB of
    // bitstream takes longer than the test timeout.
    const { samples: cachedSamples, ...cachedRest } = cachedTrack
    const { samples: freshSamples, ...freshRest } = freshTrack
    expect(cachedRest).toEqual(freshRest)
    const timingOf = ({ ptsSec, durationSec, isKeyframe }: DemuxedTrack['samples'][number]) => ({
      ptsSec,
      durationSec,
      isKeyframe,
    })
    expect(cachedSamples.map(timingOf)).toEqual(freshSamples.map(timingOf))
    cachedSamples.forEach((sample, i) => {
      expect(Buffer.from(sample.data).equals(Buffer.from(freshSamples[i].data))).toBe(true)
    })
    expect(cachedProbe.parseStatus).toBe('ok')
    expect(cachedProbe).toEqual(freshProbe)
  })
})
