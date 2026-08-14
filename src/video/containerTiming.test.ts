import { describe, expect, it } from 'vitest'
import { probeContainerTiming } from './containerTiming'
import { buildNormalFpsFixture } from './__fixtures__/normalFps'
import { buildHighFpsNoElstFixture } from './__fixtures__/highFpsNoElst'
import { buildHighFpsUnityRateElstNoStretchFixture } from './__fixtures__/highFpsUnityRateElstNoStretch'
import { buildHighFpsStretchingElstDirectRateFixture } from './__fixtures__/highFpsStretchingElstDirectRate'
import { buildHighFpsFastPlaybackDirectRateFixture } from './__fixtures__/highFpsFastPlaybackDirectRate'
import { buildHighFpsStretchingElstDurationRatioFixture } from './__fixtures__/highFpsStretchingElstDurationRatio'
import { buildHighFpsStretchingElstFfmpegShapeFixture } from './__fixtures__/highFpsStretchingElstFfmpegShape'
import { buildEmptyBuffer, buildGarbageBytes } from './__fixtures__/nonMp4Bytes'
import { buildWebmBytes } from './__fixtures__/webmBytes'
import { buildCorruptedMoovMp4, buildTruncatedMp4 } from './__fixtures__/corruptedMp4'

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
    // Fixture encodes 0.5x via the REAL on-wire signed representation (mediaRateFraction: -32768,
    // i.e. 0x8000 read as signed int16) -- this is the regression coverage for the elstEntryRate
    // sign bug review round 1 found: naively summing the signed halves would have computed -0.5
    // here, not 0.5.
    expect(track.elst[0].mediaRateInteger).toBe(0)
    expect(track.elst[0].mediaRateFraction).toBe(-32768)
    expect(track.stretchFactorSource).toBe('direct-rate')
    expect(track.stretchFactor).toBeCloseTo(2.0, 5) // 1 / 0.5
  })

  it('correctly reads a fast-playback (1.5x) direct rate as > 1, not as a false slow-motion signal', async () => {
    const probe = await probeContainerTiming(buildHighFpsFastPlaybackDirectRateFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(120, 5)
    // mediaRateInteger: 1, mediaRateFraction: -32768 (0x8000 signed) must read as 1.5, not 0.5 --
    // this is exactly the case that was silently backwards before the elstEntryRate fix.
    expect(track.stretchFactorSource).toBe('direct-rate')
    expect(track.stretchFactor).toBeCloseTo(1 / 1.5, 5) // < 1: presented FASTER than native
    expect(track.stretchFactor).toBeLessThan(1)
  })

  it('falls back to the duration-ratio path when the edit list is unity-rate but the duration is stretched', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstDurationRatioFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]
    expect(track.nominalFps).toBeCloseTo(120, 5)
    expect(track.stretchFactorSource).toBe('duration-ratio')
    expect(track.stretchFactor).toBeCloseTo(2.0, 2)
  })

  it('reads the REAL measured ffmpeg -itsscale shape (multi-run stts, straggler sample included) as internally self-consistent -- no residual stretch signal', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstFfmpegShapeFixture())

    expect(probe.parseStatus).toBe('ok')
    const track = probe.videoTracks[0]

    // Exact values measured live against the real park-approach.mp4 demo clip after
    // `ffmpeg -itsscale 8` -- see this worktree's CLAUDE.md write-up. The rewritten stts now
    // reads the already-slowed rate directly -- not the pre-rescale native 120fps. This is the
    // empirical finding, not a parser bug.
    expect(track.nominalFps).toBeCloseTo(7.492507492507492, 9)
    expect(track.stretchFactorSource).toBe('duration-ratio')
    expect(track.stretchFactor).toBeCloseTo(1.0000445414458152, 9)

    // The weighted MEDIAN (what nominalFps actually uses) is anchored to the DOMINANT run (98
    // samples @ 8008 ticks) and correctly discounts the single 1001-tick straggler sample. A
    // naive sample-count-weighted MEAN over the same two runs would be pulled meaningfully higher
    // by that one fast outlier -- worth asserting the two disagree, not just that the median is
    // "some" value.
    const totalTicks = 98 * 8008 + 1 * 1001
    const totalSamples = 98 + 1
    const naiveMeanDeltaTicks = totalTicks / totalSamples
    const naiveMeanFps = 60000 / naiveMeanDeltaTicks
    expect(naiveMeanFps).toBeCloseTo(7.5593196612, 9) // ~7.56fps -- distinctly above the median's ~7.49
    expect(track.nominalFps).toBeLessThan(naiveMeanFps)
    expect(naiveMeanFps - (track.nominalFps ?? 0)).toBeGreaterThan(0.05)
  })

  it('fails closed with unsupported-container on non-MP4 bytes, without throwing', async () => {
    const probe = await probeContainerTiming(buildGarbageBytes())

    expect(probe.parseStatus).toBe('unsupported-container')
    expect(probe.videoTracks).toEqual([])
    expect(probe.error).toBeUndefined()
  })

  it('fails closed with unsupported-container on an empty buffer, without throwing', async () => {
    const probe = await probeContainerTiming(buildEmptyBuffer())

    expect(probe.parseStatus).toBe('unsupported-container')
    expect(probe.videoTracks).toEqual([])
    expect(probe.error).toBeUndefined()
  })

  it('fails closed with unsupported-container (no error) on a truncated-but-otherwise-valid MP4', async () => {
    const probe = await probeContainerTiming(buildTruncatedMp4())

    expect(probe.parseStatus).toBe('unsupported-container')
    expect(probe.videoTracks).toEqual([])
    expect(probe.error).toBeUndefined()
  })

  it('fails closed with unsupported-container (WITH an error) on a structurally-broken moov', async () => {
    const probe = await probeContainerTiming(buildCorruptedMoovMp4())

    expect(probe.parseStatus).toBe('unsupported-container')
    expect(probe.videoTracks).toEqual([])
    expect(probe.error).toBeDefined()
  })

  it('fails closed with parse-error (WITH an error) on a real WebM file -- NOT unsupported-container', async () => {
    const probe = await probeContainerTiming(buildWebmBytes())

    // This is the counter-intuitive direction: mp4box actively misparses and rejects WebM's EBML
    // header via its own onError, landing here rather than on 'unsupported-container'. See
    // probeContainerTiming's module doc for the full verified status-mapping table -- an earlier
    // draft of that doc had this backwards.
    expect(probe.parseStatus).toBe('parse-error')
    expect(probe.videoTracks).toEqual([])
    expect(probe.error).toBeDefined()
  })
})
