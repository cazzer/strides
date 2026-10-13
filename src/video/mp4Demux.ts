import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box'
import type { Sample, SampleEntry, Track } from 'mp4box'

/**
 * One encoded sample as `VideoDecoder.decode` needs it: `data` is the raw bitstream (Annex-B-free
 * — mp4box already strips length-prefixed NAL units the way `avc`/`hvc1` sample entries store
 * them, which is exactly the format WebCodecs expects, no re-muxing needed), `ptsSec`/`durationSec`
 * are on the track's own media clock (NOT wall-clock, matching `PoseFrame.timestamp`'s
 * convention), and `isKeyframe` mirrors mp4box's `is_sync` flag.
 *
 * `samples` on the containing `DemuxedTrack` are in DECODE order (dts-ascending) — the order
 * mp4box's sample table stores them in and the order `VideoDecoder.decode()` requires — NOT
 * presentation order. A clip with B-frames has samples whose `ptsSec` jumps around non-
 * monotonically; `VideoDecoder`'s own internal reordering (driven by each chunk's `timestamp`)
 * is what turns this back into presentation-ordered output. Never sort this array by `ptsSec`.
 */
export interface DemuxedSample {
  data: Uint8Array
  ptsSec: number
  durationSec: number
  isKeyframe: boolean
}

/**
 * One MP4 file's video track, fully demuxed (parsed + every sample's bytes extracted) in one
 * synchronous pass. mp4box.js's own parsing/extraction pipeline is synchronous end-to-end for a
 * single whole-file `appendBuffer` call — no internal `await` — so despite the `Promise` return
 * type (kept for interface stability against a future streaming/progressive demuxer, and because
 * every caller already treats sourcing a `DemuxedTrack` as async), this never yields to a later
 * microtask before settling.
 */
export interface DemuxedTrack {
  /** WebCodecs/MSE-style codec string, e.g. `'avc1.640034'` — passed straight through to
   * `VideoDecoderConfig.codec`. */
  codec: string
  /** The codec's out-of-band config bytes (`avcC`/`hvcC`/`vpcC`/`av1C`, box header stripped) for
   * `VideoDecoderConfig.description`. `undefined` when the track's sample entry carries none of
   * those boxes — some codecs don't need one, and `VideoDecoder` treats the field as optional. */
  description: Uint8Array | undefined
  width: number
  height: number
  /** Average frames/sec (`samples.length / durationSec`) — an estimate, not a per-frame value;
   * correct for CFR content, a reasonable single-number summary for VFR. */
  fps: number
  durationSec: number
  /**
   * The track's `tkhd` transformation matrix, verbatim (9 values, ISO 14496-12 §8.3.2.3 —
   * 16.16 fixed-point for the a/b/c/d/x/y terms, 2.30 fixed-point for u/v/w). NOT applied to any
   * sample pixel data anywhere in this module or in `sequentialFrameSource.ts`'s decode — a
   * non-identity matrix (typically a 90°/270° rotation baked into a portrait phone capture) means
   * `width`x`height` as parsed here is the CODED orientation, not the on-screen one a `<video>`
   * element would paint. `webCodecsSupport.ts`'s feasibility probe rejects any non-identity
   * matrix outright (see `isIdentityMatrix`'s doc for why reject-and-fall-back, not
   * apply-the-rotation) rather than let a wrong assumption here reach the pose pipeline.
   */
  matrix: readonly number[]
  /** Decode order — see the field's own doc above. */
  samples: DemuxedSample[]
  /**
   * The colour space the sample entry's `colr` box declares (`containerColorSpace`). Read for a
   * consumer that must decode the frames a `<video>` element would paint — the element honours the
   * container's declaration, so such a consumer hands the same one to its decoder. Absent on a
   * hand-built track, which reads as `{ kind: 'absent' }`.
   */
  colorSpace?: ContainerColorSpace
}

/**
 * What a sample entry's `colr` box says about colour: nothing (`'absent'`), an `nclx` declaration
 * expressible as a WebCodecs `VideoColorSpaceInit` (`'nclx'`), or anything else — an ICC profile, a
 * QuickTime `nclc`, or an `nclx` naming a code WebCodecs has no name for (`'unsupported'`), which a
 * consumer that must match the element's colours has to refuse rather than approximate.
 */
export type ContainerColorSpace =
  | { kind: 'absent' }
  | { kind: 'nclx'; init: VideoColorSpaceInit }
  | { kind: 'unsupported' }

