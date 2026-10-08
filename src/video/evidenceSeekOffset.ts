import type { ContainerTimingProbe, ContainerVideoTrackTiming } from './containerTiming'
import { probeClipContainerTiming } from './clipBytesCache'
import { canUseSequentialDecode } from './webCodecsSupport'
import { resolveSamplingRobustnessConfig } from '../results/samplingRobustnessConfig'

/**
 * Resolves the seek-time calibration for one clip — the two numbers `extractFrames.ts` adds to a
 * planned timestamp before seeking a detached `<video>`.
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
 * ### `media_time` is a CLOCK OFFSET, never a count of frames the edit removed (`strides-09b`)
 *
 * Stated because reading it the other way filed a P1 against this file, and the wrong reading is
 * self-confirming. Every clip in this repo's corpus carries a `ctts` box and an `elst` whose
 * `media_time` equals the **composition timestamp of the first presented picture** exactly (512 on
 * both 15360-timescale side clips and the multi-person fixture, 1024 on the portrait clip, 2002 on
 * `park-approach.mp4`). That is the ordinary B-frame priming edit: it cancels the reorder depth so
 * presentation starts at zero. **No picture precedes it and none is discarded** — the file has the
 * same frame count either way.
 *
 * So ffmpeg's `select='eq(n,N)'` index, which counts coded pictures, puts frame `N` at composition
 * time `(media_time + N·Δ)/timescale` and presentation time `N·Δ/timescale`. Counting `media_time`
 * as leading frames removed mis-numbers every picture in the file by exactly the quantity this
 * module subtracts, so a correct conversion then reads as an error of that same size in the
 * opposite direction. Note also that `select='eq(n,183)'` reports `pts_time 3.05` — that frame's
 * PRESENTATION time; its composition time is `3.083333`, which is what the sampler reports.
 *
 * Re-verified on the whole corpus with a pure-Chromium seek probe (no app involved): 31 seeks over
 * 4 clips, each target predicted two frames apart under "edit list applied" vs "media clock", PSNR
 * argmax against ffmpeg-reconstructed candidates. **Not one matched the media clock.** See
 * `openspec/changes/pin-the-evidence-seek-clock-conversion/design.md`.
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
 * session — needs a prop threaded through `MultiClipVideoSession`/`useSessionEvidence`; see this
 * module's ticket for why that seam was not taken here.)
 *
 * ### The second term: half a frame (`strides-5t4`)
 *
 * A frame's presentation timestamp is frequently **not representable in the seek API**. Chromium
 * quantises `currentTime` to integer microseconds — measured, not assumed: assigning
 * `3.049999666666667` reads back `3.049999`, so the conversion TRUNCATES. At 60 fps on a 15360
 * timescale a frame boundary lands on a whole microsecond only when its index is a multiple of 3,
 * so two thirds of this corpus's boundaries cannot be asked for at all, and every one of the
 * remaining targets is one truncated ulp away from falling into the previous frame.
 *
 * `currentTime = t` displays the frame whose presentation interval CONTAINS `t`, so the middle of
 * that interval is the semantically correct request rather than a fudge — and it is robust to the
 * microsecond lattice, to the rounding mode (it is correct under truncation AND under
 * round-to-nearest), and to the sub-microsecond truncation the sampler's own timestamps carry. It
 * absorbs half a frame of error where targeting the boundary absorbs none.
 *
 * The two terms stay separate rather than being summed into one number. The edit-list shift is a
 * CLOCK CONVERSION — per clip and per sampler, zero whenever the `<video>` path ran. The midpoint
 * is a TARGETING POLICY — per clip only, and correct on every sampler, because the quantisation is
 * a property of `HTMLVideoElement.currentTime` and not of whatever produced the timestamp.
 *
 * **Never mutates `robustFrames[].timestamp`.** That array is the sampling layer's own truth and is
 * correct in its own domain; this is a seek-time calibration and nothing else reads it. Which is
 * the whole reason the midpoint is reached this way: it moves the pixels an image is drawn from
 * without moving a single number any metric was computed from.
 */

/** Both seek-time terms for one clip, in seconds. Added to a planned timestamp at seek time and
 * nowhere else. */
export interface EvidenceSeekCalibration {
  /** Media→presentation clock conversion, or `0` where the two already agree. */
  readonly offsetSeconds: number
  /** Half a frame, or `0` where the clip's frame duration is not derivable. */
  readonly midpointOffsetSeconds: number
}

const NO_CALIBRATION: EvidenceSeekCalibration = {
  offsetSeconds: 0,
  midpointOffsetSeconds: 0,
}

/** A Blob is stable for a clip's lifetime, so one derivation per clip is enough — and the session
 * evidence pass legitimately re-runs extraction mid-session when the scale pass grafts
 * `verticalOscillationCm` in, which would otherwise re-derive the same answer. */
