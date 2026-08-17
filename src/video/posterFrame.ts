import { seekTo, waitForPresentedFrame } from './extractFrames'
import type { VideoMetadata } from './types'

/**
 * One still frame per clip, decoded once and held in memory for the session — the thing a clip
 * strip has to render before it can show a clip as anything but a number.
 *
 * Split the way the evidence path is split: the sizing and timestamp decisions are pure functions
 * with no DOM in them (`computePosterSize`, `choosePosterTimestamp`), and only `drawPosterFrame`
 * touches a context. jsdom ships no canvas and this repo refuses the `canvas` npm package
 * (`src/test/canvasTestUtils.ts`), so anything decidable has to be decidable without one.
 *
 * ### Never the visible element
 *
 * The clip's own `<video>` is the element the sampling loop reads frames off, and once analysis
 * reaches `phase: 'ready'` `useVideoAnalysis` re-arms it with `currentTime = 0`/`play()` so it is
 * replaying behind the results. Seeking it to grab a poster would corrupt an in-flight run or yank
 * the user's playback around. `deriveClipPoster` therefore mints its OWN detached element from
 * `sourceBlob` — a separate decoder with a separate object URL, holding no reference to the
 * canonical element — exactly as `extractClipEvidence` does, and for the same reason.
 *
 * ### One detached decoder at a time, process-wide
 *
 * `deriveClipPoster` is called once per clip by a per-clip hook, so nothing at the call site can
 * see the other clips — the caller-supplied array `extractSessionEvidence` loops over has no
 * analogue here. The ordering therefore lives INSIDE the derivation, on a module-level queue
 * (`posterQueue`): a second call cannot start its decoder until the first has torn its own down,
 * whoever makes it and whenever. That is the same "sequential by construction rather than by caller
 * convention" posture and the same reason — Demo 1 is 3840x2160 and Demo 2 is 2160x3840, and a
 * multi-file pick mounts every clip in one tick, so N concurrent 4K decoders is not an acceptable
 * amount of memory to hold, on top of the WebGL sampling run they would compete with.
 *
 * ### No serialization
 *
 * The poster is a `<canvas>`, never a data URL, blob or object URL, and it is never persisted. The
 * epic deliberately has no export path (see `EvidenceGallery.tsx`'s `EvidenceCanvas`); a renderer
 * adopts the node itself.
 */

/**
 * Cap on the longer side of a poster, in device pixels. A clip strip item is on the order of
 * 60-120 CSS px, so 240 covers it at 2x DPR with room to spare; a 4K clip is ~33 MB as a
 * full-resolution canvas and ~130 kB at this cap. The poster is never UPSCALED to reach it — it is
 * a cap, not a target — so display size stays the renderer's decision.
 */
export const POSTER_MAX_SIDE_PX = 240

/**
 * How far into the clip the poster frame is taken from, as a fraction of duration: the middle.
 *
 * Not zero: the first frame of a real clip is routinely a fade-in, a black leader, or the runner
 * not yet in shot, and a strip of black squares is worse than no strip. Not merely *near* the
 * start either — a running clip's opening second is the approach, where the subject is smallest,
 * furthest from camera, and often not yet in frame at all. The middle is where the runner is most
 * reliably present, largest, and mid-stride, which is what a thumbnail is for.
 *
 * A fraction rather than a constant so a very short clip does not land past a meaningful part of
 * itself; the midpoint is strictly inside any positive duration, so it can never reach the final
 * frame.
 */
export const POSTER_TIMESTAMP_FRACTION = 0.5

/**
 * The whole answer for a clip whose duration cannot be read at all (see `choosePosterTimestamps`),
 * in seconds. With no duration there is no midpoint to compute, so this is a fixed guess: far
 * enough in to clear a leader, near enough the start to be reachable in a clip of unknown length.
 *
 * Deliberately NOT a ceiling on the fraction above. Capping the midpoint would defeat it — the
 * middle of a 60 s clip is 30 s, and clamping that to 1 s would put every clip longer than two
 * seconds back at its opening, which is the outcome the fraction exists to avoid.
 */
export const POSTER_TIMESTAMP_FALLBACK_SECONDS = 1

/**
 * Bounded wait for the detached element to have decoded data. Same reasoning as the evidence
 * path's: the blob is local, so a clip that has not produced `loadeddata` inside this window is
 * broken rather than slow.
 */
export const POSTER_LOAD_TIMEOUT_MS = 10000

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — data for the current playback position is available. */
const HAVE_CURRENT_DATA = 2

/** Output dimensions in device pixels. Always a whole number of pixels, always at least 1. */
export interface PosterSize {
  width: number
  height: number
}

/**
 * A derived poster. `width`/`height` mirror the canvas's own dimensions at derivation time and
 * survive `releaseClipPoster` zeroing it, so a caller can keep reserving the right aspect ratio
 * for a box whose image has already been freed.
 */
