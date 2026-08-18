import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ContainerTimingProbe,
  ContainerVideoTrackTiming,
} from './containerTiming'

const { probeContainerTimingMock, canUseSequentialDecodeMock, resolveConfigMock } =
  vi.hoisted(() => ({
    probeContainerTimingMock: vi.fn(),
    canUseSequentialDecodeMock: vi.fn(),
    resolveConfigMock: vi.fn(),
  }))

vi.mock('./containerTiming', () => ({ probeContainerTiming: probeContainerTimingMock }))
vi.mock('./webCodecsSupport', () => ({
  canUseSequentialDecode: canUseSequentialDecodeMock,
}))
vi.mock('../results/samplingRobustnessConfig', () => ({
  resolveSamplingRobustnessConfig: resolveConfigMock,
}))

import {
  editListSeekOffsetSeconds,
  resolveEvidenceSeekOffsetSeconds,
} from './evidenceSeekOffset'

function makeTrack(
  overrides: Partial<ContainerVideoTrackTiming> = {},
): ContainerVideoTrackTiming {
  return {
    trackId: 1,
    mediaTimescaleHz: 25,
    movieTimescaleHz: 25,
    nominalFps: 25,
    // The real Demo 1 (Pexels track) edit list, read off the file with a box walk: a two-frame
    // priming trim at unity rate.
    elst: [
      { segmentDuration: 228, mediaTime: 2, mediaRateInteger: 1, mediaRateFraction: 0 },
    ],
    stretchFactor: null,
    stretchFactorSource: null,
    ...overrides,
  }
}

function okProbe(track: ContainerVideoTrackTiming): ContainerTimingProbe {
  return { parseStatus: 'ok', videoTracks: [track] }
}

/** Bytes are irrelevant — `probeContainerTiming` is mocked in every case below. */
function makeBlob(): Blob {
  return new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'video/mp4' })
}

beforeEach(() => {
  probeContainerTimingMock.mockReset()
  canUseSequentialDecodeMock.mockReset()
  resolveConfigMock.mockReset()
  resolveConfigMock.mockReturnValue({ sequentialSampling: { enabled: true } })
  canUseSequentialDecodeMock.mockResolvedValue(true)
  probeContainerTimingMock.mockResolvedValue(okProbe(makeTrack()))
})

