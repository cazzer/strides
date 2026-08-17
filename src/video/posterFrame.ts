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
 * How far into the clip the poster frame is taken from, as a fraction of duration. Not zero: the
 * first frame of a real clip is routinely a fade-in, a black leader, or the runner not yet in
 * shot, and a strip of black squares is worse than no strip. A fraction rather than a constant so
 * a very short clip does not land past a meaningful part of itself.
 */
export const POSTER_TIMESTAMP_FRACTION = 0.1

/**
 * Ceiling on the above, in seconds. On a long clip 10% is minutes in, which is both slow to seek
 * to and no more representative than the opening second.
 */
export const POSTER_TIMESTAMP_MAX_SECONDS = 1

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
 * PURE. Which instant to take the poster from, in seconds (see `POSTER_TIMESTAMP_FRACTION`).
 *
 * Always strictly inside the clip: the fraction is below 1, so the result can never land on or past
 * the final frame, and an unusable duration (`null`, `NaN`, `Infinity`, zero or negative — every
 * one of which a `<video>` can report) falls back to 0, which is always seekable.
 */
export function choosePosterTimestamp(durationSec: number | null | undefined): number {
  if (durationSec == null) return 0
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0
  return Math.min(durationSec * POSTER_TIMESTAMP_FRACTION, POSTER_TIMESTAMP_MAX_SECONDS)
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
 * The IMPURE half, against a `<video>` the CALLER owns and has already loaded — the same shape as
 * `extractPlannedFrames`. It decides nothing: the size and the timestamp both come from the pure
 * functions above.
 *
 * `null` when the size is undecidable, the seek never completed, or the browser has no 2D context.
 * A poster is optional everywhere it is consumed, so every failure is a `null`, never a throw.
 */
export async function drawPosterFrame(
  video: HTMLVideoElement,
  metadata: VideoMetadata,
  options: PosterDerivationOptions = {},
): Promise<ClipPoster | null> {
  const size = computePosterSize(metadata, options.maxSidePx ?? POSTER_MAX_SIDE_PX)
  if (size === null) return null

  const timestamp = choosePosterTimestamp(metadata.durationSec)
  const outcome = await seekTo(video, timestamp, options.seekTimeoutMs)
  if (outcome === 'timed-out') return null
  // `'already-there'` skips the wait rather than shortening it: no seek means no new frame is
  // coming, so every arm but the backstop is dead and waiting could only burn the timeout.
  if (outcome === 'seeked') {
    await waitForPresentedFrame(video, options.presentationTimeoutMs)
  }

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
 * One clip, one detached decoder, torn down before returning.
 *
 * The object URL is minted from `sourceBlob` and revoked here. `useVideoSource` keeps its own
 * private object URL for the canonical element; that one is never reused and never revoked from
 * here. Blob URLs inherit the document's origin, so the canvas is never tainted.
 */
export async function deriveClipPoster(
  sourceBlob: Blob | null,
  metadata: VideoMetadata | null,
  options: PosterDerivationOptions = {},
): Promise<ClipPoster | null> {
  if (sourceBlob === null || metadata === null) return null

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
