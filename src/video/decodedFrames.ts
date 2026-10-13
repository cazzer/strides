import type { ContainerVideoTrackTiming } from './containerTiming'
import type { DemuxedTrack } from './mp4Demux'
import { borrowClipDemux, probeClipContainerTiming } from './clipBytesCache'
import { canUseSequentialDecode } from './webCodecsSupport'
import { resolveSamplingRobustnessConfig } from '../results/samplingRobustnessConfig'

/**
 * Still frames out of a clip through ONE forward `VideoDecoder` pass, as a replacement for seeking
 * a detached `<video>` to each of them (`strides-6i6.4`). Two consumers: evidence images
 * (`extractFrames.ts`) and clip-strip posters (`posterFrame.ts`).
 *
 * ### Why a forward pass is cheaper than seeks
 *
 * A `<video>` seek cannot start decoding at the frame it wants. It restarts at the keyframe before
 * the target and decodes forward, every time — and the demo clips are encoded with very long GOPs:
 * `park-side-landscape.mp4` has exactly ONE keyframe in 233 frames of 4K, so a seek to its midpoint
 * decodes ~116 4K frames, and an evidence plan of ~15 distinct targets decodes the opening of the
 * clip ~15 times over. A forward pass decodes each frame it needs at most once per pass, from the
 * keyframe before the earliest wanted frame to the latest one.
 *
 * ### "The same frame" is decided here, in the `<video>` element's own terms
 *
 * Both consumers already decide an instant as a `currentTime` — a PRESENTATION-clock seek target —
 * and they must keep getting the frame that seek shows, which is not always the frame the target
 * names. `frameShownAt` reproduces what the element does, measured rather than assumed:
 *
 * - Chromium truncates `t` to whole microseconds (`strides-5t4`) and places each frame at its media
 *   composition time minus the edit list's shift (all four corpus clips, `strides-09b`).
 * - After a paused seek it shows the FIRST frame, in presentation order, whose END — its start plus
 *   its OWN sample duration from the `stts` table — lies after `t`. On a constant-rate track that is
 *   the frame whose interval contains `t`. On `park-side-portrait.mp4` it is not: that clip's ten
 *   1536-tick samples sit on frames whose presentation neighbours are 512 ticks away, so each one
 *   "covers" the two frames after it and a seek into either shows the long frame instead.
 *   Measured over all 345 frames of that clip (a seek to every frame's midpoint, matched by pixels
 *   against every decoded frame): the containment model disagreed on exactly those 10 seeks, in
 *   5 adjacent pairs, each showing the long frame before it; this model agrees on all 345.
 *
 * Anything this module cannot state with that confidence — an edit list that is not one plain
 * shift, a target within two microseconds of a deciding frame end, a target past the edit's end — is
 * answered `null`, and the consumer keeps its seek path. A wrong frame is never the price of a
 * faster one.
 *
 * Pixels are the CALLER's job and are not decided here: each consumer draws the delivered
 * `VideoFrame` through exactly the `drawImage` call it used to make with the `<video>`.
 */

const MICROSECONDS_PER_SECOND = 1_000_000

/** Chunks handed to the decoder before it has consumed them. Same bound, same reason, as
 * `sequentialFrameSource.ts`: no buffering ahead, just enough slack for the round trip. */
const MAX_DECODE_QUEUE_SIZE = 2

/** A frame's position on the decoder's own clock: the chunk timestamp `sequentialFrameSource.ts`
 * and this module both hand `EncodedVideoChunk`, which `VideoFrame.timestamp` echoes back. */
export function sampleTimestampUs(ptsSec: number): number {
  return Math.round(ptsSec * MICROSECONDS_PER_SECOND)
}

/**
 * PURE. Seconds to subtract from a media-clock timestamp to put it on the presentation clock, or
 * `null` when the edit list is anything this module will not claim to reproduce.
 *
 * Narrower than `evidenceSeekOffset.ts`'s `editListSeekOffsetSeconds` on purpose: that one answers
 * "how far apart are the two clocks, if it is one number" and says `0` for everything else, which
 * is the right fallback for a seek. Here `0` would be a CLAIM that the clocks agree, so every shape
 * other than "no edit list" or "one entry, a plain shift at unity rate" is `null` instead.
 */
