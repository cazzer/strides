import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITY_TKHD_MATRIX } from './mp4Demux'
import type { DemuxedTrack } from './mp4Demux'

const { demuxMp4Mock } = vi.hoisted(() => ({ demuxMp4Mock: vi.fn() }))

// `isIdentityMatrix` stays the REAL implementation (spread from the actual module) -- only
// `demuxMp4` itself is mocked, so this file tests `canUseSequentialDecode`'s own gating logic
// against controlled `DemuxedTrack` fixtures without needing a real MP4 parse for every case.
vi.mock('./mp4Demux', async () => {
  const actual = await vi.importActual<typeof import('./mp4Demux')>('./mp4Demux')
  return { ...actual, demuxMp4: demuxMp4Mock }
})

import { __resetForTests as resetClipBytesCache, demuxClip } from './clipBytesCache'
import { __resetForTests as resetSequentialDecodeAnswers, canUseSequentialDecode } from './webCodecsSupport'
import type { SequentialDecodeProbeTimings } from './webCodecsSupport'

function makeTrack(overrides: Partial<DemuxedTrack> = {}): DemuxedTrack {
  return {
    codec: 'avc1.640034',
    description: new Uint8Array([1, 2, 3]),
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 2,
    matrix: IDENTITY_TKHD_MATRIX,
    samples: [],
    ...overrides,
  }
}

// A blob whose `.type` alone satisfies `looksLikeIsoBmff`'s cheap check -- its actual bytes are
// irrelevant here since `demuxMp4` itself is mocked in every test below.
function makeMp4Blob(): Blob {
  return new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'video/mp4' })
}

const isConfigSupportedMock = vi.fn()

