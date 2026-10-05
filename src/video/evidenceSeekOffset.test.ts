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
  frameMidpointOffsetSeconds,
  resolveEvidenceSeekCalibration,
} from './evidenceSeekOffset'
import { __resetForTests as resetClipBytesCache, demuxClip } from './clipBytesCache'

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
  resetClipBytesCache()
  probeContainerTimingMock.mockReset()
  canUseSequentialDecodeMock.mockReset()
  resolveConfigMock.mockReset()
  resolveConfigMock.mockReturnValue({ sequentialSampling: { enabled: true } })
  canUseSequentialDecodeMock.mockResolvedValue(true)
  probeContainerTimingMock.mockResolvedValue(okProbe(makeTrack()))
})

describe('editListSeekOffsetSeconds', () => {
  it('reads a single unity-rate shift as media_time / mediaTimescale', () => {
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

describe('frameMidpointOffsetSeconds', () => {
  it("is half a frame for the three bundled clips' declared rates", () => {
    // Read off the real containers with this repo's own box walk: side-landscape 15360/256,
    // side-portrait 15360/512, front-approach 60000/1001.
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: 60 }))).toBe(1 / 120)
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: 30 }))).toBe(1 / 60)
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: 60000 / 1001 }))).toBe(
      1001 / 120000,
    )
  })

  it('is zero when the container names no frame rate', () => {
    // `nominalFps` is null for a track with no usable `stts` — and zero here reproduces exactly
    // the seek that shipped before the midpoint existed.
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: null }))).toBe(0)
  })

  it('is zero rather than infinite or NaN for a rate that is not a positive finite number', () => {
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: 0 }))).toBe(0)
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: -30 }))).toBe(0)
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: Infinity }))).toBe(0)
    expect(frameMidpointOffsetSeconds(makeTrack({ nominalFps: Number.NaN }))).toBe(0)
  })
})

describe('resolveEvidenceSeekCalibration', () => {
  /** The three bundled clips' real container shapes, read off the files with a box walk. */
  const sideLandscape = makeTrack({
    mediaTimescaleHz: 15360,
    movieTimescaleHz: 1000,
    nominalFps: 60,
    elst: [
      { segmentDuration: 3884, mediaTime: 512, mediaRateInteger: 1, mediaRateFraction: 0 },
    ],
  })
  const sidePortrait = makeTrack({
    mediaTimescaleHz: 15360,
    movieTimescaleHz: 1000,
    nominalFps: 30,
    elst: [
      { segmentDuration: 12167, mediaTime: 1024, mediaRateInteger: 1, mediaRateFraction: 0 },
    ],
  })
  const frontApproach = makeTrack({
    mediaTimescaleHz: 60000,
    movieTimescaleHz: 1000,
    nominalFps: 60000 / 1001,
    elst: [
      { segmentDuration: 1652, mediaTime: 2002, mediaRateInteger: 1, mediaRateFraction: 0 },
    ],
  })

  it("reads both terms off side-landscape's own container", async () => {
    probeContainerTimingMock.mockResolvedValue(okProbe(sideLandscape))

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: -(512 / 15360),
      midpointOffsetSeconds: 1 / 120,
    })
  })

  it("reads both terms off side-portrait's own container", async () => {
    probeContainerTimingMock.mockResolvedValue(okProbe(sidePortrait))

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: -(1024 / 15360),
      midpointOffsetSeconds: 1 / 60,
    })
  })

  it("reads both terms off front-approach's own container", async () => {
    probeContainerTimingMock.mockResolvedValue(okProbe(frontApproach))

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: -(2002 / 60000),
      midpointOffsetSeconds: 1001 / 120000,
    })
  })

  it('negates the edit-list shift when the clip really did sample through WebCodecs', async () => {
    const { offsetSeconds } = await resolveEvidenceSeekCalibration(makeBlob())
    expect(offsetSeconds).toBeCloseTo(-0.08, 10)
  })

  it('still measures the midpoint when the sequential plane is switched off', async () => {
    // The two terms answer different questions: `sequentialSampling` decides which CLOCK a
    // timestamp is on, while the microsecond lattice is a property of the seek API that this clip
    // meets on either sampler. Zeroing both here is what would leave the playback path seeking
    // frame boundaries for no reason.
    resolveConfigMock.mockReturnValue({ sequentialSampling: { enabled: false } })
    probeContainerTimingMock.mockResolvedValue(okProbe(sideLandscape))

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 1 / 120,
    })
    expect(canUseSequentialDecodeMock).not.toHaveBeenCalled()
  })

  it('still measures the midpoint when this clip could not have taken the sequential path', async () => {
    // A portrait phone capture (non-identity tkhd matrix) or an undecodable codec: the container
    // carries a real edit list, but the `<video>` path ran, so its timestamps are already correct.
    canUseSequentialDecodeMock.mockResolvedValue(false)
    probeContainerTimingMock.mockResolvedValue(okProbe(sideLandscape))

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 1 / 120,
    })
  })

  it('still measures the midpoint for a track carrying no edit list at all', async () => {
    probeContainerTimingMock.mockResolvedValue(
      okProbe(makeTrack({ nominalFps: 60, elst: [] })),
    )

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 1 / 120,
    })
    // The expensive gate stays unreachable on a clip with no shift to correct.
    expect(canUseSequentialDecodeMock).not.toHaveBeenCalled()
  })

  it('is zero on both terms for a container that does not parse — every WebM/webcam blob', async () => {
    probeContainerTimingMock.mockResolvedValue({
      parseStatus: 'parse-error',
      error: 'not an mp4',
      videoTracks: [],
    })

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 0,
    })
  })

  it('is zero on both terms for an unrecognised container', async () => {
    probeContainerTimingMock.mockResolvedValue({
      parseStatus: 'unsupported-container',
      videoTracks: [],
    })

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 0,
    })
  })

  it('is zero on both terms for an MP4 that parses but has no video track', async () => {
    probeContainerTimingMock.mockResolvedValue({ parseStatus: 'ok', videoTracks: [] })

    await expect(resolveEvidenceSeekCalibration(makeBlob())).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 0,
    })
  })

  it('is zero on both terms, not a rejection, when the blob cannot be read', async () => {
    const blob = makeBlob()
    vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('gone'))

    await expect(resolveEvidenceSeekCalibration(blob)).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 0,
    })
  })

  it('is zero on both terms for a null blob', async () => {
    await expect(resolveEvidenceSeekCalibration(null)).resolves.toEqual({
      offsetSeconds: 0,
      midpointOffsetSeconds: 0,
    })
  })

  it('derives once per clip — evidence re-extracts mid-session when the scale pass grafts', async () => {
    const blob = makeBlob()

    const first = await resolveEvidenceSeekCalibration(blob)
    const second = await resolveEvidenceSeekCalibration(blob)
    expect(second).toEqual(first)

    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
    expect(canUseSequentialDecodeMock).toHaveBeenCalledTimes(1)
  })

  it("reads nothing when the analysis run's demux already probed the container (strides-dt9)", async () => {
    const blob = makeBlob()
    const readSpy = vi.spyOn(blob, 'arrayBuffer')
    // The real demux rejects these four bytes; the container probe it seeded first still stands.
    await demuxClip(blob).catch(() => {})
    expect(readSpy).toHaveBeenCalledTimes(1)

    await expect(resolveEvidenceSeekCalibration(blob)).resolves.toEqual({
      offsetSeconds: -0.08,
      midpointOffsetSeconds: 1 / 50,
    })
    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(probeContainerTimingMock).toHaveBeenCalledTimes(1)
  })
})
