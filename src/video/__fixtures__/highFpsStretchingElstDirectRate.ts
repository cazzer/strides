import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * The shape this predicate is actually designed to catch: a high native `stts` rate (120fps),
 * UNCHANGED, alongside an edit list whose `media_rate` explicitly declares a 0.25x playback
 * rate (`media_rate_integer: 0, media_rate_fraction: 16384` = 16384/65536 = 0.25 per spec) --
 * i.e. "play this media at quarter speed," a 4x stretch, declared directly rather than inferred.
 * (mp4box.js reads/writes `media_rate_fraction` as a SIGNED 16-bit int -- exact spec-legal values
 * at or above 0.5, e.g. `32768`/65536, silently overflow that field on write. `16384` keeps this
 * fixture inside the range mp4box.js's own model actually supports, and inside real values too:
 * this repo's real demo clip never carries a non-unity rate at all, so there is no reference
 * point for what a real device WOULD write here -- see the caveat below.) This is the
 * `containerTiming.ts` "direct-rate" path, and per `slowMotionDetection.ts`'s tiering this drives
 * `confidence: 'high'`.
 *
 * IMPORTANT CAVEAT (see this worktree's CLAUDE.md write-up): this fixture is a HYPOTHESIS about
 * how a spec-compliant container-level retime could look, built because the only real retiming
 * tool available during this spike (ffmpeg's `-itsscale`) does NOT produce this shape -- it
 * rewrites `stts` directly instead (see `buildHighFpsStretchingElstFfmpegShapeFixture` and
 * `containerTiming.ts`'s module doc for that empirical finding). Whether any real device's native
 * slow-motion recording produces THIS shape, ffmpeg's shape, or something else entirely (e.g.
 * Apple's proprietary metadata) is UNVERIFIED -- zero real slow-motion clips were available to
 * this spike. This fixture proves the parsing/policy code correctly handles the shape it targets,
 * not that real footage exercises it.
 */
export function buildHighFpsStretchingElstDirectRateFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 8000, // 8s presented -- 4x the 2s native duration
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 100]], // 120fps @ 12000Hz, native duration 2s, UNCHANGED
    elst: [
      {
        segmentDuration: 8000, // 8s, matching the stretched presentation
        mediaTime: 0,
        mediaRateInteger: 0,
        mediaRateFraction: 16384, // 0.25x playback rate, declared directly
      },
    ],
  })
}