export function presentationShiftSeconds(timing: ContainerVideoTrackTiming): number | null {
  if (!(timing.mediaTimescaleHz > 0) || !Number.isFinite(timing.mediaTimescaleHz)) return null
  if (timing.elst.length === 0) return 0
  if (timing.elst.length !== 1) return null
  const [entry] = timing.elst
  if (!Number.isFinite(entry.mediaTime) || entry.mediaTime < 0) return null
  // Same 16.16 combining rule (and mp4box signed-half gotcha) as `containerTiming.ts`.
  const rate = entry.mediaRateInteger + (entry.mediaRateFraction & 0xffff) / 65536
  if (Math.abs(rate - 1) > 1e-6) return null
  return entry.mediaTime / timing.mediaTimescaleHz
}

/**
 * PURE. The end of the presented timeline, in seconds, or `null` when the container does not
 * state one. A target at or past it is one the element would clamp, and the frame a clamped seek
 * shows is not something this module models.
 */
export function presentationEndSeconds(
  timing: ContainerVideoTrackTiming,
  track: Pick<DemuxedTrack, 'durationSec'>,
  shiftSeconds: number,
): number | null {
  if (timing.elst.length === 1) {
    const { segmentDuration } = timing.elst[0]
    if (!(timing.movieTimescaleHz > 0) || !(segmentDuration > 0)) return null
    return segmentDuration / timing.movieTimescaleHz
  }
  const end = track.durationSec - shiftSeconds
  return Number.isFinite(end) && end > 0 ? end : null
}

/**
 * The frames of a track on the presentation clock, in presentation order, ready for
 * `frameShownAt`. `endsUs[i]` is frame `i`'s start plus its OWN sample duration — not the next
 * frame's start, which is what makes the two differ on a variable-rate track (see the module doc).
 * `keysUs[i]` is its decoder timestamp (`sampleTimestampUs`).
 */
export interface PresentationTimeline {
  startsUs: number[]
  endsUs: number[]
  keysUs: number[]
  endSec: number
}

/** PURE. Builds the timeline `frameShownAt` reads. `null` for a track with no frames. */
export function presentationTimeline(
  track: Pick<DemuxedTrack, 'samples'>,
  shiftSeconds: number,
  endSec: number,
): PresentationTimeline | null {
  if (track.samples.length === 0) return null
  const frames = track.samples
    .map((sample) => {
      // Placed on the presentation clock and rescaled to whole microseconds rounding to nearest
      // (`av_rescale_q`). The end is the rounded start plus the separately rounded duration — a
      // timestamp and a duration are converted one at a time, so their sum can sit a microsecond
      // off the rounded true end. `BOUNDARY_GUARD_US` absorbs either reading.
      const startUs = Math.round((sample.ptsSec - shiftSeconds) * MICROSECONDS_PER_SECOND)
      return {
        startUs,
        endUs: startUs + Math.round(sample.durationSec * MICROSECONDS_PER_SECOND),
        keyUs: sampleTimestampUs(sample.ptsSec),
      }
    })
    .sort((a, b) => a.startUs - b.startUs)
  return {
    startsUs: frames.map((frame) => frame.startUs),
    endsUs: frames.map((frame) => frame.endUs),
    keysUs: frames.map((frame) => frame.keyUs),
    endSec,
  }
}

/**
 * How close a target may come to a deciding frame end before `frameShownAt` declines to answer.
 * Two microseconds cover the target's truncation plus either reading of the end's rounding (see
 * `presentationTimeline`); a target that close is one where a microsecond's disagreement with the
 * browser changes the frame, so it is left to the seek path.
 *
 * Evidence targets sit mid-frame by design (half a frame added), so they never come near it. A
 * poster's midpoint does, on a constant-rate clip with an EVEN frame count: the middle of the clip
 * is then a frame boundary, and that poster is left to the seek path — measured on `IMG_9116`
 * (526 frames), whose seek there is exactly the ambiguous case this guard exists for.
 */
const BOUNDARY_GUARD_US = 2

/**
 * PURE. The decoder timestamp of the frame a paused `<video>` shows after `currentTime = targetSec`,
 * or `null` where that is not certain (see the module doc): the first frame in presentation order
 * whose end lies after the truncated target.
 *
 * `targetSec` is taken AFTER any clamping the caller applies — this models the element's frame
 * choice, not the caller's arithmetic. A target at or past the presented end is refused rather than
 * modelled: what a clamped seek shows is not something this module has measured.
 */
