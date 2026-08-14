import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Same target shape as `highFpsStretchingElstDirectRate.ts` (high native `stts` rate, unchanged,
 * alongside a stretched edit list) but with a UNITY-rate edit list whose `segmentDuration` itself
 * implies the stretch (2x the native duration) rather than declaring it via `media_rate`. Exercises
 * `containerTiming.ts`'s "duration-ratio" fallback path specifically, which per
 * `slowMotionDetection.ts`'s tiering drives `confidence: 'medium'` -- a real, thresholded
 * detection, just one inferential step further from an explicit rate declaration. Same real-device
 * unverified caveat as the direct-rate fixture applies -- see that file's doc.
 */
export function buildHighFpsStretchingElstDurationRatioFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 4000, // 4s presented -- double the 2s native duration
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 100]], // 120fps @ 12000Hz, native duration 2s, UNCHANGED
    elst: [
      {
        segmentDuration: 4000, // 4s vs. 2s native -- a 2x stretch, inferred from the ratio
        mediaTime: 0,
        mediaRateInteger: 1,
        mediaRateFraction: 0, // unity rate -- the stretch is NOT declared directly
      },
    ],
  })
}
