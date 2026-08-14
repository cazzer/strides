import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Models what this spike found ffmpeg's `-itsscale 8` ACTUALLY does to a real file (measured
 * against this repo's `park-approach.mp4` demo clip -- see this worktree's CLAUDE.md write-up for
 * the full box dump): it rewrites `stts` sample deltas THEMSELVES by the scale factor (here, a
 * native 120fps/100-tick delta becomes an 800-tick delta -- an already-slowed ~15fps, mirroring
 * the measured real clip going from a 1001-tick/59.94fps delta to an 8008-tick/~7.49fps delta),
 * and scales the pre-existing edit list's `segmentDuration`/`mediaTime` by the same factor while
 * leaving `media_rate` at UNITY throughout. The result: nothing in the container disagrees with
 * anything else post-rescale -- `nominalFps` reads the already-slow rate (failing signal 1
 * outright), and even if it didn't, the duration-ratio path would read ~1.0 (no stretch), because
 * `stts` and the edit list were stretched together, consistently.
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
    movieDurationTicks: 16000, // 8x the pre-rescale 2000-tick (2s) duration
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 800]], // delta rewritten 100 -> 800 (8x): now reads as ~15fps natively
    elst: [
      {
        segmentDuration: 16000, // scaled 8x alongside stts, so it matches the new (slow) native duration
        mediaTime: 1600, // pre-existing small priming offset (200), also scaled 8x
        mediaRateInteger: 1,
        mediaRateFraction: 0, // unity rate throughout -- ffmpeg never touches this field
      },
    ],
  })
}
