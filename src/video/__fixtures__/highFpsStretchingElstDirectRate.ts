import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * The shape this predicate is actually designed to catch: a high native `stts` rate (120fps),
 * UNCHANGED, alongside an edit list whose `media_rate` explicitly declares a 0.5x playback rate
 * -- i.e. "play this media at half speed," a 2x stretch, declared directly rather than inferred.
 * This is the `containerTiming.ts` "direct-rate" path, and per `slowMotionDetection.ts`'s
 * tiering this drives `confidence: 'high'`.
 *
 * `media_rate_integer`/`media_rate_fraction` (ISO/IEC 14496-12) are together ONE signed 32-bit
 * 16.16 fixed-point value, but `mp4box` reads/writes each 16-bit half separately via
 * `readInt16()`/`writeInt16()` (both signed). `0.5` is correctly spec-encoded as fraction bits
 * `0x8000` -- which, read back as a signed 16-bit int, is `-32768`, not `32768`. This fixture uses
 * that real on-wire value directly (`mediaRateFraction: -32768`) rather than the positive
 * `32768`, both because it is what `mp4box`'s own parser will actually hand back from a real file
 * and because it exercises `elstEntryRate`'s `& 0xffff` unsigned-reinterpretation fix on exactly
 * the value it exists to handle (see `containerTiming.ts`'s `elstEntryRate` doc for the full bug
 * writeup -- an earlier version of this fixture worked around a since-fixed READ-side sign bug by
 * using a smaller, always-positive rate; that workaround is gone now that the bug is fixed at its
 * actual source).
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
    movieDurationTicks: 4000, // 4s presented -- 2x the 2s native duration
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 100]], // 120fps @ 12000Hz, native duration 2s, UNCHANGED
    elst: [
      {
        segmentDuration: 4000, // 4s, matching the stretched presentation
        mediaTime: 0,
        mediaRateInteger: 0,
        mediaRateFraction: -32768, // 0x8000 as signed int16 -- the real on-wire encoding of 0.5x
      },
    ],
  })
}
