import { describe, expect, it, vi } from 'vitest'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { PoseDetector } from '../pose/detector'
import type { PoseFrame } from '../pose/types'
import type { VideoMetadata } from '../video/types'
import { makeVideoSeekable } from '../test/videoTestUtils'
import {
  assessVideoQuality,
  MIN_FRAME_RATE_FPS,
  MIN_SHORT_SIDE_PX,
} from './assessVideoQuality'

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  makeVideoSeekable(video)
  return video
}

function makeMetadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    durationSec: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    ...overrides,
  }
}

/** A PoseFrame with exactly `visibleCount` of the 12 keypoints scoring above threshold. */
function makeFrame(visibleCount: number): PoseFrame {
  return {
    timestamp: 0,
    keypoints: COMMON_KEYPOINT_NAMES.map((name, i) => ({
      name,
      x: 0,
      y: 0,
      score: i < visibleCount ? 0.9 : 0.1,
    })),
  }
}

function makeDetector(
  estimatePose: PoseDetector['estimatePose'],
): PoseDetector {
  return { estimatePose, dispose: vi.fn() }
}

describe('assessVideoQuality', () => {
  describe('resolution check', () => {
    it('passes at exactly the minimum short side', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ width: MIN_SHORT_SIDE_PX, height: 1080 }),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 1,
      })
      expect(result.checks.resolution.status).toBe('pass')
      expect(result.checks.resolution.value).toBe(MIN_SHORT_SIDE_PX)
    })

    it('fails just below the minimum short side', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ width: MIN_SHORT_SIDE_PX - 1, height: 1080 }),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 1,
      })
      expect(result.checks.resolution.status).toBe('fail')
      expect(result.checks.resolution.message).not.toBeNull()
    })

    it('is evaluated on portrait video using the shorter side', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ width: 1080, height: MIN_SHORT_SIDE_PX - 1 }),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 1,
      })
      expect(result.checks.resolution.status).toBe('fail')
    })
  })

  describe('frame rate check', () => {
    it('passes at or above the minimum', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ frameRate: MIN_FRAME_RATE_FPS }),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 1,
      })
      expect(result.checks.frameRate.status).toBe('pass')
    })

    it('fails below the minimum', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ frameRate: MIN_FRAME_RATE_FPS - 1 }),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 1,
      })
      expect(result.checks.frameRate.status).toBe('fail')
      expect(result.checks.frameRate.message).not.toBeNull()
    })

    it('is skipped when frameRate is null (the case for every upload)', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ frameRate: null }),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 1,
      })
      expect(result.checks.frameRate).toEqual({
        id: 'frameRate',
        status: 'skipped',
        value: null,
        threshold: MIN_FRAME_RATE_FPS,
        message: null,
      })
    })
  })

  describe('confidence check', () => {
    it('passes when average visible fraction meets the threshold', async () => {
      // 8/12 = 0.667 >= MIN_AVG_VISIBLE_FRACTION (0.6)
      const estimatePose = vi.fn().mockResolvedValue(makeFrame(8))
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata(),
        detector: makeDetector(estimatePose),
        sampleCount: 3,
      })
      expect(result.checks.confidence.status).toBe('pass')
      expect(estimatePose).toHaveBeenCalledTimes(3)
    })

    it('fails when average visible fraction is below the threshold', async () => {
      // 2/12 = 0.167 < MIN_AVG_VISIBLE_FRACTION (0.6)
      const estimatePose = vi.fn().mockResolvedValue(makeFrame(2))
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata(),
        detector: makeDetector(estimatePose),
        sampleCount: 3,
      })
      expect(result.checks.confidence.status).toBe('fail')
      expect(result.checks.confidence.message).not.toBeNull()
    })

    it('treats a null estimate as 0-visible and keeps sampling the rest', async () => {
      const estimatePose = vi
        .fn()
        .mockResolvedValueOnce(makeFrame(12)) // 1.0
        .mockResolvedValueOnce(null) // 0
        .mockResolvedValueOnce(makeFrame(12)) // 1.0
      // avg = (1 + 0 + 1) / 3 = 0.667 >= 0.6
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata(),
        detector: makeDetector(estimatePose),
        sampleCount: 3,
      })
      expect(result.checks.confidence.status).toBe('pass')
      expect(estimatePose).toHaveBeenCalledTimes(3)
    })

    it('treats a throwing sample as 0-visible and keeps sampling the rest, never aborting', async () => {
      const estimatePose = vi
        .fn()
        .mockResolvedValueOnce(makeFrame(12))
        .mockRejectedValueOnce(new Error('transient detector error'))
        .mockResolvedValueOnce(makeFrame(12))
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata(),
        detector: makeDetector(estimatePose),
        sampleCount: 3,
      })
      expect(result.checks.confidence.status).toBe('pass')
      expect(estimatePose).toHaveBeenCalledTimes(3)
    })

    it('reports status: error and does not sample when detector is null', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata(),
        detector: null,
        sampleCount: 3,
      })
      expect(result.checks.confidence.status).toBe('error')
      expect(result.checks.confidence.value).toBeNull()
      expect(result.checks.confidence.message).not.toBeNull()
    })

    it('samples timestamps within the trimmed middle of the clip, avoiding the first/last 10%', async () => {
      const seenTimes: number[] = []
      const video = makeVideo()
      const estimatePose = vi.fn().mockImplementation(async () => {
        seenTimes.push(video.currentTime)
        return makeFrame(12)
      })
      await assessVideoQuality({
        video,
        metadata: makeMetadata({ durationSec: 10 }),
        detector: makeDetector(estimatePose),
        sampleCount: 5,
      })
      const trim = 10 * 0.1
      for (const t of seenTimes) {
        expect(t).toBeGreaterThanOrEqual(trim)
        expect(t).toBeLessThanOrEqual(10 - trim)
      }
    })
  })

  describe('overall verdict', () => {
    it('is pass when every check passes', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata(),
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))),
        sampleCount: 2,
      })
      expect(result.overall).toBe('pass')
    })

    it('is pass when the only non-passing checks are skipped/error (fail-open)', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ frameRate: null }), // skipped
        detector: null, // confidence -> error
        sampleCount: 2,
      })
      expect(result.checks.frameRate.status).toBe('skipped')
      expect(result.checks.confidence.status).toBe('error')
      expect(result.overall).toBe('pass')
    })

    it('is warn when a single check fails, even with the others passing', async () => {
      const result = await assessVideoQuality({
        video: makeVideo(),
        metadata: makeMetadata({ width: 100, height: 100 }), // resolution fails
        detector: makeDetector(vi.fn().mockResolvedValue(makeFrame(12))), // confidence passes
        sampleCount: 2,
      })
      expect(result.checks.resolution.status).toBe('fail')
      expect(result.checks.frameRate.status).toBe('pass')
      expect(result.checks.confidence.status).toBe('pass')
      expect(result.overall).toBe('warn')
    })
  })

  it('restores the original playhead position after assessment, even when a sample throws', async () => {
    const video = makeVideo()
    video.currentTime = 4.2
    const estimatePose = vi.fn().mockRejectedValue(new Error('boom'))

    await assessVideoQuality({
      video,
      metadata: makeMetadata({ durationSec: 10 }),
      detector: makeDetector(estimatePose),
      sampleCount: 3,
    })

    expect(video.currentTime).toBe(4.2)
  })
})
