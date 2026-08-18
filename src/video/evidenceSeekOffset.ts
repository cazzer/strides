import type { ContainerVideoTrackTiming } from './containerTiming'
import { probeContainerTiming } from './containerTiming'
import { canUseSequentialDecode } from './webCodecsSupport'
import { resolveSamplingRobustnessConfig } from '../results/samplingRobustnessConfig'

/**
 * Resolves `EvidenceExtractionOptions.seekOffsetSeconds` for one clip — the number
 * `extractFrames.ts` adds to a planned timestamp before seeking a detached `<video>`.
 *
 * ### The bug this exists to close (gh #69, ground-truthed, not hypothesised)
 *
 * The evidence extractor seeks to a `robustFrames[].timestamp`. Which clock that timestamp is on
 * depends on **which sampler produced it**, and the two samplers disagree:
 *
 * - `sampleClipSequential.ts` (WebCodecs, the default for MP4s) reports raw
 *   `sample.cts / sample.timescale` (`mp4Demux.ts`) — the track's own MEDIA clock, with no edit
 *   list applied.
 * - `sampleClip.ts` (`<video>` playback — every WebM/webcam blob, and every MP4
 *   `canUseSequentialDecode` turns down) reports `requestVideoFrameCallback`'s `mediaTime`, which
 *   is already on the PRESENTATION clock, the same one `HTMLVideoElement.currentTime` uses.
 *
 * An `edts/elst` whose first entry has a non-zero `media_time` shifts one clock against the other
 * by exactly `media_time / mediaTimescale`, so seeking a WebCodecs timestamp lands that far LATE.
 * Measured at +2 frames on all three of this repo's test clips (0.0800 s at 25 fps, 0.033367 s at
 * 59.94 fps, 0.033333 s at 60 fps) and at exactly 0 under
 * `{ sequentialSampling: { enabled: false } }`.
 *
 * ### Why this is derived per clip rather than configured
 *
 * There is no constant to pick. The right value is **per clip** (it is that clip's own edit list)
 * AND **per sampler** (it must be exactly 0 whenever the `<video>` path ran, whose timestamps are
 * already correct). A single constant is wrong on two of the three test clips and on every
 * non-WebCodecs clip — strictly worse than leaving it at 0.
 *
 * So both facts are re-derived here from the clip's own bytes, using the same two predicates the
 * analysis run itself used: `resolveSamplingRobustnessConfig().sequentialSampling.enabled` and
 * `canUseSequentialDecode(blob)`. Both are pure functions of the blob and the environment, neither
 * of which changes between sampling and extraction in the same session, so the answer agrees with
 * what actually ran. (The alternative — surfacing the fact out of `useVideoAnalysis` onto the clip
 * session — needs a prop threaded through `MultiClipVideoSession`/`EvidenceGallery`; see this
 * module's ticket for why that seam was not taken here.)
 *
 * **Never mutates `robustFrames[].timestamp`.** That array is the sampling layer's own truth and is
 * correct in its own domain; this is a seek-time calibration and nothing else reads it.
 */

/** A Blob is stable for a clip's lifetime, so one derivation per clip is enough — and the gallery
 * legitimately re-runs extraction mid-session when the scale pass grafts `verticalOscillationCm`
 * in, which would otherwise pay for a second full demux to reach the same answer. */
const cache = new WeakMap<Blob, Promise<number>>()

/**
 * Seconds to SUBTRACT from a raw media-clock timestamp to land on the presentation clock, read off
 * a track's edit list — i.e. the media time that presentation time 0 maps to.
 *
 * Returns `0` for every edit list that is not a single constant shift, because nothing else can be
 * expressed as one number and a wrong number is worse than none:
 *
 * - **no `elst` at all** — the clocks already agree;
 * - **more than one entry** — the media→presentation map is piecewise, so one offset is right for
 *   at most the first segment;
 * - **an empty edit** (`mediaTime < 0`, a presentation gap backed by no media) — presentation 0
 *   maps to no media time at all;
 * - **a non-unity rate** — the map is a scale, not a shift.
 *
 * Ordinary single-entry unity-rate trims are the shape that actually occurs on real files, and are
 * the shape all three of this repo's test clips carry.
 */
export function editListSeekOffsetSeconds(track: ContainerVideoTrackTiming): number {
  if (track.elst.length !== 1) return 0
  const [entry] = track.elst
  if (entry.mediaTime <= 0 || !Number.isFinite(entry.mediaTime)) return 0
  if (track.mediaTimescaleHz <= 0 || !Number.isFinite(track.mediaTimescaleHz)) return 0
  // Same combining rule (and the same mp4box signed-half gotcha) as `containerTiming.ts`'s own
  // `elstEntryRate`; a rate that is not exactly 1 is a retime, not a trim.
  const rate = entry.mediaRateInteger + (entry.mediaRateFraction & 0xffff) / 65536
  if (Math.abs(rate - 1) > 1e-6) return 0
  return entry.mediaTime / track.mediaTimescaleHz
}

async function derive(blob: Blob): Promise<number> {
  // Cheapest and most conclusive first: with the sequential plane switched off, nothing ever
  // reaches the WebCodecs clock, so no container detail can matter.
  if (!resolveSamplingRobustnessConfig().sequentialSampling.enabled) return 0

  let probeBytes: ArrayBuffer
  try {
    probeBytes = await blob.arrayBuffer()
  } catch {
    return 0
  }
  const probe = await probeContainerTiming(probeBytes)
  if (probe.parseStatus !== 'ok') return 0
  const track = probe.videoTracks[0]
  if (track === undefined) return 0

  const offset = editListSeekOffsetSeconds(track)
  // The expensive gate is deliberately last: it is the only one that costs a full demux, and it is
  // only ever reachable on an MP4 that actually carries a shifting edit list. A clip with no
  // correction to make never pays for it.
  if (offset === 0) return 0
  if (!(await canUseSequentialDecode(blob))) return 0

  return -offset
}

/**
 * `0` unless this clip's frames were sampled through WebCodecs AND its container shifts the media
 * clock against the presentation clock — in which case the negative of that shift, so a planned
 * timestamp seeks to the frame the analysis actually measured.
 *
 * Never throws and never rejects: every failure to establish the two facts degrades to `0`, which
 * is the value that was correct before this existed.
 */
export function resolveEvidenceSeekOffsetSeconds(blob: Blob | null): Promise<number> {
  if (blob === null) return Promise.resolve(0)
  const cached = cache.get(blob)
  if (cached !== undefined) return cached
  const pending = derive(blob).catch(() => 0)
  cache.set(blob, pending)
  return pending
}
