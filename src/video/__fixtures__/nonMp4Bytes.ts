/**
 * Deliberately not an MP4 -- for `containerTiming.ts`'s fail-closed paths.
 * `buildGarbageBytes` produces bytes that are not a valid ISO-BMFF box at all (no recognizable
 * fourcc), which should never throw and never call `onReady`, landing on `'unsupported-container'`.
 * `buildEmptyBuffer` covers the degenerate zero-length input case.
 */
export function buildGarbageBytes(): ArrayBuffer {
  const bytes = new TextEncoder().encode(
    'this is plainly not an mp4 file, just some arbitrary bytes 0123456789 to feed the parser',
  )
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function buildEmptyBuffer(): ArrayBuffer {
  return new ArrayBuffer(0)
}
