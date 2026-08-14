import { createFile, MP4BoxBuffer } from 'mp4box'
import type { ISOFile } from 'mp4box'

/**
 * One entry from an ISO/IEC 14496-12 `edts/elst` (Edit List) box, read verbatim off the
 * container -- no interpretation applied at this layer (`slowMotionDetection.ts` is where
 * interpretation happens). `segmentDuration` is expressed in the MOVIE's timescale
 * (`ContainerVideoTrackTiming.movieTimescaleHz`), NOT the track's own media timescale --
 * confusing the two is a classic ISO-BMFF parsing bug, which is why this type keeps them as
 * separate, explicitly-named fields on the parent rather than a single ambient "timescale".
 * `mediaTime` is in the track's MEDIA timescale (`mediaTimescaleHz`); `-1` means an "empty edit"
 * (a gap with nothing playing). `mediaRateInteger`/`mediaRateFraction` combine per spec as
 * `mediaRateInteger + mediaRateFraction / 65536` -- almost always exactly `1` (normal speed),
 * even on ordinary trimmed exports; see `slowMotionDetection.ts`'s module doc for why presence of
 * an edit list alone is not treated as a retiming signal.
 */
export interface ContainerElstEntry {
  segmentDuration: number
  mediaTime: number
  mediaRateInteger: number
  mediaRateFraction: number
}

export interface ContainerVideoTrackTiming {
  trackId: number
  /** Track (`mdia/mdhd`) timescale, Hz -- the tick rate `elst.mediaTime` and every `stts` sample
   * delta are expressed in. */
  mediaTimescaleHz: number
  /** Movie (`moov/mvhd`) timescale, Hz -- the tick rate `elst.segmentDuration` is expressed in.
   * Frequently differs from `mediaTimescaleHz` (e.g. 1000 vs. 60000 on real files) -- see
   * `ContainerElstEntry`'s doc for why this module never collapses the two. */
  movieTimescaleHz: number
  /**
   * `1 / (weighted-median stts sample delta, in seconds)` -- the MEDIAN across the `stts`
   * run-length table's (count, delta) pairs, NOT `nb_samples / duration`. The ratio form breaks
   * under exactly the condition this module exists to detect: a stretched `elst`/`tkhd`/`mdhd`
   * duration (from a slow-motion re-mux) corrupts `duration` while leaving `nb_samples`
   * untouched, silently deflating the ratio's implied fps. The median of the actual per-sample
   * deltas is immune to that -- it reads the real inter-frame spacing directly. (Empirically,
   * see `slowMotionDetection.ts`'s module doc: a naive PTS-rescale re-mux, e.g. ffmpeg's
   * `-itsscale`, rewrites the deltas THEMSELVES, which this measure correctly reports as the new,
   * slower rate -- there is no remaining way to recover a pre-rescale native rate from the
   * container alone in that case. That is a real, separate finding from the ratio-corruption bug
   * this median guards against.)
   *
   * `null` when the track carries no usable `stts` table (zero total samples, or a `mediaTimescaleHz`
   * of zero) -- fails closed rather than reporting a fabricated rate.
   */
  nominalFps: number | null
  /** Raw edit-list entries, verbatim, in file order. Empty (not `null`) when the track has no
   * `edts/elst` box at all -- absence is itself meaningful to the policy layer, so it is
   * represented as "no entries" rather than collapsed into a sentinel value. */
  elst: ContainerElstEntry[]
  /**
   * How much longer this track's PRESENTATION runs than its native (`stts`-implied) duration
   * would predict. `> 1` means "presented slower than natively sampled" -- the retiming
   * signature a slow-motion re-mux (done via edit list rather than by rewriting `stts` itself)
   * would carry. `null` when there is no `elst` to compare against, or when a duration needed for
   * the comparison is zero/unusable.
   *
   * Two computation paths, tried in this order:
   * 1. **Direct rate.** If any entry carries a `mediaRateInteger`/`mediaRateFraction` combining to
   *    a rate that is neither `0` (a dwell edit) nor `1` (normal speed), `stretchFactor` is
   *    `1 / rate` from that entry directly -- the container is explicitly declaring its own
   *    playback-rate change, so no inference is needed.
   * 2. **Duration ratio**, when no entry gives a usable direct rate (the overwhelmingly common
   *    case in practice -- see the finding below). Sums `segmentDuration` across every entry
   *    (movie timescale) and compares it to the `stts`-implied native duration (`Σ count·delta`,
   *    media timescale, both converted to seconds via their own track's timescale).
   *
   * **Empirical finding this spike made, worth knowing before trusting path 2 on a real
   * slow-motion-shaped file:** ffmpeg's `-itsscale` (the one retiming tool actually available to
   * generate a test fixture with) does NOT set a non-unity `media_rate` -- path 1 never fires on
   * its output. And because it rewrites `stts` sample deltas by the same factor it stretches
   * `elst`/`mvhd`/`mdhd` durations by, path 2's ratio comes back ~1.0 (no stretch detected)
   * on an itsscale-shaped file too, even though the file plays 8x slower than its source. Neither
   * path detects that specific re-mux shape. Path 2 remains correct and useful for the DIFFERENT
   * shape it targets -- an edit list stretching presentation duration while `stts` stays at the
   * original native rate, which is how a spec-compliant "trick-play" retime (and, unverified, how
   * a real device might record native slow-motion) would look. See `slowMotionDetection.ts`'s
   * module doc for the full writeup and what this means for the detector's real-world reach.
   */
  stretchFactor: number | null
  /** Which of `stretchFactor`'s two computation paths produced it -- `null` exactly when
   * `stretchFactor` is `null`. `slowMotionDetection.ts` uses this to grade confidence: a
   * `'direct-rate'` factor is the container explicitly declaring its own playback-rate change,
   * while `'duration-ratio'` is this module inferring one from comparing two durations -- a
   * real signal, but one step further from the source. */
  stretchFactorSource: 'direct-rate' | 'duration-ratio' | null
}