export function frameShownAt(timeline: PresentationTimeline, targetSec: number): number | null {
  if (!Number.isFinite(targetSec) || targetSec < 0) return null
  if (targetSec >= timeline.endSec) return null
  const targetUs = Math.trunc(targetSec * MICROSECONDS_PER_SECOND)
  const { endsUs, keysUs } = timeline
  for (let index = 0; index < endsUs.length; index += 1) {
    const end = endsUs[index]
    // Every frame passed over and the one chosen are each decided by its end against the target,
    // so each of those comparisons has to be clear of the rounding band.
    if (Math.abs(end - targetUs) <= BOUNDARY_GUARD_US) return null
    if (end > targetUs) return keysUs[index]
  }
  return null
}

/** How one forward pass ended. `'failed'` covers every reason a wanted frame did not arrive, and is
 * the caller's cue to fall back to its seek path. */
export type DecodePassOutcome = 'completed' | 'aborted' | 'failed'

export interface DecodePassOptions {
  signal?: AbortSignal
  /**
   * The longest the pass waits for the decoder to make ANY progress (consume a chunk or emit a
   * frame) before giving up as `'failed'`. A stall is not a hang: the caller's seek path still
   * runs, bounded by its own timeouts.
   */
  stallTimeoutMs: number
}

/**
 * PURE. The decode-order slice `[start, end]` a pass must feed so every wanted frame is output:
 * from the keyframe at or before the earliest wanted sample, stepping back a further keyframe
 * whenever a wanted frame PRESENTS before that keyframe (an open-GOP leading picture, which may
 * reference the previous group), through the latest wanted sample. `null` when a wanted timestamp
 * is not a sample of this track, or no keyframe precedes it.
 */
export function decodeRange(
  track: Pick<DemuxedTrack, 'samples'>,
  wantedUs: ReadonlySet<number>,
): { start: number; end: number } | null {
  if (wantedUs.size === 0) return null
  const { samples } = track
  let first = -1
  let end = -1
  let earliestWantedPts = Infinity
  const found = new Set<number>()
  samples.forEach((sample, index) => {
    const key = sampleTimestampUs(sample.ptsSec)
    if (!wantedUs.has(key)) return
    found.add(key)
    if (first === -1) first = index
    end = index
    if (sample.ptsSec < earliestWantedPts) earliestWantedPts = sample.ptsSec
  })
  if (found.size !== wantedUs.size) return null
  let start = first
  while (start >= 0 && !samples[start].isKeyframe) start -= 1
  while (start > 0 && earliestWantedPts < samples[start].ptsSec) {
    start -= 1
    while (start >= 0 && !samples[start].isKeyframe) start -= 1
  }
  if (start < 0) return null
  return { start, end }
}

/**
 * Decodes `track` forward once and hands every frame whose timestamp is in `wantedUs` to `onFrame`,
 * synchronously, inside the decoder's own output callback — then closes it. Every other frame is
 * closed the moment it arrives, so at most one decoded frame is ever held by this module, the same
 * discipline as `sequentialFrameSource.ts`.
 *
 * `onFrame` must not keep the frame: it is closed as soon as `onFrame` returns. A throw from it
 * ends the pass as `'failed'`.
 *
 * Resolves `'completed'` only when EVERY wanted frame was delivered. Never rejects.
 */