export interface ClipPoster {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** The clip-media timestamp the frame was taken from, in seconds. Provenance only. */
  timestamp: number
}

export interface PosterDerivationOptions {
  /** Cap on the longer output side (see `POSTER_MAX_SIDE_PX`). */
  maxSidePx?: number
  /** Bounded wait for `loadeddata` on the detached element. */
  loadTimeoutMs?: number
  /** Bounded wait for the seek. A seek that exhausts it yields no poster. */
  seekTimeoutMs?: number
  /** Backstop on the post-seek presentation grace period. Exhausting it is not a failure. */
  presentationTimeoutMs?: number
}

/**
 * PURE. Fits a clip's intrinsic dimensions into a box of `maxSidePx` on the longer side, preserving
 * aspect ratio and never upscaling.
 *
 * `null` for dimensions that cannot describe an image — zero, negative, `NaN` or `Infinity`, all of
 * which a `<video>` genuinely reports before (and after a failed) load. Returning `null` rather than
 * clamping keeps "there is nothing to draw" a decision this function makes once, instead of a
 * 1x1 canvas the caller has to recognise later.
 *
 * The `Math.max(1, ...)` floor matters for extreme aspect ratios only: a 4000x3 source scales its
 * height to 0.18 px, and a zero-height canvas is not a thumbnail.
 */
export function computePosterSize(
  source: { width: number; height: number },
  maxSidePx: number = POSTER_MAX_SIDE_PX,
): PosterSize | null {
  const { width, height } = source
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < 1 || height < 1) return null
  if (!Number.isFinite(maxSidePx) || maxSidePx < 1) return null

  const scale = Math.min(1, maxSidePx / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * PURE. Which instants to try taking the poster from, in seconds, best first (see
 * `POSTER_TIMESTAMP_FRACTION`). Never empty; the caller draws at the first one it can reach.
 *
 * **A usable duration yields exactly one candidate**, the midpoint, strictly inside the clip: the
 * fraction is below 1, so it can never land on or past the final frame. There is deliberately no
 * fallback behind it — the position was computed from a duration the element reported, so a seek
 * that cannot reach it means the decoder is broken, and drawing frame 0 instead would substitute a
 * frame nobody asked for (`drawPosterFrame` yields no poster rather than a wrong one).
 *
 * **An unusable duration yields the fixed offset, then 0.** `null`, `NaN`, `Infinity`, zero and
 * negative are all things a `<video>` genuinely reports, and one of them is not an edge case at
 * all: a MediaRecorder WebM reports `duration: Infinity`, which `useVideoSource` copies verbatim
 * into `metadata.durationSec`. Clamping that to 0 would poster such a clip at its first frame,
 * which is the one outcome `POSTER_TIMESTAMP_FRACTION` exists to avoid (a fade-in, a black leader,
 * or the runner still walking back from the camera). With no duration there is no midpoint to
 * take, so the offset is a fixed guess rather than a computed position — and unlike the computed
 * case it therefore earns a fallback, because a clip shorter than the offset, or one whose blob
 * genuinely will not seek, should still get a thumbnail rather than none.
 */
export function choosePosterTimestamps(durationSec: number | null | undefined): number[] {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return [POSTER_TIMESTAMP_FALLBACK_SECONDS, 0]
  }
  return [durationSec * POSTER_TIMESTAMP_FRACTION]
}

/** Bounded wait for the element to hold decoded pixels. Resolves `false` on error or timeout. */
function waitForDecodedData(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  if (video.readyState >= HAVE_CURRENT_DATA) return Promise.resolve(true)
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
    }
    const onLoaded = () => {
      cleanup()
      resolve(true)
    }
    const onError = () => {
      cleanup()
      resolve(false)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('error', onError)
  })
}

/**
 * Seeks to the first candidate that can actually be reached and returns it, or `null` if none can.
 * Sequential and short-circuiting: a candidate that lands is drawn, and the ones behind it are
 * never seeked to, so the single-candidate case costs exactly what one seek always cost.
 */
async function seekToFirstReachable(
  video: HTMLVideoElement,
  candidates: number[],
  options: PosterDerivationOptions,
): Promise<number | null> {
  for (const candidate of candidates) {
    const outcome = await seekTo(video, candidate, options.seekTimeoutMs)
    if (outcome === 'timed-out') continue
    // `'already-there'` skips the wait rather than shortening it: no seek means no new frame is
    // coming, so every arm but the backstop is dead and waiting could only burn the timeout.
    if (outcome === 'seeked') {
      await waitForPresentedFrame(video, options.presentationTimeoutMs)
    }
    return candidate
  }
  return null
}