export type ContainerTimingParseStatus = 'ok' | 'unsupported-container' | 'parse-error'

export interface ContainerTimingProbe {
  parseStatus: ContainerTimingParseStatus
  /** A developer-facing detail for logs/diagnostics, never shown to end users directly. Present
   * on 'parse-error' (always), and on 'unsupported-container' WHENEVER the underlying failure
   * threw a catchable exception (e.g. a broken box the walker can't recover from -- see
   * `probeContainerTiming`'s module doc for exactly which real-world cases land where). Absent on
   * 'unsupported-container' only for the "nothing happened at all" case -- neither `onReady` nor
   * `onError` ever fired and nothing threw (a truncated buffer, or one with no recognizable box
   * structure at all) -- where there is no exception message to surface. */
  error?: string
  /** Empty on any non-'ok' status, or on an 'ok'-parsed file that simply has no video track
   * (e.g. audio-only input). */
  videoTracks: ContainerVideoTrackTiming[]
}

/**
 * Combines an ISO/IEC 14496-12 edit-list entry's split rate fields into a single number.
 * `media_rate_integer`/`media_rate_fraction` are together ONE signed 32-bit 16.16 fixed-point
 * value, but mp4box parses each half separately via `readInt16()` (signed). That means a
 * fraction of 0x8000 or above -- e.g. exactly `0.5`, encoded as fraction bits `0x8000` -- reads
 * back as a NEGATIVE `mediaRateFraction` (`-32768`), because the sign bit belongs to the combined
 * 32-bit value, not to the fraction half in isolation. Naively adding the two halves
 * (`integer + fraction / 65536`) therefore SUBTRACTS for any rate whose fractional part is >= 0.5
 * -- e.g. a real 0.5x it silently reads as `-0.5`, and a real 1.5x reads as `1.0 - 0.5 = 0.5`
 * (indistinguishable from an actual 0.5x, i.e. exactly backwards). Reinterpreting the fraction as
 * unsigned before combining fixes this -- correct for the common case AND for genuinely negative/
 * reverse-play rates, since the two 16-bit halves are one two's-complement value either way.
 */