beforeEach(() => {
  resetClipBytesCache()
  resetSequentialDecodeAnswers()
  demuxMp4Mock.mockReset()
  isConfigSupportedMock.mockReset()
  isConfigSupportedMock.mockResolvedValue({ supported: true })
  vi.stubGlobal('VideoDecoder', { isConfigSupported: isConfigSupportedMock })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('canUseSequentialDecode', () => {
  it('rejects when VideoDecoder does not exist in this browser', async () => {
    vi.unstubAllGlobals() // undo the beforeEach stub for this one case
    expect(typeof VideoDecoder).toBe('undefined')

    await expect(canUseSequentialDecode(makeMp4Blob())).resolves.toBe(false)
    expect(demuxMp4Mock).not.toHaveBeenCalled()
  })

  it('rejects when there is no blob to sample from', async () => {
    await expect(canUseSequentialDecode(null)).resolves.toBe(false)
    expect(demuxMp4Mock).not.toHaveBeenCalled()
  })

  it('rejects a blob over the size cap without ever reading its bytes', async () => {
    // Real bytes aren't needed -- `.size` alone drives the gate, checked before anything reads
    // the blob's contents (memory-cost item from the repair round's review).
    const oversized = makeMp4Blob()
    Object.defineProperty(oversized, 'size', { value: 300 * 1024 * 1024 })

    await expect(canUseSequentialDecode(oversized)).resolves.toBe(false)
    expect(demuxMp4Mock).not.toHaveBeenCalled()
  })

  it('rejects a blob that does not look like ISO-BMFF at all, without ever demuxing it', async () => {
    const notMp4 = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], {
      type: 'video/webm',
    })

    await expect(canUseSequentialDecode(notMp4)).resolves.toBe(false)
    expect(demuxMp4Mock).not.toHaveBeenCalled()
  })

  it('rejects when demuxMp4 rejects', async () => {
    demuxMp4Mock.mockRejectedValue(new Error('malformed'))

    await expect(canUseSequentialDecode(makeMp4Blob())).resolves.toBe(false)
  })

  it('rejects a track whose tkhd carries a non-identity (rotated) matrix', async () => {
    // Must-fix from the repair round: a portrait-phone-capture matrix (coded landscape + a
    // baked-in 90-degree rotation) must never reach the sequential-decode path, since
    // VideoDecoder emits raw coded frames with no rotation applied -- unlike a <video> element,
    // which the playback path falls back to correctly handles.
    demuxMp4Mock.mockResolvedValue(
      makeTrack({ matrix: [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000] }),
    )

    await expect(canUseSequentialDecode(makeMp4Blob())).resolves.toBe(false)
    // Fails fast on the matrix check -- never even asks whether the codec is decodable.
    expect(isConfigSupportedMock).not.toHaveBeenCalled()
  })

  it('accepts a track with the identity matrix and a decodable codec', async () => {
    demuxMp4Mock.mockResolvedValue(makeTrack({ matrix: IDENTITY_TKHD_MATRIX }))

    await expect(canUseSequentialDecode(makeMp4Blob())).resolves.toBe(true)
    expect(isConfigSupportedMock).toHaveBeenCalledWith(
      expect.objectContaining({ codec: 'avc1.640034', codedWidth: 1920, codedHeight: 1080 }),
    )
  })

  it('rejects when VideoDecoder.isConfigSupported says the codec is not decodable here', async () => {
    demuxMp4Mock.mockResolvedValue(makeTrack())
    isConfigSupportedMock.mockResolvedValue({ supported: false })

    await expect(canUseSequentialDecode(makeMp4Blob())).resolves.toBe(false)
  })

  describe('answering once per clip (strides-dt9)', () => {
    it('answers a repeated question about the same blob without demuxing it again', async () => {
      demuxMp4Mock.mockResolvedValue(makeTrack())
      const blob = makeMp4Blob()

      await expect(canUseSequentialDecode(blob)).resolves.toBe(true)
      await expect(canUseSequentialDecode(blob)).resolves.toBe(true)

      expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
      expect(isConfigSupportedMock).toHaveBeenCalledTimes(1)
    })

    it('shares one answer between concurrent callers', async () => {
      demuxMp4Mock.mockResolvedValue(makeTrack())
      const blob = makeMp4Blob()

      const answers = await Promise.all([canUseSequentialDecode(blob), canUseSequentialDecode(blob)])

      expect(answers).toEqual([true, true])
      expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
    })

    it('memoises a false answer too, without demuxing again', async () => {
      demuxMp4Mock.mockRejectedValue(new Error('malformed'))
      const blob = makeMp4Blob()

      await expect(canUseSequentialDecode(blob)).resolves.toBe(false)
      await expect(canUseSequentialDecode(blob)).resolves.toBe(false)

      expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
    })

    it('leaves a usable track cached for the samplers when the answer is yes', async () => {
      const track = makeTrack()
      demuxMp4Mock.mockResolvedValue(track)
      const blob = makeMp4Blob()

      await canUseSequentialDecode(blob)

      await expect(demuxClip(blob)).resolves.toBe(track)
      expect(demuxMp4Mock).toHaveBeenCalledTimes(1)
    })

    it('releases the demuxed track when the answer is no — no sequential pass will want it', async () => {
      demuxMp4Mock.mockResolvedValue(makeTrack())
      isConfigSupportedMock.mockResolvedValue({ supported: false })
      const blob = makeMp4Blob()

      await expect(canUseSequentialDecode(blob)).resolves.toBe(false)
      await demuxClip(blob)

      expect(demuxMp4Mock).toHaveBeenCalledTimes(2)
    })

    it('reports a memoised answer as a near-zero wait rather than omitting the stages', async () => {
      demuxMp4Mock.mockResolvedValue(makeTrack())
      const blob = makeMp4Blob()
      const first: SequentialDecodeProbeTimings = {}
      const second: SequentialDecodeProbeTimings = {}

      await canUseSequentialDecode(blob, first)
      await canUseSequentialDecode(blob, second)

      expect(first.arrayBufferMs).toBeGreaterThanOrEqual(0)
      expect(first.demuxMs).toBeGreaterThanOrEqual(0)
      expect(first.isConfigSupportedMs).toBeGreaterThanOrEqual(0)
      expect(second).toEqual({
        arrayBufferMs: 0,
        containerProbeMs: 0,
        demuxMs: expect.any(Number),
        isConfigSupportedMs: 0,
      })
    })
  })
})