/** ISO/IEC 23091-2 code points WebCodecs names. Code 2 ("unspecified") declares nothing and leaves
 * the member unset. */
const COLOUR_PRIMARIES: Record<number, string> = {
  1: 'bt709',
  5: 'bt470bg',
  6: 'smpte170m',
  9: 'bt2020',
  12: 'smpte432',
}
const TRANSFER_CHARACTERISTICS: Record<number, string> = {
  1: 'bt709',
  6: 'smpte170m',
  8: 'linear',
  13: 'iec61966-2-1',
  16: 'pq',
  18: 'hlg',
}
const MATRIX_COEFFICIENTS: Record<number, string> = {
  0: 'rgb',
  1: 'bt709',
  5: 'bt470bg',
  6: 'smpte170m',
  9: 'bt2020-ncl',
}
const UNSPECIFIED_CODE = 2

/** The fields of mp4box's parsed `colr` box this module reads. */
export interface ColrBox {
  colour_type?: string
  colour_primaries?: number
  transfer_characteristics?: number
  matrix_coefficients?: number
  full_range_flag?: number | boolean
}

/** PURE. Reduces a sample entry's `colr` box (as mp4box parses it) to a `ContainerColorSpace`. */
export function containerColorSpace(colr: ColrBox | undefined): ContainerColorSpace {
  if (colr === undefined) return { kind: 'absent' }
  if (colr.colour_type !== 'nclx') return { kind: 'unsupported' }
  const primaries = lookup(colr.colour_primaries, COLOUR_PRIMARIES)
  const transfer = lookup(colr.transfer_characteristics, TRANSFER_CHARACTERISTICS)
  const matrix = lookup(colr.matrix_coefficients, MATRIX_COEFFICIENTS)
  if (primaries === null || transfer === null || matrix === null) return { kind: 'unsupported' }
  // Built untyped and cast once: this TypeScript's DOM lib predates the BT.2020/PQ/HLG members the
  // WebCodecs spec (and Chromium) define, and the names here are the spec's own.
  const init: Record<string, string | boolean> = { fullRange: Boolean(colr.full_range_flag) }
  if (primaries !== undefined) init.primaries = primaries
  if (transfer !== undefined) init.transfer = transfer
  if (matrix !== undefined) init.matrix = matrix
  return { kind: 'nclx', init: init as VideoColorSpaceInit }
}

/** `undefined` for a code that declares nothing, `null` for one WebCodecs cannot name. */
function lookup<T>(code: number | undefined, names: Record<number, T>): T | undefined | null {
  if (code === undefined || code === UNSPECIFIED_CODE) return undefined
  return names[code] ?? null
}

/**
 * The ISO 14496-12 §8.3.2.3 identity transformation matrix — what a `tkhd` box's `matrix` field
 * is when the track carries no rotation/skew/scale for a renderer to apply. `0x00010000` (65536)
 * is `1.0` in the 16.16 fixed-point format the a/b/c/d/x/y terms use; `0x40000000` is `1.0` in
 * the 2.30 fixed-point format u/v/w use.
 */
export const IDENTITY_TKHD_MATRIX: readonly number[] = [
  0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000,
]

/**
 * Whether `matrix` (a `tkhd`'s 9-value transformation matrix, see `DemuxedTrack.matrix`'s doc)
 * is the identity matrix — i.e. the track carries no baked-in rotation, skew, or scale.
 * Compared exactly, not approximately: real encoders write one of a small, fixed set of exact
 * matrices (identity, or a 90/180/270-degree rotation for portrait capture), never a near-
 * identity float that would need a tolerance.
 */
export function isIdentityMatrix(matrix: readonly number[]): boolean {
  return (
    matrix.length === IDENTITY_TKHD_MATRIX.length &&
    matrix.every((value, i) => value === IDENTITY_TKHD_MATRIX[i])
  )
}

export class Mp4DemuxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Mp4DemuxError'
  }
}

/** Sample-entry boxes that carry a codec's out-of-band decoder config as a child box mp4box.js
 * parses into a named property — narrower than mp4box's own `SampleEntry` type, which is the
 * union of every sample-entry kind mp4box supports (audio, text, metadata, ...) and doesn't
 * declare any of these on the base type. Un-narrowed on purpose: only one of the four is ever
 * present on a real video sample entry, and probing all four is simpler than a codec-string
 * switch. */