const cache = new WeakMap<Blob, Promise<EvidenceSeekCalibration>>()

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
 * Ordinary single-entry unity-rate shifts are the shape that actually occurs on real files, and are
 * the shape every clip in this repo's corpus carries. They are **shifts and not trims** — see the
 * module doc; the arithmetic here is the same either way, because an edit list defines presentation
 * time within a segment as `(sample composition time − media_time) / timescale` whether or not any
 * sample precedes `media_time`, but the name decides whether a reader can number frames correctly.
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

/**
 * Half of one nominal frame's duration, in seconds — the distance from a frame's presentation
 * boundary to the middle of its interval.
 *
 * `0` for any track whose frame duration is not derivable (`nominalFps` is `null` when the track
 * carries no usable `stts` table), and for a rate that is not a positive finite number. Same "a
 * wrong number is worse than none" posture `editListSeekOffsetSeconds` takes: zero is exactly the
 * behaviour that shipped before this existed, so declining costs nothing that was already working.
 *
 * ### Precondition: the median frame duration must also be the SHORTEST one
 *
 * `nominalFps` is a weighted MEDIAN across the `stts` run-length table, not a minimum, so on a
 * variable-frame-rate track this returns half of a TYPICAL frame rather than half of the frame
 * being sought. Landing inside the target interval is only guaranteed while every frame is at
 * least as long as the median — i.e. while the median IS the minimum. Invert the mixture and the
 * offset overshoots: a track that is mostly 1536-tick frames with a minority at 512, on a 15360
 * timescale, yields a ~50 ms midpoint against a short frame's whole 33.3 ms interval, so every
 * instant naming a short frame silently draws the frame AFTER it. That failure produces a
 * plausible image rather than a crash, which is why it is stated here rather than only in the
 * design that derived it.
 *
 * It holds across this repo's corpus — the only variable-rate clip, `park-side-portrait.mp4`, is
 * 335 samples at 512 ticks against 10 at 1536 across 21 runs, so its median is also its minimum.
 * Enforcing it rather than documenting it would need the per-run `stts` deltas, which
 * `ContainerVideoTrackTiming` does not carry; exposing them widens the container probe's public
 * shape for this one caller.
 */
export function frameMidpointOffsetSeconds(track: ContainerVideoTrackTiming): number {
  const fps = track.nominalFps
  if (fps === null || !Number.isFinite(fps) || fps <= 0) return 0
  return 1 / fps / 2
}

/**
 * The media→presentation shift, or `0` where it does not apply. Split out because the midpoint
 * must NOT inherit these gates: `sequentialSampling` and `canUseSequentialDecode` decide which
 * CLOCK a timestamp is on, and the microsecond lattice the midpoint answers to is a property of
 * the seek API that every clip on every sampler meets.
 */
async function deriveEditListOffset(
  blob: Blob,
  track: ContainerVideoTrackTiming,
): Promise<number> {
  // With the sequential plane switched off, nothing ever reaches the WebCodecs clock, so no
  // container detail can matter.
  if (!resolveSamplingRobustnessConfig().sequentialSampling.enabled) return 0
  const offset = editListSeekOffsetSeconds(track)
  // Deliberately last. The analysis run already asked this exact question of this Blob, so it is
  // answered from `canUseSequentialDecode`'s per-Blob memo — but a clip with no correction to make
  // still has no reason to ask at all.
  if (offset === 0) return 0
  if (!(await canUseSequentialDecode(blob))) return 0
  return -offset
}

async function derive(blob: Blob): Promise<EvidenceSeekCalibration> {
  // The probe now runs FIRST, where the `sequentialSampling` early return used to sit: the frame
  // duration is only reachable through it, and the midpoint needs that whatever the sampler was.
  // On the WebCodecs path the analysis run's demux already took this probe from the same bytes
  // (`clipBytesCache.ts`), so this reads nothing; any other clip pays one read and one parse here.
  let probe: ContainerTimingProbe
  try {
    probe = await probeClipContainerTiming(blob)
  } catch {
    return NO_CALIBRATION
  }
  if (probe.parseStatus !== 'ok') return NO_CALIBRATION
  const track = probe.videoTracks[0]
  if (track === undefined) return NO_CALIBRATION

  return {
    offsetSeconds: await deriveEditListOffset(blob, track),
    midpointOffsetSeconds: frameMidpointOffsetSeconds(track),
  }
}

/**
 * This clip's two seek-time terms.
 *
 * `offsetSeconds` is `0` unless the clip's frames were sampled through WebCodecs AND its container
 * shifts the media clock against the presentation clock. `midpointOffsetSeconds` is `0` unless the
 * container names a frame rate. Both are `0` for every blob whose container does not parse — every
 * WebM and every webcam recording — which is the behaviour that was correct before either existed.
 *
 * Never throws and never rejects: every failure to establish a fact degrades to `0`.
 */
export function resolveEvidenceSeekCalibration(
  blob: Blob | null,
): Promise<EvidenceSeekCalibration> {
  if (blob === null) return Promise.resolve(NO_CALIBRATION)
  const cached = cache.get(blob)
  if (cached !== undefined) return cached
  const pending = derive(blob).catch(() => NO_CALIBRATION)
  cache.set(blob, pending)
  return pending
}