function elstEntryRate(entry: ContainerElstEntry): number {
  return entry.mediaRateInteger + (entry.mediaRateFraction & 0xffff) / 65536
}

/**
 * Weighted median of an `stts` run-length table's sample deltas, in ticks. `sampleCounts[i]`
 * consecutive samples all share `sampleDeltas[i]` -- this walks the (delta, count) pairs in
 * ascending delta order and returns the delta at the lower-median cumulative-count position,
 * without ever materializing one entry per sample (real tracks can have tens of thousands).
 */
function weightedMedianSampleDeltaTicks(sampleCounts: number[], sampleDeltas: number[]): number | null {
  const pairs = sampleCounts
    .map((count, i) => ({ delta: sampleDeltas[i], count }))
    .filter((pair) => pair.count > 0 && Number.isFinite(pair.delta))
  const totalSamples = pairs.reduce((sum, pair) => sum + pair.count, 0)
  if (totalSamples === 0) return null

  pairs.sort((a, b) => a.delta - b.delta)
  const targetIndex = Math.floor((totalSamples - 1) / 2)
  let cumulative = 0
  for (const pair of pairs) {
    cumulative += pair.count
    if (cumulative > targetIndex) return pair.delta
  }
  // Unreachable given the sum check above, but keeps this total rather than partial.
  return pairs[pairs.length - 1]?.delta ?? null
}

interface StretchFactorResult {
  stretchFactor: number | null
  stretchFactorSource: 'direct-rate' | 'duration-ratio' | null
}

const NO_STRETCH_FACTOR: StretchFactorResult = { stretchFactor: null, stretchFactorSource: null }

function computeStretchFactor(
  elst: ContainerElstEntry[],
  movieTimescaleHz: number,
  nativeDurationMediaTicks: number,
  mediaTimescaleHz: number,
): StretchFactorResult {
  if (elst.length === 0 || movieTimescaleHz <= 0 || mediaTimescaleHz <= 0) return NO_STRETCH_FACTOR

  // Path 1: an explicit, non-dwell, non-unity rate is authoritative -- no inference needed.
  for (const entry of elst) {
    const rate = elstEntryRate(entry)
    if (rate > 0 && Math.abs(rate - 1) > 1e-6) {
      return { stretchFactor: 1 / rate, stretchFactorSource: 'direct-rate' }
    }
  }

  // Path 2: compare total presentation duration (from the edit list, movie timescale) to the
  // native stts-implied duration (media timescale). Sound for the common single-edit-covers-the-
  // whole-track case this predicate targets; not a general multi-edit timeline reconstruction.
  // Excludes empty edits (`mediaTime === -1`, a presentation gap backed by no media at all) and
  // dwell edits (rate `0`, a freeze-frame held for `segmentDuration` -- these always reach here,
  // since Path 1 above only returns early for a NON-zero, non-unity rate) from the sum: neither
  // corresponds to media actually being played back at some rate, so including their
  // `segmentDuration` would inflate the presentation-duration side of the ratio in the
  // false-positive direction without a matching native-duration contribution to balance it.
  if (nativeDurationMediaTicks <= 0) return NO_STRETCH_FACTOR
  const presentationDurationSec =
    elst
      .filter((entry) => entry.mediaTime >= 0 && elstEntryRate(entry) > 0)
      .reduce((sum, entry) => sum + entry.segmentDuration, 0) / movieTimescaleHz
  const nativeDurationSec = nativeDurationMediaTicks / mediaTimescaleHz
  if (presentationDurationSec <= 0 || nativeDurationSec <= 0) return NO_STRETCH_FACTOR
  return {
    stretchFactor: presentationDurationSec / nativeDurationSec,
    stretchFactorSource: 'duration-ratio',
  }
}

/** Shape of mp4box's own raw edit-list entry (`moov.traks[].edts.elst.entries[]`, and
 * `Movie.videoTracks[].edits[]`) -- kept as a local structural type rather than importing
 * mp4box's own `Entry` interface, which is not part of its public exported type surface. */
interface RawElstEntry {
  segment_duration: number
  media_time: number
  media_rate_integer: number
  media_rate_fraction: number
}