export async function decodeFramesForward(
  track: DemuxedTrack,
  wantedUs: ReadonlySet<number>,
  onFrame: (frame: VideoFrame, timestampUs: number) => void,
  options: DecodePassOptions,
): Promise<DecodePassOutcome> {
  if (typeof VideoDecoder === 'undefined') return 'failed'
  if (options.signal?.aborted) return 'aborted'
  const range = decodeRange(track, wantedUs)
  if (range === null) return 'failed'

  const delivered = new Set<number>()
  let outcome: DecodePassOutcome | null = null
  let wake: (() => void) | null = null
  const notify = () => {
    const resolve = wake
    wake = null
    resolve?.()
  }

  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const armStallTimer = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      if (outcome === null) outcome = 'failed'
      notify()
    }, options.stallTimeoutMs)
  }

  let decoder: VideoDecoder
  try {
    decoder = new VideoDecoder({
      output: (frame) => {
        try {
          armStallTimer()
          if (outcome !== null) return
          if (options.signal?.aborted) {
            outcome = 'aborted'
            return
          }
          const key = frame.timestamp
          if (!wantedUs.has(key) || delivered.has(key)) return
          delivered.add(key)
          onFrame(frame, key)
        } catch {
          outcome = 'failed'
        } finally {
          frame.close()
          notify()
        }
      },
      error: () => {
        if (outcome === null) outcome = 'failed'
        notify()
      },
    })
    decoder.configure({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
      ...(track.description ? { description: track.description } : {}),
    })
  } catch {
    return 'failed'
  }

  const onAbort = () => {
    if (outcome === null) outcome = 'aborted'
    notify()
  }
  options.signal?.addEventListener('abort', onAbort)
  const onDequeue = () => {
    armStallTimer()
    notify()
  }
  decoder.addEventListener('dequeue', onDequeue)
  const isClosed = () => decoder.state === 'closed'

  try {
    armStallTimer()
    for (let index = range.start; index <= range.end; index += 1) {
      while (outcome === null && !isClosed() && decoder.decodeQueueSize >= MAX_DECODE_QUEUE_SIZE) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      if (outcome !== null || isClosed()) break
      const sample = track.samples[index]
      decoder.decode(
        new EncodedVideoChunk({
          type: sample.isKeyframe ? 'key' : 'delta',
          timestamp: sampleTimestampUs(sample.ptsSec),
          duration: Math.round(sample.durationSec * MICROSECONDS_PER_SECOND),
          data: sample.data,
        }),
      )
    }
    if (outcome === null && !isClosed()) {
      // Flush emits the frames the decoder is still holding for reordering. Raced against the
      // stall timer and the abort, either of which settles `outcome` without the flush settling.
      const flushed = decoder.flush().then(
        () => undefined,
        () => {
          if (outcome === null) outcome = 'failed'
        },
      )
      await Promise.race([
        flushed,
        new Promise<void>((resolve) => {
          const poll = () => {
            if (outcome !== null) resolve()
            else wake = poll
          }
          poll()
        }),
      ])
    }
  } catch {
    if (outcome === null) outcome = 'failed'
  } finally {
    clearTimeout(stallTimer)
    options.signal?.removeEventListener('abort', onAbort)
    decoder.removeEventListener('dequeue', onDequeue)
    if (!isClosed()) decoder.close()
  }

  if (outcome !== null) return outcome
  return delivered.size === wantedUs.size ? 'completed' : 'failed'
}

/** Everything a consumer needs to turn `currentTime` targets into delivered frames for one clip. */
export interface DecodedFrameSource {
  track: DemuxedTrack
  timeline: PresentationTimeline
}

/**
 * Opens the clip for forward decoding, or `null` where the seek path must keep doing the job. Every
 * gate is one the analysis run already answered for this blob, or a fact this module will not
 * guess at:
 *
 * - the sequential sampling plane is switched off — then no analysis pass ever asked
 *   `canUseSequentialDecode`, and asking it here would demux the clip into a cache entry no pass
 *   would ever release;
 * - `canUseSequentialDecode` says no — a WebM, a rotated phone capture (`VideoDecoder` paints coded
 *   frames unrotated where `<video>` applies the matrix), an unsupported codec, an oversized blob;
 * - the container does not parse, or its edit list is not one plain shift
 *   (`presentationShiftSeconds`), or it states no presentation end.
 *
 * Never rejects: every failure is a `null`.
 */
export async function openDecodedFrameSource(blob: Blob): Promise<DecodedFrameSource | null> {
  try {
    if (typeof VideoDecoder === 'undefined') return null
    if (!resolveSamplingRobustnessConfig().sequentialSampling.enabled) return null
    if (!(await canUseSequentialDecode(blob))) return null
    const probe = await probeClipContainerTiming(blob)
    if (probe.parseStatus !== 'ok') return null
    const timing = probe.videoTracks[0]
    if (timing === undefined) return null
    const shift = presentationShiftSeconds(timing)
    if (shift === null) return null
    const track = await borrowClipDemux(blob)
    const end = presentationEndSeconds(timing, track, shift)
    if (end === null) return null
    const timeline = presentationTimeline(track, shift, end)
    if (timeline === null) return null
    return { track, timeline }
  } catch {
    return null
  }
}
