import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Regression fixture for the sign bug review round 1 found in `elstEntryRate`: high native `stts`
 * rate (120fps, UNCHANGED) alongside an edit list declaring 1.5x FAST playback --
 * `media_rate_integer: 1, media_rate_fraction: -32768` (`0x8000` as signed int16 -- the real
 * on-wire encoding of the `.5` fractional part; see `highFpsStretchingElstDirectRate.ts`'s doc
 * for why `-32768`, not `32768`). `1 + 0.5 = 1.5`.
 *
 * Before the fix, naively summing the signed halves (`1 + (-32768)/65536`) computed `0.5`
 * instead of `1.5` -- indistinguishable from an ACTUAL 0.5x slow-motion rate, and would have
 * driven `stretchFactor = 1 / 0.5 = 2` and reported `detected: true, confidence: 'high'` on a
 * clip playing 1.5x FASTER than native, not slower. A file playing back faster than it was
 * captured is the opposite of what this predicate exists to catch. After the fix,
 * `elstEntryRate` correctly reads `1.5`, giving `stretchFactor = 1 / 1.5 ≈ 0.667` -- comfortably
 * below `minStretchFactor` (1.5), so this must NOT detect.
 */
export function buildHighFpsFastPlaybackDirectRateFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 1334, // ~1.333s presented -- 2s native compressed to 2/1.5s
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 100]], // 120fps @ 12000Hz, native duration 2s, UNCHANGED
    elst: [
      {
        segmentDuration: 1334,
        mediaTime: 0,
        mediaRateInteger: 1,
        mediaRateFraction: -32768, // 0x8000 as signed int16 -- 1 + 0.5 = 1.5x fast playback
      },
    ],
  })
}