function buildVideoTrackTiming(
  isoFile: ISOFile,
  trackId: number,
  mediaTimescaleHz: number,
  movieTimescaleHz: number,
  edits: RawElstEntry[],
): ContainerVideoTrackTiming {
  const trak = isoFile.moov?.traks?.find((candidate) => candidate.tkhd?.track_id === trackId)
  const stts = trak?.mdia?.minf?.stbl?.stts

  let nominalFps: number | null = null
  let nativeDurationMediaTicks = 0
  if (stts && stts.sample_counts.length > 0 && mediaTimescaleHz > 0) {
    const deltaTicks = weightedMedianSampleDeltaTicks(stts.sample_counts, stts.sample_deltas)
    if (deltaTicks != null && deltaTicks > 0) {
      nominalFps = mediaTimescaleHz / deltaTicks
    }
    nativeDurationMediaTicks = stts.sample_counts.reduce(
      (sum, count, i) => sum + count * stts.sample_deltas[i],
      0,
    )
  }

  // Prefer the raw box tree's elst (present whenever `trak.edts.elst` parsed) so this doesn't
  // depend on `Movie.videoTracks[].edits` continuing to exist verbatim across mp4box versions;
  // falls back to the caller-supplied `edits` (from the high-level `onReady` info) for the rare
  // case the box tree lookup above doesn't find a matching `trak` (should not happen in practice
  // -- `onReady` and `isoFile.moov` are populated from the same parse).
  const rawElst = trak?.edts?.elst?.entries
  const elst: ContainerElstEntry[] = (rawElst ?? edits).map((entry) => ({
    segmentDuration: entry.segment_duration,
    mediaTime: entry.media_time,
    mediaRateInteger: entry.media_rate_integer,
    mediaRateFraction: entry.media_rate_fraction,
  }))

  const { stretchFactor, stretchFactorSource } = computeStretchFactor(
    elst,
    movieTimescaleHz,
    nativeDurationMediaTicks,
    mediaTimescaleHz,
  )

  return {
    trackId,
    mediaTimescaleHz,
    movieTimescaleHz,
    nominalFps,
    elst,
    stretchFactor,
    stretchFactorSource,
  }
}

