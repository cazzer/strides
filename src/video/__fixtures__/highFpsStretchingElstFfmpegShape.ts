import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Reproduces, EXACTLY (not idealized), what this spike measured ffmpeg's `-itsscale 8` doing to
 * the real `park-approach.mp4` demo clip -- see this worktree's CLAUDE.md write-up for the full
 * live box dump this fixture is transcribed from. The real `stts` table is NOT a single uniform
 * run: it's `[98 samples @ 8008 ticks, 1 sample @ 1001 ticks]` at a 60000 Hz media timescale --
 * ffmpeg scaled 98 of 99 sample deltas by exactly 8x (`1001 x 8 = 8008`) but left one straggler
 * sample at the original, un-rescaled delta (an ffmpeg rounding/edge artifact on the last
 * sample, not modeled away here). The pre-existing edit list was scaled in lockstep --
 * `segmentDuration` 1652 -> 13097 (movie timescale, matching the new `mvhd.duration`),
 * `mediaTime` 2002 -> 16016 (exactly x8) -- while `media_rate` stayed UNITY throughout (ffmpeg
 * never touches that field). This is the real shape, straggler sample included, not the
 * single-uniform-run approximation an earlier draft of this fixture used -- the straggler matters:
 * it's what gives `weightedMedianSampleDeltaTicks` its first multi-run exercise, and the median is
 * specifically what keeps `nominalFps` correctly anchored to the DOMINANT run (8008 ticks) rather
 * than getting pulled toward a naive sample-count-weighted MEAN, which the outlier drags upward
 * (see `containerTiming.test.ts`'s assertion contrasting the two).
 *
 * The result: nothing in the container disagrees with anything else post-rescale -- `nominalFps`
 * reads the already-slow rate (failing signal 1 outright), and even if it didn't, the
 * duration-ratio path reads ~1.0 (no stretch), because `stts` and the edit list were stretched
 * together, consistently.
 *
 * This fixture exists to make that negative finding a checked, executable regression rather than
 * a claim only written down in prose: `-itsscale`-shaped files are NOT detected by this
 * predicate, and that is not a bug in the predicate -- there is no remaining discrepancy in the
 * container for it to find. Must NOT detect, for a different underlying reason than
 * `highFpsUnityRateElstNoStretch.ts` (that one has genuinely no stretch to find; this one HAD a
 * real 8x stretch applied upstream, but the container was left in a self-consistent state that
 * erases the evidence).
 */
export function buildHighFpsStretchingElstFfmpegShapeFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 13097, // real measured mvhd.duration post -itsscale 8
    mediaTimescaleHz: 60000,
    sttsRuns: [
      [98, 8008], // 98 samples rescaled 8x: 1001 -> 8008 ticks
      [1, 1001], // 1 straggler sample left at the original, un-rescaled delta
    ],
    elst: [
      {
        segmentDuration: 13097, // real measured value, scaled 8x from the pre-rescale 1652
        mediaTime: 16016, // real measured value, scaled 8x from the pre-rescale 2002 (exactly x8)
        mediaRateInteger: 1,
        mediaRateFraction: 0, // unity rate throughout -- ffmpeg never touches this field
      },
    ],
  })
}
