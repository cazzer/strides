import { describe, expect, it } from 'vitest'
import { probeContainerTiming } from './containerTiming'
import type { ContainerTimingProbe } from './containerTiming'
import { DEFAULT_SLOW_MOTION_DETECTION_CONFIG, detectSlowMotion } from './slowMotionDetection'
import { buildNormalFpsFixture } from './__fixtures__/normalFps'
import { buildHighFpsNoElstFixture } from './__fixtures__/highFpsNoElst'
import { buildHighFpsUnityRateElstNoStretchFixture } from './__fixtures__/highFpsUnityRateElstNoStretch'
import { buildHighFpsStretchingElstDirectRateFixture } from './__fixtures__/highFpsStretchingElstDirectRate'
import { buildHighFpsStretchingElstDurationRatioFixture } from './__fixtures__/highFpsStretchingElstDurationRatio'
import { buildHighFpsStretchingElstFfmpegShapeFixture } from './__fixtures__/highFpsStretchingElstFfmpegShape'
import { buildEmptyBuffer, buildGarbageBytes } from './__fixtures__/nonMp4Bytes'

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
    expect(result.stretchFactor).toBeCloseTo(4.0, 5)
  })

  it('detects with medium confidence when the stretch is only inferable from the duration ratio', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstDurationRatioFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(true)
    expect(result.confidence).toBe('medium')
    expect(result.stretchFactorSource).toBe('duration-ratio')
    expect(result.stretchFactor).toBeCloseTo(2.0, 2)
  })

  it('does not detect the ffmpeg -itsscale shape -- the rewritten stts erases the fps signal', async () => {
    const probe = await probeContainerTiming(buildHighFpsStretchingElstFfmpegShapeFixture())
    const result = detectSlowMotion(probe)

    expect(result.detected).toBe(false)
    expect(result.confidence).toBe('none')
    // Fails on signal 1 (nominal fps reads the already-slowed ~15fps), not signal 2.
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
