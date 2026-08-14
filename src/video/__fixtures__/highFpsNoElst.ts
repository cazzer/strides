import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Legitimate high-fps capture (120fps) with NO edit list -- e.g. footage shot at 120fps and
 * simply played back at 120fps (fast motion, not slow motion), or a device that records at a
 * high native rate without any container-level retiming. Predicate: signal 1 (native fps >= 100)
 * fires, but signal 2 (edit-list retiming) has nothing to find -- guards against the "fps alone"
 * false-positive trap.
 */
export function buildHighFpsNoElstFixture(): ArrayBuffer {
  return buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 2000, // 2s
    mediaTimescaleHz: 12000,
    sttsRuns: [[240, 100]], // 240 samples @ 100 ticks (120fps @ 12000Hz) = 2s
  })
}
