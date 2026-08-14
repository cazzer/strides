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
  /** Decode order — see the field's own doc above. */
  samples: DemuxedSample[]
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

      succeed({
        codec: videoTrack.codec,
        description: extractDescription(trak.mdia.minf.stbl.stsd.entries),
        width,
        height,
        fps: samples.length / durationSec,
        durationSec,
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