/**
 * Parses container-level timing metadata out of an MP4 `ArrayBuffer` -- pure, no video decoding,
 * no pixel access. Drives `mp4box`'s `createFile()`/`appendBuffer()`/`onReady` and reduces its
 * (large, general-purpose) box tree down to exactly what `slowMotionDetection.ts`'s predicate
 * needs. Fails closed: any non-MP4 input (WebM, corrupt files, empty buffers) resolves with
 * `parseStatus !== 'ok'` rather than throwing or hanging -- callers should always be able to
 * `await` this safely regardless of what the user picked as their input file.
 *
 * **The exact `parseStatus` mapping is less intuitive than it sounds, and was verified against
 * `mp4box` directly rather than assumed** (an earlier draft of this doc had WebM and corrupt-MP4
 * swapped relative to actual behavior):
 * - **WebM / any EBML input** (the single most likely real non-MP4 case this ever sees, e.g. a
 *   webcam recording depending on browser/codec choice): `mp4box`'s box reader interprets the
 *   EBML header's leading bytes as a plausible-looking box, decides the data is malformed, and
 *   calls its OWN `onError` callback (e.g. `"Invalid data found while parsing box of type
 *   '...'"`) -- this lands on **`'parse-error'`**, WITH an `error` message. Verified against a
 *   real ffmpeg-generated WebM file; fixture: `__fixtures__/webmBytes.ts`.
 * - **A structurally-plausible but internally-broken `moov`** (e.g. a box `mp4box` doesn't
 *   recognize sitting where a required child like `mdhd` should be): the box walk itself
 *   completes without throwing, but `mp4box`'s own `getInfo()` (invoked internally while
 *   preparing the `Movie` object for `onReady`, before this function's `onReady` handler below
 *   ever runs) unconditionally dereferences fields like `trak.mdia.mdhd.timescale` and throws a
 *   `TypeError` reading a property off `undefined`. That exception propagates out of the
 *   `appendBuffer`/`flush` call below and is caught by ITS `try`/`catch` -- landing on
 *   **`'unsupported-container'`**, WITH an `error` message (the `TypeError`'s). Verified by
 *   deliberately corrupting a valid fixture's `mdhd` fourcc; fixture:
 *   `__fixtures__/corruptedMp4.ts`'s `buildCorruptedMoovMp4`.
 * - **Truncated input, garbage bytes with no recognizable box structure at all, or an empty
 *   buffer**: nothing ever throws and neither `onReady` nor `onError` fires -- `mp4box` is simply
 *   left waiting for bytes that (per `last: true`) are never coming. Falls through to the final
 *   `settle` below: **`'unsupported-container'`**, with NO `error` message (there is no exception
 *   to report). Fixtures: `__fixtures__/corruptedMp4.ts`'s `buildTruncatedMp4`,
 *   `__fixtures__/nonMp4Bytes.ts`.
 *
 * So `'parse-error'` is, counter-intuitively, the status for a container `mp4box` recognizes
 * clearly enough to actively object to (including the ISO-BMFF-adjacent-looking parts of a WebM
 * header) -- `'unsupported-container'` covers both "recognized structure, but broken in a way
 * that crashes internal bookkeeping" and "nothing recognizable here at all." Both still fail
 * closed either way (`detectSlowMotion` treats every non-`'ok'` status identically), but code
 * that branches on the specific status string should read this list, not guess from the names.
 *
 * mp4box's own parsing is synchronous for a single, fully-buffered `ArrayBuffer` passed with
 * `last: true` (no streaming/chunked input here -- video files are read whole into memory
 * upstream of this call already) -- `onReady`/`onError` fire within the `appendBuffer`/`flush`
 * call stack, not on a later microtask. This still returns a `Promise` because "parses an
 * ArrayBuffer and reports timing" is conceptually an async boundary for callers (matching how the
 * eventual pipeline wiring reads a `File`/`Blob` into an `ArrayBuffer` first), and because relying
 * on mp4box's synchronicity being permanent across versions is not something to build atop.
 */
export function probeContainerTiming(buffer: ArrayBuffer): Promise<ContainerTimingProbe> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (probe: ContainerTimingProbe) => {
      if (settled) return
      settled = true
      resolve(probe)
    }

    let isoFile: ISOFile
    try {
      isoFile = createFile()
    } catch (err) {
      settle({
        parseStatus: 'parse-error',
        error: err instanceof Error ? err.message : String(err),
        videoTracks: [],
      })
      return
    }

    isoFile.onError = (module, message) => {
      settle({ parseStatus: 'parse-error', error: `${module}: ${message}`, videoTracks: [] })
    }

    isoFile.onReady = (info) => {
      try {
        const movieTimescaleHz = isoFile.moov?.mvhd?.timescale ?? info.timescale
        const videoTracks = info.videoTracks.map((track) =>
          buildVideoTrackTiming(isoFile, track.id, track.timescale, movieTimescaleHz, track.edits ?? []),
        )
        settle({ parseStatus: 'ok', videoTracks })
      } catch (err) {
        settle({
          parseStatus: 'parse-error',
          error: err instanceof Error ? err.message : String(err),
          videoTracks: [],
        })
      }
    }

    try {
      const mp4boxBuffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0)
      isoFile.appendBuffer(mp4boxBuffer, true)
      isoFile.flush()
    } catch (err) {
      settle({
        parseStatus: 'unsupported-container',
        error: err instanceof Error ? err.message : String(err),
        videoTracks: [],
      })
      return
    }

    // A single fully-buffered append is synchronous end-to-end in mp4box (see module doc above)
    // -- if neither onReady nor onError fired by now, nothing about this buffer was recognizable
    // enough to even object to (a truncated buffer, an empty one, or bytes with no plausible box
    // structure at all -- NOT a WebM/EBML file, which mp4box actively misparses and rejects via
    // its own `onError` above instead; see the module doc's verified status-mapping table).
    settle({ parseStatus: 'unsupported-container', videoTracks: [] })
  })
}