/**
 * The IMPURE half, against a `<video>` the CALLER owns and has already loaded — the same shape as
 * `extractPlannedFrames`. It decides nothing: the size and the timestamps both come from the pure
 * functions above.
 *
 * `null` when the size is undecidable, no candidate instant could be reached, or the browser has no
 * 2D context. A poster is optional everywhere it is consumed, so every failure is a `null`, never a
 * throw.
 */
export async function drawPosterFrame(
  video: HTMLVideoElement,
  metadata: VideoMetadata,
  options: PosterDerivationOptions = {},
): Promise<ClipPoster | null> {
  const size = computePosterSize(metadata, options.maxSidePx ?? POSTER_MAX_SIDE_PX)
  if (size === null) return null

  const timestamp = await seekToFirstReachable(
    video,
    choosePosterTimestamps(metadata.durationSec),
    options,
  )
  if (timestamp === null) return null

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  // Whole frame into the whole canvas: `computePosterSize` already preserved the aspect ratio, so
  // this scales without cropping and the renderer never has to undo a crop it did not ask for.
  ctx.drawImage(video, 0, 0, size.width, size.height)

  return { canvas, width: size.width, height: size.height, timestamp }
}

/**
 * Tail of the process-wide poster queue (see the module doc's "One detached decoder at a time").
 * Always settled or pending — never rejected, so one failed derivation cannot wedge the queue for
 * every clip behind it.
 */
let posterQueue: Promise<unknown> = Promise.resolve()

/**
 * One clip, one detached decoder, torn down before returning.
 *
 * The object URL is minted from `sourceBlob` and revoked here. `useVideoSource` keeps its own
 * private object URL for the canonical element; that one is never reused and never revoked from
 * here. Blob URLs inherit the document's origin, so the canvas is never tainted.
 */
async function decodePosterFrame(
  sourceBlob: Blob,
  metadata: VideoMetadata,
  options: PosterDerivationOptions,
): Promise<ClipPoster | null> {
  const url = URL.createObjectURL(sourceBlob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  video.load()

  try {
    const ready = await waitForDecodedData(
      video,
      options.loadTimeoutMs ?? POSTER_LOAD_TIMEOUT_MS,
    )
    if (!ready) return null
    return await drawPosterFrame(video, metadata, options)
  } finally {
    // Drop the decoder before the URL: revoking first leaves the element holding a reference to a
    // now-unresolvable blob.
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/**
 * Derives one clip's poster, **strictly after every derivation already asked for**.
 *
 * The wait is imposed here rather than asked of callers: `useClipPoster` is mounted once per clip
 * and cannot see the other clips, so a picked-4-files session fires four of these in a single
 * microtask flush with nothing between them. Chaining onto a module-level tail makes "one detached
 * decoder exists at a time" a property of this function instead of a convention every future call
 * site has to know about — the same guarantee `extractSessionEvidence` gets from its `for await`
 * loop, reached the only way an N-caller API can reach it.
 *
 * A queued derivation is not cancellable, and deliberately so: it is bounded by its own load, seek
 * and presentation timeouts, and `useClipPoster` already releases a poster that lands after its
 * clip is gone. Cancellation would add a second way for the queue to be left holding a decoder.
 *
 * Nothing-to-do calls (no bytes, no metadata) resolve `null` immediately WITHOUT taking a place in
 * the queue — they open no decoder, so making them wait behind one would be pure latency.
 */
export function deriveClipPoster(
  sourceBlob: Blob | null,
  metadata: VideoMetadata | null,
  options: PosterDerivationOptions = {},
): Promise<ClipPoster | null> {
  if (sourceBlob === null || metadata === null) return Promise.resolve(null)

  const derivation = posterQueue.then(() => decodePosterFrame(sourceBlob, metadata, options))
  // The tail swallows outcomes on purpose. `decodePosterFrame` resolves `null` rather than throwing
  // on every failure it knows about, but an unforeseen throw must still not leave `posterQueue`
  // rejected — every later clip chains off it, and they would all reject without ever decoding.
  posterQueue = derivation.then(
    () => undefined,
    () => undefined,
  )
  return derivation
}

/**
 * Frees a poster's backing store. Zeroing the dimensions drops the pixels immediately instead of
 * waiting for the element itself to be collected, which matters because a poster is reachable from
 * session state that several components hold at once — the last reference to drop is not knowable
 * from any one of them.
 *
 * Idempotent, and safe on `null`: the poster's owner (`useClipPoster`) and the session that removes
 * the clip both call it, deliberately, rather than either one relying on the other's timing.
 *
 * A released poster must not be rendered — `width`/`height` survive, the pixels do not.
 */
export function releaseClipPoster(poster: ClipPoster | null | undefined): void {
  if (!poster) return
  poster.canvas.width = 0
  poster.canvas.height = 0
}
