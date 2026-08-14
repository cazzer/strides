import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Ordinary 30fps footage, no edit list at all -- the baseline "nothing unusual here" case.
 * Predicate: signal 1 (native fps >= 100) fails outright, so detection never even reaches the
 * edit-list check.
 */
export function buildNormalFpsFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 2000, // 2s
    mediaTimescaleHz: 3000,
    sttsRuns: [[60, 100]], // 60 samples @ 100 ticks (30fps @ 3000Hz) = 2s
  })
}
