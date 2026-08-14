import { buildMinimalMp4 } from './mp4BoxFixture'

/**
 * Truncated MP4: a valid box tree (from `buildMinimalMp4`) cut off partway through the `moov`
 * box -- simulates an interrupted upload/download or a partially-written file. mp4box never
 * finds a complete `moov`, so neither `onReady` nor `onError` fires; `probeContainerTiming`'s own
 * fallback (nothing settled after `appendBuffer`/`flush` return) resolves this as
 * `'unsupported-container'`. See `containerTiming.ts`'s module doc for the full status mapping
 * this fixture (along with `webmBytes.ts` and `corruptedMoov` below) backs as a regression.
 */
export function buildTruncatedMp4(): ArrayBuffer {
  const valid = buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 2000,
    mediaTimescaleHz: 3000,
    sttsRuns: [[60, 100]],
  })
  return valid.slice(0, valid.byteLength - 40)
}

/**
 * Corrupted `moov`: a valid box tree with the `mdhd` box's fourcc overwritten to an unrecognized
 * value (found dynamically by searching for the literal `mdhd` ASCII bytes, so this doesn't
 * depend on a hardcoded byte offset that `mp4BoxFixture.ts`'s box construction could silently
 * invalidate later), while leaving that box's declared SIZE field intact -- mp4box's box walker
 * still recognizes framing well enough to keep parsing, but `trak.mdia.mdhd` never gets
 * populated. mp4box's own `getInfo()` (invoked internally, before `onReady`/`onError` ever fire)
 * unconditionally reads `trak.mdia.mdhd.timescale` while building the `Movie` info object, which
 * throws a `TypeError` reading a property off `undefined` -- a REAL, reproduced case of a
 * recognized-but-broken MP4 that nonetheless lands on `'unsupported-container'`, not
 * `'parse-error'`, because the throw happens inside the `appendBuffer`/`flush` call stack, not
 * via mp4box's own `onError` callback. Verified directly against `mp4box` before writing this
 * fixture -- see `containerTiming.ts`'s module doc for the corrected status-mapping writeup this
 * backs.
 */
export function buildCorruptedMoovMp4(): ArrayBuffer {
  const valid = buildMinimalMp4({
    movieTimescaleHz: 1000,
    movieDurationTicks: 2000,
    mediaTimescaleHz: 3000,
    sttsRuns: [[60, 100]],
  })
  const bytes = new Uint8Array(valid.slice(0))
  const needle = [0x6d, 0x64, 0x68, 0x64] // 'mdhd'
  let offset = -1
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    offset = i
    break
  }
  if (offset === -1) throw new Error('fixture bug: mdhd fourcc not found in the built buffer')
  bytes[offset] = 0x78 // 'x'
  bytes[offset + 1] = 0x78
  bytes[offset + 2] = 0x78
  bytes[offset + 3] = 0x78
  return bytes.buffer
}