type VideoConfigSampleEntry = SampleEntry & {
  colr?: ColrBox
  avcC?: { write(stream: DataStream): void }
  hvcC?: { write(stream: DataStream): void }
  vpcC?: { write(stream: DataStream): void }
  av1C?: { write(stream: DataStream): void }
}

/**
 * Writes a config box (`avcC`/`hvcC`/`vpcC`/`av1C`) and strips its 8-byte box header (4-byte
 * size + 4-byte fourcc), leaving exactly the bytes `VideoDecoderConfig.description` expects —
 * the standard mp4box.js idiom for bridging box-parsed config into WebCodecs.
 */
function extractDescription(entries: SampleEntry[]): Uint8Array | undefined {
  for (const entry of entries as VideoConfigSampleEntry[]) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C
    if (!box) continue
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
    box.write(stream)
    return new Uint8Array(stream.buffer.slice(8))
  }
  return undefined
}

/**
 * Parses a whole MP4 file already in memory and extracts every sample of its first video track.
 * Pure aside from mp4box.js's own internals — no DOM, no WebCodecs globals — so it's unit-
 * testable against real `.mp4` bytes read off disk with no browser/jsdom involved.
 *
 * Rejects (never hangs) on anything that isn't a demuxable MP4 with a video track: mp4box.js
 * itself reports genuinely malformed input via `onError`, but some inputs (an empty buffer, a
 * truncated file with no moov box) trigger neither `onReady` nor `onError` — since a single
 * whole-file `appendBuffer` call gives mp4box.js everything it will ever get, "settled neither
 * way by the time parsing returns" is itself conclusive: nothing later would change the outcome,
 * so that case is rejected explicitly rather than left to hang. This doubles as this module's
 * contribution to `webCodecsSupport.ts`'s feasibility probe: a non-MP4 file (e.g. WebM from
 * `WebcamCapture`) predictably rejects here.
 */
export function demuxMp4(bytes: ArrayBuffer): Promise<DemuxedTrack> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      reject(new Mp4DemuxError(message))
    }
    const succeed = (track: DemuxedTrack) => {
      if (settled) return
      settled = true
      resolve(track)
    }

    const isoFile = createFile()

    isoFile.onError = (module, message) => {
      fail(`mp4box failed to parse the file (${module}): ${message}`)
    }

    isoFile.onReady = (info) => {
      const videoTrack: Track | undefined = info.videoTracks[0]
      if (!videoTrack) {
        fail('No video track found in the MP4 file.')
        return
      }
      if (videoTrack.timescale <= 0) {
        fail('The video track reports a non-positive timescale.')
        return
      }

      const durationSec = videoTrack.duration / videoTrack.timescale
      const samples: DemuxedSample[] = []

      isoFile.onSamples = (_id: number, _user: unknown, batch: Sample[]) => {
        for (const sample of batch) {
          if (!sample.data) continue
          samples.push({
            data: sample.data,
            ptsSec: sample.cts / sample.timescale,
            durationSec: sample.duration / sample.timescale,
            isKeyframe: sample.is_sync,
          })
        }
      }

      isoFile.setExtractionOptions(videoTrack.id, null, {
        nbSamples: Math.max(videoTrack.nb_samples, 1),
      })
      isoFile.start()
      isoFile.flush()

      if (samples.length === 0) {
        fail('The MP4 file has a video track but no extractable samples.')
        return
      }

      const trak = isoFile.getTrackById(videoTrack.id)
      const width = videoTrack.video?.width ?? videoTrack.track_width
      const height = videoTrack.video?.height ?? videoTrack.track_height

      const entries = trak.mdia.minf.stbl.stsd.entries
      succeed({
        codec: videoTrack.codec,
        description: extractDescription(entries),
        colorSpace: containerColorSpace((entries[0] as VideoConfigSampleEntry | undefined)?.colr),
        width,
        height,
        fps: samples.length / durationSec,
        durationSec,
        matrix: Array.from(videoTrack.matrix),
        samples,
      })
    }

    let buffer: MP4BoxBuffer
    try {
      buffer = MP4BoxBuffer.fromArrayBuffer(bytes, 0)
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to prepare the file bytes for mp4box.')
      return
    }

    try {
      isoFile.appendBuffer(buffer)
      isoFile.flush()
    } catch (err) {
      fail(err instanceof Error ? err.message : 'mp4box threw while parsing the file.')
      return
    }

    // Everything above is synchronous end-to-end (see the doc comment) — if neither onReady nor
    // onError settled this promise by now, nothing further ever will.
    fail('The MP4 file is incomplete or malformed — no moov box was found.')
  })
}
