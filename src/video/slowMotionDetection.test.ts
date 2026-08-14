import { describe, expect, it } from 'vitest'
import { probeContainerTiming } from './containerTiming'
import type { ContainerTimingProbe } from './containerTiming'
import { DEFAULT_SLOW_MOTION_DETECTION_CONFIG, detectSlowMotion } from './slowMotionDetection'
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

describe('detectSlowMotion -- against real parsed fixtures', () => {
  it('does not detect a normal 30fps clip', async () => {
    const probe = await probeContainerTiming(buildNormalFpsFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
  })

  it('does not detect legitimate high-fps capture with no edit list', async () => {
    const probe = await probeContainerTiming(buildHighFpsNoElstFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/no edit list/)
  })

  it('does not detect an ordinary trim (unity-rate edit list, no stretch) -- the "elst presence alone" trap', async () => {
    const probe = await probeContainerTiming(buildHighFpsUnityRateElstNoStretchFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/ordinary trim/)
  })

  it('detects with high confidence when the edit list declares a non-unity rate directly', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstDirectRateFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(true)
    expect(result.confidence).toBe('high')
    expect(result.stretchFactorSource).toBe('direct-rate')
    expect(result.stretchFactor).toBeCloseTo(2.0, 5) // 1 / 0.5
  })

  it('does NOT detect a real 1.5x FAST-playback direct rate as slow-motion -- regression for the elstEntryRate sign bug', async () => {
    const probe = await probeContainerTiming(buildHighFpsFastPlaybackDirectRateFixture())
    const result = detectSlowMotion(probe)

    // Before the fix: mediaRateInteger=1, mediaRateFraction=-32768 (the real on-wire encoding of
    // 1.5x) was misread as rate 0.5 (indistinguishable from an ACTUAL 0.5x slowdown), which drove
    // stretchFactor=2 and reported detected:true, confidence:'high' on a clip playing FASTER than
    // native, not slower -- a real false positive at the top confidence tier. After the fix, the
    // rate reads correctly as 1.5, stretchFactor ~0.667, well under the 1.5 threshold.
    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.stretchFactorSource).toBe('direct-rate')
    expect(result.stretchFactor).toBeCloseTo(1 / 1.5, 5)
    expect(result.reason).toMatch(/ordinary trim/)
  })

  it('detects with medium confidence when the stretch is only inferable from the duration ratio', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstDurationRatioFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(true)
    expect(result.confidence).toBe('medium')
    expect(result.stretchFactorSource).toBe('duration-ratio')
    expect(result.stretchFactor).toBeCloseTo(2.0, 2)
  })

  it('does not detect the REAL measured ffmpeg -itsscale shape -- the rewritten stts erases the fps signal', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstFfmpegShapeFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    // Fails on signal 1 -- nominal fps reads the already-slowed ~7.49fps (the real measured
    // value, not an idealized one; see containerTiming.test.ts for the exact figure), not signal
    // 2.
    expect(result.nominalFps).toBeCloseTo(7.492507492507492, 9)
    expect(result.reason).toMatch(/native-capture-rate threshold/)
  })

  it('fails closed (unsupported-container) without throwing', async () => {
    const probe = await probeContainerTiming(buildGarbageBytes())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/unsupported-container/)
  })

  it('fails closed on an empty buffer without throwing', async () => {
    const probe = await probeContainerTiming(buildEmptyBuffer())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
  })

  it('fails closed on a truncated-but-otherwise-valid MP4', async () => {
    const probe = await probeContainerTiming(buildTruncatedMp4())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/unsupported-container/)
  })

  it('fails closed on a structurally-broken moov', async () => {
    const probe = await probeContainerTiming(buildCorruptedMoovMp4())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/unsupported-container/)
  })

  it('fails closed on a real WebM file -- lands on parse-error, not unsupported-container, but still fails closed', async () => {
    const probe = await probeContainerTiming(buildWebmBytes())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/parse-error/)
  })
})

describe('detectSlowMotion -- against directly-constructed probes (policy edge cases)', () => {
  it('fails closed on a parse-error probe', () => {
    const probe: ContainerTimingProbe = { parseStatus: 'parse-error', error: 'boom', videoTracks: [] }

    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/parse-error/)
  })

  it('does not detect a video-track-less (e.g. audio-only) file', () => {
    const probe: ContainerTimingProbe = { parseStatus: 'ok', videoTracks: [] }

    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    expect(result.reason).toMatch(/no video track/)
  })

  it('respects a custom config threshold', () => {
    const probe: ContainerTimingProbe = {
      parseStatus: 'ok',
      videoTracks: [
        {
          trackId: 1,
          mediaTimescaleHz: 12000,
          movieTimescaleHz: 1000,
          nominalFps: 90, // below the DEFAULT 100 threshold
          elst: [{ segmentDuration: 4000, mediaTime: 0, mediaRateInteger: 0, mediaRateFraction: 32768 }],
          stretchFactor: 2,
          stretchFactorSource: 'direct-rate',
        },
      ],
    }

    expect(detectSlowMotion(probe).detected).toBe(false)
    expect(detectSlowMotion(probe, { ...DEFAULT_SLOW_MOTION_DETECTION_CONFIG, minNativeFps: 80 }).detected).toBe(
      true,
    )
  })
})
