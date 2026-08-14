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
  /** Present only on 'parse-error' -- a developer-facing detail for logs/diagnostics, never
   * shown to end users directly. */
  error?: string
  /** Empty on any non-'ok' status, or on an 'ok'-parsed file that simply has no video track
   * (e.g. audio-only input). */
  videoTracks: ContainerVideoTrackTiming[]
}

/** Combines an ISO/IEC 14496-12 edit-list entry's split rate fields into a single number, per
 * spec: `media_rate_integer + media_rate_fraction / 65536`. */
function elstEntryRate(entry: ContainerElstEntry): number {
  return entry.mediaRateInteger + entry.mediaRateFraction / 65536
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
  const directRateEntry = elst.find((entry) => {
    const rate = elstEntryRate(entry)
    return rate > 0 && Math.abs(rate - 1) > 1e-6
  })
  if (directRateEntry) {
    const rate = elstEntryRate(directRateEntry)
    return rate > 0 ? { stretchFactor: 1 / rate, stretchFactorSource: 'direct-rate' } : NO_STRETCH_FACTOR
  }

  // Path 2: compare total presentation duration (from the edit list, movie timescale) to the
  // native stts-implied duration (media timescale). Sound for the common single-edit-covers-the-
  // whole-track case this predicate targets; not a general multi-edit timeline reconstruction.
  if (nativeDurationMediaTicks <= 0) return NO_STRETCH_FACTOR
  const presentationDurationSec =
    elst.reduce((sum, entry) => sum + entry.segmentDuration, 0) / movieTimescaleHz
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
    // -- if neither onReady nor onError fired by now, no `moov` box was ever recognized at all
    // (e.g. a non-ISO-BMFF container like WebM, or a truncated/empty buffer). That is a real,
    // distinct outcome from a recognized-but-broken MP4 (which reaches `onError` instead), so it
    // gets its own status rather than being folded into 'parse-error'.
    settle({ parseStatus: 'unsupported-container', videoTracks: [] })
  })
}
