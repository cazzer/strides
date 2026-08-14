import { describe, expect, it } from 'vitest'
import { probeContainerTiming } from './containerTiming'
import { buildNormalFpsFixture } from './__fixtures__/normalFps'
import { buildHighFpsNoElstFixture } from './__fixtures__/highFpsNoElst'
import { buildHighFpsUnityRateElstNoStretchFixture } from './__fixtures__/highFpsUnityRateElstNoStretch'
import { buildHighFpsStretchingElstDirectRateFixture } from './__fixtures__/highFpsStretchingElstDirectRate'
import { buildHighFpsStretchingElstDurationRatioFixture } from './__fixtures__/highFpsStretchingElstDurationRatio'
import { buildHighFpsStretchingElstFfmpegShapeFixture } from './__fixtures__/highFpsStretchingElstFfmpegShape'
import { buildEmptyBuffer, buildGarbageBytes } from './__fixtures__/nonMp4Bytes'

describe('probeContainerTiming', () => {
  it('reads nominal fps and finds no edit list for a normal 30fps clip', async () => {
    const probe = await probeContainerTiming(buildNormalFpsFixture())

    expect(probe.parseStatus).toBe('ok')
    expect(probe.videoTracks).toHaveLength(1)
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(30, 5)
    expect(track.mediaTimescaleHz).toBe(3000)
    expect(track.movieTimescaleHz).toBe(1000)
    expect(track.elst).toEqual([])
    expect(track.stretchFactor).toBeNull()
    expect(track.stretchFactorSource).toBeNull()
  })

  it('reads a high nominal fps with no edit list', async () => {
    const probe = await probeContainerTiming(buildHighFpsNoElstFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(120, 5)
    expect(track.elst).toEqual([])
    expect(track.stretchFactor).toBeNull()
  })

  it('reads a unity-rate edit list and computes a ~1.0 (no-stretch) duration ratio', async () => {
    const probe = await probeContainerTiming(buildHighFpsUnityRateElstNoStretchFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(120, 5)
    expect(track.elst).toHaveLength(1)
    expect(track.elst[0]).toEqual({
      segmentDuration: 2000,
      mediaTime: 200,
      mediaRateInteger: 1,
      mediaRateFraction: 0,
    })
    expect(track.stretchFactorSource).toBe('duration-ratio')
    expect(track.stretchFactor).toBeCloseTo(1.0, 2)
  })

  it('prefers a direct, explicit non-unity media_rate over the duration-ratio computation', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstDirectRateFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(120, 5)
    expect(track.stretchFactorSource).toBe('direct-rate')
    expect(track.stretchFactor).toBeCloseTo(4.0, 5) // 1 / 0.25
  })

  it('falls back to the duration-ratio path when the edit list is unity-rate but the duration is stretched', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstDurationRatioFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(120, 5)
    expect(track.stretchFactorSource).toBe('duration-ratio')
    expect(track.stretchFactor).toBeCloseTo(2.0, 2)
  })

  it('reads the ffmpeg -itsscale shape as internally self-consistent -- no residual stretch signal', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstFfmpegShapeFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    // The rewritten stts now reads the already-slowed rate directly -- not the pre-rescale
    // native 120fps. This is the empirical finding, not a parser bug: see this file's fixture
    // module doc.
    expect(track.nominalFps).toBeCloseTo(15, 5)
    expect(track.stretchFactorSource).toBe('duration-ratio')
    expect(track.stretchFactor).toBeCloseTo(1.0, 2)
  })

  it('fails closed with unsupported-container on non-MP4 bytes, without throwing', async () => {
    const probe = await probeContainerTiming(buildGarbageBytes())

    expect(probe.parseStatus).toBe('unsupported-container')
    expect(probe.videoTracks).toEqual([])
  })

  it('fails closed with unsupported-container on an empty buffer, without throwing', async () => {
    const probe = await probeContainerTiming(buildEmptyBuffer())

    expect(probe.parseStatus).toBe('unsupported-container')
    expect(probe.videoTracks).toEqual([])
  })
})
