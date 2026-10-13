import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContainerTimingProbe, ContainerVideoTrackTiming } from './containerTiming'
import type { DemuxedTrack } from './mp4Demux'
import { containerColorSpace } from './mp4Demux'

/**
 * `openDecodedFrameSource`'s gates: every way a clip is kept on the seek path before any decoder
 * opens. The collaborators that answer them are mocked so each gate is driven on its own.
 */

const { canUseMock, probeMock, borrowMock, samplingMock } = vi.hoisted(() => ({
  canUseMock: vi.fn(),
  probeMock: vi.fn(),
  borrowMock: vi.fn(),
  samplingMock: vi.fn(),
}))

vi.mock('./webCodecsSupport', () => ({ canUseSequentialDecode: canUseMock }))
vi.mock('./clipBytesCache', () => ({
  probeClipContainerTiming: probeMock,
  borrowClipDemux: borrowMock,
}))
vi.mock('../results/samplingRobustnessConfig', () => ({
  resolveSamplingRobustnessConfig: samplingMock,
}))

import { openDecodedFrameSource } from './decodedFrames'

const TIMING: ContainerVideoTrackTiming = {
  trackId: 1,
  mediaTimescaleHz: 15360,
  movieTimescaleHz: 1000,
  nominalFps: 60,
  elst: [{ segmentDuration: 50, mediaTime: 512, mediaRateInteger: 1, mediaRateFraction: 0 }],
  stretchFactor: null,
  stretchFactorSource: null,
} as ContainerVideoTrackTiming

function probe(timing: ContainerVideoTrackTiming = TIMING): ContainerTimingProbe {
  return { parseStatus: 'ok', videoTracks: [timing] } as ContainerTimingProbe
}

function track(overrides: Partial<DemuxedTrack> = {}): DemuxedTrack {
  return {
    codec: 'avc1.640034',
    description: undefined,
    width: 64,
    height: 32,
    fps: 60,
    durationSec: 3 * (256 / 15360),
    matrix: [],
    samples: [0, 1, 2].map((index) => ({
      data: new Uint8Array(),
      ptsSec: (512 + 256 * index) / 15360,
      durationSec: 256 / 15360,
      isKeyframe: index === 0,
    })),
    colorSpace: { kind: 'absent' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('VideoDecoder', class {})
  canUseMock.mockReset().mockResolvedValue(true)
  probeMock.mockReset().mockResolvedValue(probe())
  borrowMock.mockReset().mockResolvedValue(track())
  samplingMock.mockReset().mockReturnValue({ sequentialSampling: { enabled: true } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.__STRIDES_FORWARD_DECODE_CONFIG_OVERRIDE__
})

const blob = () => new Blob(['x'])

describe('openDecodedFrameSource', () => {
  it('opens a clip every gate admits, on a timeline starting at zero', async () => {
    const source = await openDecodedFrameSource(blob())
    expect(source?.timeline.startsUs[0]).toBe(0)
    expect(source?.timeline.keysUs).toHaveLength(3)
  })

  it('stays on the seek path when forward decoding is switched off, asking nothing', async () => {
    window.__STRIDES_FORWARD_DECODE_CONFIG_OVERRIDE__ = { enabled: false }
    expect(await openDecodedFrameSource(blob())).toBeNull()
    expect(canUseMock).not.toHaveBeenCalled()
  })

  it('stays on the seek path when the sequential sampler is disabled, without probing the clip', async () => {
    samplingMock.mockReturnValue({ sequentialSampling: { enabled: false } })
    expect(await openDecodedFrameSource(blob())).toBeNull()
    expect(canUseMock).not.toHaveBeenCalled()
    expect(borrowMock).not.toHaveBeenCalled()
  })

  it('stays on the seek path when canUseSequentialDecode says no', async () => {
    canUseMock.mockResolvedValue(false)
    expect(await openDecodedFrameSource(blob())).toBeNull()
    expect(borrowMock).not.toHaveBeenCalled()
  })

  it('stays on the seek path for an edit list that is not one plain shift', async () => {
    const entry = TIMING.elst[0]
    probeMock.mockResolvedValue(probe({ ...TIMING, elst: [entry, entry] }))
    expect(await openDecodedFrameSource(blob())).toBeNull()
    probeMock.mockResolvedValue(probe({ ...TIMING, elst: [{ ...entry, mediaRateInteger: 2 }] }))
    expect(await openDecodedFrameSource(blob())).toBeNull()
  })

  it('stays on the seek path when the shift leaves a frame presenting before zero (trimmed pre-roll)', async () => {
    const entry = TIMING.elst[0]
    probeMock.mockResolvedValue(probe({ ...TIMING, elst: [{ ...entry, mediaTime: 768 }] }))
    expect(await openDecodedFrameSource(blob())).toBeNull()
  })

  it('stays on the seek path for a colour declaration it cannot pass verbatim', async () => {
    borrowMock.mockResolvedValue(track({ colorSpace: { kind: 'unsupported' } }))
    expect(await openDecodedFrameSource(blob())).toBeNull()
  })

  it('stays on the seek path without a VideoDecoder, and never rejects', async () => {
    vi.unstubAllGlobals()
    expect(await openDecodedFrameSource(blob())).toBeNull()
    vi.stubGlobal('VideoDecoder', class {})
    borrowMock.mockRejectedValue(new Error('unreadable'))
    expect(await openDecodedFrameSource(blob())).toBeNull()
  })
})

describe('containerColorSpace', () => {
  it('passes an nclx declaration through under the WebCodecs names', () => {
    expect(
      containerColorSpace({
        colour_type: 'nclx',
        colour_primaries: 9,
        transfer_characteristics: 18,
        matrix_coefficients: 9,
        full_range_flag: 0,
      }),
    ).toEqual({
      kind: 'nclx',
      init: { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false },
    })
  })

  it('leaves an unspecified member unset rather than guessing it', () => {
    expect(
      containerColorSpace({
        colour_type: 'nclx',
        colour_primaries: 1,
        transfer_characteristics: 2,
        matrix_coefficients: 1,
        full_range_flag: 1,
      }),
    ).toEqual({ kind: 'nclx', init: { primaries: 'bt709', matrix: 'bt709', fullRange: true } })
  })

  it('refuses what WebCodecs cannot name, and anything that is not nclx', () => {
    expect(containerColorSpace({ colour_type: 'nclx', colour_primaries: 22 })).toEqual({
      kind: 'unsupported',
    })
    expect(containerColorSpace({ colour_type: 'nclc' })).toEqual({ kind: 'unsupported' })
    expect(containerColorSpace({ colour_type: 'prof' })).toEqual({ kind: 'unsupported' })
    expect(containerColorSpace(undefined)).toEqual({ kind: 'absent' })
  })
})