describe('editListSeekOffsetSeconds', () => {
  it('reads a single unity-rate trim as media_time / mediaTimescale', () => {
    // Demo 1: 2 / 25. The three test clips' measured +2-frame drift, from the container alone.
    expect(editListSeekOffsetSeconds(makeTrack())).toBeCloseTo(0.08, 10)
  })

  it('reads Demo 2 and the multiperson clip, whose media and movie timescales differ', () => {
    const demo2 = makeTrack({
      mediaTimescaleHz: 60000,
      movieTimescaleHz: 1000,
      elst: [
        { segmentDuration: 1652, mediaTime: 2002, mediaRateInteger: 1, mediaRateFraction: 0 },
      ],
    })
    expect(editListSeekOffsetSeconds(demo2)).toBeCloseTo(2002 / 60000, 12)

    const multiperson = makeTrack({
      mediaTimescaleHz: 15360,
      movieTimescaleHz: 1000,
      elst: [
        { segmentDuration: 3884, mediaTime: 512, mediaRateInteger: 1, mediaRateFraction: 0 },
      ],
    })
    expect(editListSeekOffsetSeconds(multiperson)).toBeCloseTo(512 / 15360, 12)
  })

  it('is zero when the track carries no edit list at all', () => {
    expect(editListSeekOffsetSeconds(makeTrack({ elst: [] }))).toBe(0)
  })

  it('is zero for a unity-rate edit list that starts at media time zero', () => {
    const track = makeTrack({
      elst: [
        { segmentDuration: 228, mediaTime: 0, mediaRateInteger: 1, mediaRateFraction: 0 },
      ],
    })
    expect(editListSeekOffsetSeconds(track)).toBe(0)
  })

  it('declines a multi-entry edit list — the map is piecewise, so one number cannot express it', () => {
    const track = makeTrack({
      elst: [
        { segmentDuration: 100, mediaTime: 2, mediaRateInteger: 1, mediaRateFraction: 0 },
        { segmentDuration: 100, mediaTime: 150, mediaRateInteger: 1, mediaRateFraction: 0 },
      ],
    })
    expect(editListSeekOffsetSeconds(track)).toBe(0)
  })

  it('declines an empty edit — presentation zero maps to no media time at all', () => {
    const track = makeTrack({
      elst: [
        { segmentDuration: 50, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
      ],
    })
    expect(editListSeekOffsetSeconds(track)).toBe(0)
  })

  it('declines a non-unity rate — that is a scale, not a shift', () => {
    // 0.5x, whose spec-correct fraction bits (0x8000) mp4box reads back as a NEGATIVE -32768.
    // Combining the halves the naive way would compute 0.5 here and wrongly accept it as unity-ish
    // on some inputs, so this pins the same unsigned reinterpretation `containerTiming.ts` uses.
    const track = makeTrack({
      elst: [
        { segmentDuration: 456, mediaTime: 2, mediaRateInteger: 0, mediaRateFraction: -32768 },
      ],
    })
    expect(editListSeekOffsetSeconds(track)).toBe(0)
  })

  it('declines a dwell edit (rate zero)', () => {
    const track = makeTrack({
      elst: [
        { segmentDuration: 10, mediaTime: 2, mediaRateInteger: 0, mediaRateFraction: 0 },
      ],
    })
    expect(editListSeekOffsetSeconds(track)).toBe(0)
  })

  it('declines a non-positive media timescale rather than dividing by it', () => {
    expect(editListSeekOffsetSeconds(makeTrack({ mediaTimescaleHz: 0 }))).toBe(0)
  })
})

describe('resolveEvidenceSeekOffsetSeconds', () => {
  it('negates the edit-list shift when the clip really did sample through WebCodecs', async () => {
    await expect(resolveEvidenceSeekOffsetSeconds(makeBlob())).resolves.toBeCloseTo(-0.08, 10)
  })

  it('is exactly zero when the sequential plane is switched off', async () => {
    resolveConfigMock.mockReturnValue({ sequentialSampling: { enabled: false } })

    await expect(resolveEvidenceSeekOffsetSeconds(makeBlob())).resolves.toBe(0)
    // The whole point of checking this first: nothing else is even consulted.
    expect(probeContainerTimingMock).not.toHaveBeenCalled()
    expect(canUseSequentialDecodeMock).not.toHaveBeenCalled()
  })

  it('is exactly zero when this clip could not have taken the sequential path', async () => {
    // A portrait phone capture (non-identity tkhd matrix) or an undecodable codec: the container
    // carries a real edit list, but the `<video>` path ran, so its timestamps are already correct.
    canUseSequentialDecodeMock.mockResolvedValue(false)

    await expect(resolveEvidenceSeekOffsetSeconds(makeBlob())).resolves.toBe(0)
  })

  it('is exactly zero for a container that does not parse — every WebM/webcam blob', async () => {
    probeContainerTimingMock.mockResolvedValue({
      parseStatus: 'parse-error',
      error: 'not an mp4',
      videoTracks: [],
    })

    await expect(resolveEvidenceSeekOffsetSeconds(makeBlob())).resolves.toBe(0)
  })

  it('is exactly zero for an MP4 that parses but has no video track', async () => {
    probeContainerTimingMock.mockResolvedValue({ parseStatus: 'ok', videoTracks: [] })

    await expect(resolveEvidenceSeekOffsetSeconds(makeBlob())).resolves.toBe(0)
  })

  it('never pays for a demux on a clip with no correction to make', async () => {
    probeContainerTimingMock.mockResolvedValue(okProbe(makeTrack({ elst: [] })))

    await expect(resolveEvidenceSeekOffsetSeconds(makeBlob())).resolves.toBe(0)
    expect(canUseSequentialDecodeMock).not.toHaveBeenCalled()
  })

  it('is zero, not a rejection, when the blob cannot be read', async () => {
    const blob = makeBlob()
    vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('gone'))

    await expect(resolveEvidenceSeekOffsetSeconds(blob)).resolves.toBe(0)
  })

  it('is zero for a null blob', async () => {
    await expect(resolveEvidenceSeekOffsetSeconds(null)).resolves.toBe(0)
  })

  it('derives once per clip — the gallery re-extracts mid-session when the scale pass grafts', async () => {
    const blob = makeBlob()

    await expect(resolveEvidenceSeekOffsetSeconds(blob)).resolves.toBeCloseTo(-0.08, 10)
    await expect(resolveEvidenceSeekOffsetSeconds(blob)).resolves.toBeCloseTo(-0.08, 10)

    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
    expect(canUseSequentialDecodeMock).toHaveBeenCalledTimes(1)
  })
})
