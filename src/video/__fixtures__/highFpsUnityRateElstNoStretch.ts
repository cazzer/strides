import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * High-fps (120fps) footage carrying a UNITY-rate edit list whose segment duration matches the
 * native stts-implied duration -- the "ordinary trim" shape verified for real on this repo's own
 * `park-approach.mp4` demo clip during this spike (a small priming-offset edit list, unity rate,
 * segment duration == full track duration; see this module's write-up in this worktree's
 * CLAUDE.md). Predicate: signal 1 fires, an edit list is present, but signal 2's stretch-factor
 * check does NOT clear the tolerance (ratio ~1.0) -- this is the case that guards against the
 * "edit-list presence alone" false-positive trap the architecture doc calls out explicitly. Must
 * NOT detect.
 */
export function buildHighFpsUnityRateElstNoStretchFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 2000, // 2s
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 100]], // 120fps @ 12000Hz, native duration 2s
    elst: [
      {
        segmentDuration: 2000, // 2s -- matches native duration, no stretch
        mediaTime: 200, // ~2 frames' priming offset, same shape as the real demo clip's elst
        mediaRateInteger: 1,
        mediaRateFraction: 0, // unity rate
      },
    ],
  })
}
