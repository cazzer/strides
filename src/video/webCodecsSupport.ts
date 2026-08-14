import { demuxMp4 } from './mp4Demux'

/** `ftyp`, ASCII, as it appears at byte offset 4 of every ISO-BMFF file (the box's fourcc,
 * immediately after its 4-byte size field) — the standard, cheap magic-byte check for "this is
 * probably an MP4/MOV/similar ISO-BMFF container" without parsing anything. */
const FTYP_FOURCC = [0x66, 0x74, 0x79, 0x70]
const FTYP_OFFSET = 4

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
 * (`sampleClipSequential.ts`) instead of the `<video>`-playback path (`sampleClip.ts`). Six gates,
 * cheapest/most-conclusive first, any of which failing means "no":
 *
 * 1. `VideoDecoder` doesn't exist in this browser at all.
 * 2. No blob to sample from.
 * 3-4. The blob isn't a demuxable MP4 with a video track — `looksLikeIsoBmff` rejects the
 *    obviously-wrong case cheaply (e.g. WebM from a webcam recording); an actual `demuxMp4`
 *    attempt is the real, authoritative check for everything that isn't obviously wrong, and its
 *    rejection (never a hang or uncaught throw — see that module's own contract) is what this
 *    catches for anything the cheap check let through.
 * 5. `VideoDecoder.isConfigSupported` says the demuxed codec isn't decodable here.
 * 6. Otherwise yes.
 *
 * Never throws — every failure mode above degrades to `false` so a caller can use this as a plain
 * feature-detection boolean without its own try/catch.
 */
export async function canUseSequentialDecode(blob: Blob | null): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false
  if (blob === null) return false

  try {
    if (!(await looksLikeIsoBmff(blob))) return false

    const bytes = await blob.arrayBuffer()
    const track = await demuxMp4(bytes)

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
