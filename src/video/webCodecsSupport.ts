import { demuxMp4, isIdentityMatrix } from './mp4Demux'

/** `ftyp`, ASCII, as it appears at byte offset 4 of every ISO-BMFF file (the box's fourcc,
 * immediately after its 4-byte size field) — the standard, cheap magic-byte check for "this is
 * probably an MP4/MOV/similar ISO-BMFF container" without parsing anything. */
const FTYP_FOURCC = [0x66, 0x74, 0x79, 0x70]
const FTYP_OFFSET = 4

/**
 * Upper bound on the blob size this probe (and, transitively, `sampleClipSequential.ts`) will
 * attempt to demux. `demuxMp4` retains a per-sample byte copy of the entire compressed bitstream
 * in memory, and today's pipeline runs a full `blob.arrayBuffer()` + demux pass up to 3 times per
 * analysis run (this feasibility probe, the primary sampler, and the background scale pass) —
 * with `<input accept="video/*">` imposing no upload size limit of its own, an uncapped path here
 * would let an unusually large upload multiply that cost with no ceiling. 200MB comfortably
 * covers the real clips this repo's own CLAUDE.md workflow produces (the demo clips are single-
 * digit-to-tens of MB) while still rejecting a pathological upload cheaply, before any bytes are
 * even read — a rejection here just falls back to the existing, proven `<video>`-playback path,
 * which has no equivalent cost (it never reads the blob's bytes directly).
 */
const MAX_SEQUENTIAL_DECODE_BLOB_BYTES = 200 * 1024 * 1024

/**
 * Cheap, synchronous-ish pre-check ahead of a real demux attempt: `true` unless the blob is
 * confidently NOT an ISO-BMFF/MP4 container. Reads only the first 8 bytes, not the whole blob —
 * the point is avoiding `canUseSequentialDecode`'s full `demuxMp4` attempt (which reads and
 * parses the entire file) for an obviously-wrong format like the WebM `WebcamCapture` produces.
 *
 * Deliberately permissive on ambiguity (too few bytes to tell, or a `.type` mp4box would still
 * need to confirm) — a false positive here just means falling through to the real demux attempt
 * below, which is authoritative; a false negative here would incorrectly reject a real MP4
 * without ever trying, which is the failure mode worth avoiding.
 */
async function looksLikeIsoBmff(blob: Blob): Promise<boolean> {
  if (blob.type === 'video/mp4') return true

  const header = new Uint8Array(await blob.slice(0, FTYP_OFFSET + FTYP_FOURCC.length).arrayBuffer())
  if (header.length < FTYP_OFFSET + FTYP_FOURCC.length) return true // too small to tell either way

  return FTYP_FOURCC.every((byte, i) => header[FTYP_OFFSET + i] === byte)
}

/**
 * Decides whether `blob` can go through the WebCodecs sequential-decode sampling path
 * (`sampleClipSequential.ts`) instead of the `<video>`-playback path (`sampleClip.ts`). Eight
 * gates, cheapest/most-conclusive first, any of which failing means "no":
 *
 * 1. `VideoDecoder` doesn't exist in this browser at all.
 * 2. No blob to sample from.
 * 3. The blob is larger than `MAX_SEQUENTIAL_DECODE_BLOB_BYTES` — see that constant's doc.
 * 4-5. The blob isn't a demuxable MP4 with a video track — `looksLikeIsoBmff` rejects the
 *    obviously-wrong case cheaply (e.g. WebM from a webcam recording); an actual `demuxMp4`
 *    attempt is the real, authoritative check for everything that isn't obviously wrong, and its
 *    rejection (never a hang or uncaught throw — see that module's own contract) is what this
 *    catches for anything the cheap check let through.
 * 6. The track's `tkhd` carries a non-identity transformation matrix — standard iPhone/Android
 *    portrait capture is coded landscape plus a 90°/270° rotation matrix, and `VideoDecoder`
 *    emits raw coded frames with no rotation applied (unlike a `<video>` element, which applies
 *    it automatically when painting). Every heuristic downstream assumes image-plane vertical/
 *    horizontal semantics, so a sideways frame would produce confidently wrong numbers, not a
 *    visible error. Rejecting here and falling back to the `<video>`-playback path (which already
 *    handles rotation correctly) is the deliberately low-risk choice — see `isIdentityMatrix`'s
 *    doc for why this module doesn't instead try to apply the rotation itself.
 * 7. `VideoDecoder.isConfigSupported` says the demuxed codec isn't decodable here.
 * 8. Otherwise yes.
 *
 * Never throws — every failure mode above degrades to `false` so a caller can use this as a plain
 * feature-detection boolean without its own try/catch.
 *
 * Note: this probe's own `enabled: false`-by-default kill switch (`SequentialSamplingConfig`,
 * see its doc) lives one layer up, in `useVideoAnalysis.ts` — this function is never even called
 * while the plane is disabled, so it has no gate of its own for it.
 */
export async function canUseSequentialDecode(blob: Blob | null): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false
  if (blob === null) return false
  if (blob.size > MAX_SEQUENTIAL_DECODE_BLOB_BYTES) return false

  try {
    if (!(await looksLikeIsoBmff(blob))) return false

    const bytes = await blob.arrayBuffer()
    const track = await demuxMp4(bytes)

    if (!isIdentityMatrix(track.matrix)) return false

    const support = await VideoDecoder.isConfigSupported({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
    })
    return support.supported === true
  } catch {
    return false
  }
}
