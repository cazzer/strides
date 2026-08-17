import type { MetricId } from '../heuristics/types'
import type {
  ClipEvidencePlan,
  EvidenceFramePlan,
  EvidenceInstantPlan,
  EvidenceUnavailableReason,
  MetricEvidencePlan,
} from '../results/evidenceFrames'
import { evidenceOutputSide } from '../results/evidenceFrames'
import { planEvidenceAnnotations } from '../results/evidenceAnnotations'
import { drawEvidenceAnnotation } from './drawEvidenceAnnotations'

/**
 * The IMPURE half of evidence-frame extraction: take the plan `evidenceFrames.ts` produced and
 * actually produce images. Seek a detached `<video>` to each planned instant, draw only the
 * planned crop rect into a canvas, and composite a ghost over its base at the planned opacities.
 *
 * **This module decides nothing.** Which frame, which rectangle and which opacity are all read
 * straight off the plan; the only numbers chosen here are the ones the plan deliberately left
 * downstream (output canvas size) and the ones that bound a hang (timeouts). If a change here
 * starts picking a timestamp or a rectangle, it belongs in `evidenceFrames.ts` instead.
 *
 * **Never the visible element.** `useVideoAnalysis` re-arms the canonical `<video>` with
 * `muted`/`loop`/`currentTime = 0`/`play()` the moment a run reaches `phase: 'ready'`, so the clip
 * is actively replaying behind the results while this runs. Seeking it would yank the user's
 * playback around. (The retired pre-analysis quality gate did seek the visible element, but that
 * ran *before* the user could interact with playback — the justification is inverted here.) Every
 * entry point below therefore either takes a `<video>` the caller owns or mints its own detached
 * one from `sourceBlob`.
 *
 * Runs strictly after `phase: 'ready'`, never inside the sampling loop.
 */

/**
 * Bounded wait for a single seek. Resurrected verbatim from the retired
 * `src/quality/assessVideoQuality.ts` (`git show ee7a56e^`): `seeked` is not guaranteed to fire
 * reliably in every browser/state, so the wait degrades rather than hanging the caller forever.
 */
export const SEEK_TIMEOUT_MS = 2000

/**
 * Bounded wait for the detached element to have decoded data. Generous, because the alternative
 * to waiting is extracting from a black frame: the blob is local and has already been decoded once
 * by the analysis pass, so a clip that has not produced `loadeddata` inside this window is broken
 * rather than slow.
 */
export const LOAD_TIMEOUT_MS = 10000

/**
 * Backstop on the post-seek presentation grace period (see `waitForPresentedFrame`). Deliberately
 * two orders of magnitude below `SEEK_TIMEOUT_MS`: this is a courtesy pause, not a gate, and the
 * one situation that reaches it is a document that never paints (a backgrounded tab throttles
 * `requestAnimationFrame` to nothing). A whole clip's plan is on the order of forty instants, so a
 * seek-sized backstop here would cost a minute of wall clock to buy nothing `seeked` had not
 * already guaranteed.
 */
export const FRAME_PRESENTATION_TIMEOUT_MS = 100

/**
 * Cap on the side of the canvas a crop is drawn into, in device pixels. The crop rect itself is in
 * NATIVE video pixels and can be 2160 px on the demo clips — a full-resolution canvas per exemplar
 * is ~18 MB, and the gallery may hold two per metric across eleven metrics. Derived from the same
 * viewer-side reasoning that fixed `EVIDENCE_CROP_MIN_SIDE_PX` at 320: a gallery image is on the
 * order of 200-400 CSS px, so 640 device px covers it at 2x DPR. The crop is never UPSCALED to
 * reach this — it is a cap, not a target — so the display size stays the gallery's decision.
 */
export const EVIDENCE_OUTPUT_MAX_SIDE_PX = 640

/**
 * The PTS calibration hook (design D6/R1). `sequentialSampling` defaults on, so most MP4s sample
 * through WebCodecs, where a frame's timestamp is raw `sample.cts / sample.timescale` with no
 * edit-list adjustment — while `HTMLVideoElement.currentTime` *is* edit-list-adjusted. Seeking to
 * a `robustFrames` timestamp can therefore land a frame or two off, and the failure is
 * plausible-looking rather than obvious.
 *
 * This offset is added to a planned timestamp **at seek time only**. It is never written back into
 * `robustFrames[].timestamp`, which is the sampling layer's own truth and is correct in its own
 * domain, and it is never measured or guessed here — #68 ground-truths it against
 * `ffmpeg -i clip -ss <t> -frames:v 1` and reports a number. Until then it is zero, which is the
 * correct value for every WebM/webcam clip regardless (those sample through `<video>` playback and
 * already use `mediaTime`).
 */
export const DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS = 0

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — data for the current playback position is available. */
const HAVE_CURRENT_DATA = 2

export interface EvidenceExtractionOptions {
  /**
   * Per-clip seek-time calibration, in seconds (see `DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS`).
   * Applied to every planned timestamp before seeking and nowhere else.
   */
  seekOffsetSeconds?: number
  /** Cap on the drawn canvas side (see `EVIDENCE_OUTPUT_MAX_SIDE_PX`). */
  maxOutputSidePx?: number
  /** Bounded wait for `loadeddata` on a detached element. */
  loadTimeoutMs?: number
  /** Bounded wait for each seek. A seek that exhausts it fails its exemplar. */
  seekTimeoutMs?: number
  /** Backstop on the post-seek presentation grace period (see `FRAME_PRESENTATION_TIMEOUT_MS`).
   * Exhausting it is not a failure — the frame is drawn either way. */
  presentationTimeoutMs?: number
}

/** One renderable image: the plan it came from, and the canvas its instants were composited into. */
export interface ExtractedEvidenceFrame {
  plan: EvidenceFramePlan
  canvas: HTMLCanvasElement
}

/**
 * Mirrors `MetricEvidencePlan`'s discrimination so the gallery branches once. A plan that could not
 * be turned into pixels degrades to `'extraction-failed'` — a named verdict, never a pending
 * spinner.
 */
export type MetricEvidence =
  | { status: 'extracted'; items: ExtractedEvidenceFrame[] }
  | { status: 'no-evidence'; reason: EvidenceUnavailableReason }

export type ClipEvidence = Record<MetricId, MetricEvidence>

/** A clip's plan plus the bytes it was planned against. `sourceBlob` is `Blob | null` because
 * `VideoSource` types it that way — non-null after any `load()`, but the guard has to exist. */
export interface ClipEvidenceInput {
  sourceBlob: Blob | null
  plan: ClipEvidencePlan
}

/**
 * `'already-there'` distinguishes the `<0.001s` short-circuit from a real seek, which matters
 * downstream: no seek means no new frame will be presented, so waiting for one would only ever
 * time out.
 */
export type SeekOutcome = 'seeked' | 'already-there' | 'timed-out'

/**
 * Seeks `video` to `time` and waits for `seeked`, with a timeout fallback — resurrected from the
 * retired `assessVideoQuality.ts` rather than rewritten. It never rejects and never hangs.
 *
 * The one change from the original is the resolved value: that caller degraded gracefully on a
 * timeout and had no use for the distinction, whereas this one must mark the metric
 * `'extraction-failed'` rather than draw whatever frame happened to be showing.
 */
export function seekTo(
  video: HTMLVideoElement,
  time: number,
  timeoutMs: number = SEEK_TIMEOUT_MS,
): Promise<SeekOutcome> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve('already-there')
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
    }
    const onSeeked = () => {
      cleanup()
      resolve('seeked')
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve('timed-out')
    }, timeoutMs)
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

/** Which arm of `waitForPresentedFrame` resolved it. Reported for observability — no arm is a
 * failure, so the caller draws regardless of which one won. */
export type FramePresentationSignal =
  | 'video-frame-callback'
  | 'animation-frame'
  | 'timed-out'

/**
 * Bounded, best-effort pause between a completed seek and the draw. **Every arm resolves and none
 * of them fails the exemplar** — a presentation signal is a courtesy here, never the only path to
 * a drawn frame.
 *
 * ### Why this is not the `requestVideoFrameCallback` gate it replaced
 *
 * #66 awaited exactly one `requestVideoFrameCallback` after `seeked` and dropped the exemplar when
 * it did not arrive, reasoning that `seeked` reports seek completion but not that the new frame is
 * on screen (design D11 — an inference, never measured). Measured live for #59 (headless Chromium,
 * real GPU): **`requestVideoFrameCallback` does not fire after a PAUSED seek** in this Chromium —
 * detached or attached to the document, headless or headed. It fires normally during playback; the
 * paused-seek case specifically never presents. So the gate never opened, and every metric on every
 * clip degraded to `'extraction-failed'`.
 *
 * The premise was wrong as well as the remedy. `drawImage(video, …)` samples the DECODED frame at
 * the current playback position, not the composited output `requestVideoFrameCallback` reports on,
 * and `seeked` already implies `readyState >= HAVE_CURRENT_DATA` for the new position — the frame
 * is decoded and drawable at that point. The #59 probe confirms it end to end: pixels drawn
 * immediately after `seeked` alone are correct and DISTINCT per timestamp.
 *
 * ### The three arms
 *
 * - `requestVideoFrameCallback`, when the browser has it. First choice, and the reason the wait
 *   still exists: a browser that DOES present after a paused seek gets the real signal.
 * - Two `requestAnimationFrame` ticks. The everyday fallback, ~32 ms. Two rather than one because a
 *   single tick can land ahead of the frame callback in a browser where that callback works, which
 *   would make the real signal unreachable in practice.
 * - `timeoutMs`. The backstop for a document that never paints at all, where
 *   `requestAnimationFrame` is throttled to nothing and would hang this forever.
 *
 * A browser with no `requestVideoFrameCallback` simply loses the first arm and resolves through the
 * other two, which is the same "extract anyway" posture the old code took by resolving immediately.
 */
export function waitForPresentedFrame(
  video: HTMLVideoElement,
  timeoutMs: number = FRAME_PRESENTATION_TIMEOUT_MS,
): Promise<FramePresentationSignal> {
  return new Promise((resolve) => {
    let settled = false
    let frameHandle: number | undefined
    let rafHandle: number | undefined

    // Armed before either fast arm is registered, and read only through the hoisted `settle`
    // below, so no arm — not even one a stub fires synchronously — can reach it unassigned.
    const timer = setTimeout(() => settle('timed-out'), timeoutMs)

    function settle(signal: FramePresentationSignal) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle)
      if (rafHandle !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafHandle)
      }
      resolve(signal)
    }

    if (typeof video.requestVideoFrameCallback === 'function') {
      frameHandle = video.requestVideoFrameCallback(() => {
        frameHandle = undefined
        settle('video-frame-callback')
      })
    }

    if (typeof requestAnimationFrame === 'function') {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = requestAnimationFrame(() => {
          rafHandle = undefined
          settle('animation-frame')
        })
      })
    }
  })
}

/** Bounded wait for the element to hold decoded pixels. Resolves `false` on error or timeout. */
function waitForDecodedData(
  video: HTMLVideoElement,
  timeoutMs: number,
): Promise<boolean> {
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

interface ResolvedOptions {
  seekOffsetSeconds: number
  maxOutputSidePx: number
  loadTimeoutMs: number
  seekTimeoutMs: number
  presentationTimeoutMs: number
}

function resolveOptions(options: EvidenceExtractionOptions): ResolvedOptions {
  return {
    seekOffsetSeconds:
      options.seekOffsetSeconds ?? DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS,
    maxOutputSidePx: options.maxOutputSidePx ?? EVIDENCE_OUTPUT_MAX_SIDE_PX,
    loadTimeoutMs: options.loadTimeoutMs ?? LOAD_TIMEOUT_MS,
    seekTimeoutMs: options.seekTimeoutMs ?? SEEK_TIMEOUT_MS,
    presentationTimeoutMs:
      options.presentationTimeoutMs ?? FRAME_PRESENTATION_TIMEOUT_MS,
  }
}

/**
 * Seeks to one planned instant and draws it through the plan's crop rect at the plan's opacity.
 * `false` only when the SEEK itself never completed — the caller drops the whole exemplar rather
 * than shipping an image of whichever instant happened to be loaded. The presentation wait that
 * follows a completed seek cannot fail it (see `waitForPresentedFrame`).
 *
 * The nine-argument `drawImage` is the point (design R3): only the crop rect is ever read, and the
 * destination canvas is the display crop, so a 3840x2160 clip never allocates a full-frame canvas.
 */
async function drawInstant(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  instant: EvidenceInstantPlan,
  crop: EvidenceFramePlan['crop'],
  outputSide: number,
  options: ResolvedOptions,
): Promise<boolean> {
  const target = Math.max(0, instant.timestamp + options.seekOffsetSeconds)
  const outcome = await seekTo(video, target, options.seekTimeoutMs)
  if (outcome === 'timed-out') return false
  // `'already-there'` skips the wait rather than shortening it: the short-circuit means the element
  // is ALREADY showing this instant, so no new frame is coming and every arm but the backstop would
  // be dead. Waiting there could only burn the timeout and then draw the identical pixels.
  if (outcome === 'seeked') {
    await waitForPresentedFrame(video, options.presentationTimeoutMs)
  }
  ctx.globalAlpha = instant.opacity
  ctx.drawImage(
    video,
    crop.x,
    crop.y,
    crop.side,
    crop.side,
    0,
    0,
    outputSide,
    outputSide,
  )
  return true
}

/**
 * One planned image. The base is drawn first at full opacity and the ghost composited over it at
 * half, making the result a symmetric 50/50 double exposure of one runner at two instants. The
 * annotation layer goes on last, over both.
 *
 * `null` on any failure, including a ghost that fails after its base already drew: a range or
 * cycle exemplar shorn of its second instant would read as a single still and assert something the
 * metric never claimed.
 */
async function extractFrame(
  video: HTMLVideoElement,
  item: EvidenceFramePlan,
  options: ResolvedOptions,
): Promise<ExtractedEvidenceFrame | null> {
  // Shared with the pure layer rather than restated: annotation geometry has to land on the same
  // canvas these pixels do, and `toEvidenceOutputSpace` scales by exactly this number.
  const side = evidenceOutputSide(item.crop.side, options.maxOutputSidePx)
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null

  const instants: EvidenceInstantPlan[] =
    item.ghost === null ? [item.base] : [item.base, item.ghost]
  for (const instant of instants) {
    const drawn = await drawInstant(
      ctx,
      video,
      instant,
      item.crop,
      side,
      options,
    )
    if (!drawn) return null
  }

  // Annotation strictly after the photographic layers, and computed from the SAME `side` those were
  // drawn at — `planEvidenceAnnotations` recomputes it through `evidenceOutputSide` from the same
  // cap, so the marks and the pixels are scaled by one number by construction (design D3).
  //
  // The context reaching this call is dirty: `drawInstant` left `ctx.globalAlpha` at the last
  // instant's blend value, 0.5 on a ghosted pair. `drawEvidenceAnnotation` resets it explicitly and
  // drives every mark from the op's own composed opacity; nothing here relies on the value above.
  drawEvidenceAnnotation(
    ctx,
    planEvidenceAnnotations(item, options.maxOutputSidePx),
  )
  return { plan: item, canvas }
}

function metricEntries(plan: ClipEvidencePlan): Array<[MetricId, MetricEvidencePlan]> {
  return Object.entries(plan) as Array<[MetricId, MetricEvidencePlan]>
}

/**
 * Every planned metric degrades to `'extraction-failed'`; every metric that already had no
 * evidence keeps the reason the plan gave it. Used when the clip never became extractable at all
 * (no bytes, or the detached element never decoded any).
 */
function extractionFailed(plan: ClipEvidencePlan): ClipEvidence {
  const evidence = {} as ClipEvidence
  for (const [metric, entry] of metricEntries(plan)) {
    evidence[metric] =
      entry.status === 'planned'
        ? { status: 'no-evidence', reason: 'extraction-failed' }
        : entry
  }
  return evidence
}

/**
 * Runs a whole clip's plan against a `<video>` the CALLER owns and has already loaded — the same
 * shape as `sampleClip(video, ...)`. Readiness is not re-checked here; `extractClipEvidence` below
 * is the entry point that owns loading.
 *
 * Metrics are extracted in the plan's own key order, and every metric that planned at least one
 * image but produced none reports `'extraction-failed'` rather than an empty list.
 */
export async function extractPlannedFrames(
  video: HTMLVideoElement,
  plan: ClipEvidencePlan,
  options: EvidenceExtractionOptions = {},
): Promise<ClipEvidence> {
  const resolved = resolveOptions(options)
  const evidence = {} as ClipEvidence
  for (const [metric, entry] of metricEntries(plan)) {
    if (entry.status !== 'planned') {
      evidence[metric] = entry
      continue
    }
    const items: ExtractedEvidenceFrame[] = []
    for (const item of entry.items) {
      const extracted = await extractFrame(video, item, resolved)
      if (extracted !== null) items.push(extracted)
    }
    evidence[metric] =
      items.length > 0
        ? { status: 'extracted', items }
        : { status: 'no-evidence', reason: 'extraction-failed' }
  }
  return evidence
}

/**
 * One clip, one detached decoder, torn down before returning.
 *
 * The object URL is minted from `sourceBlob` and revoked here. `useVideoSource` keeps its own
 * `objectUrlRef` private and revokes it on reset/unmount — that one is never reused and never
 * revoked from here; `sourceBlob` is the intended seam and needs no `VideoSource` API change.
 * Blob URLs inherit the document's origin, so the canvas is never tainted (all four input modes
 * converge on `useVideoSource.load(blob)`; the remote demo URL is fetched to a blob and never
 * assigned to a `src`).
 */
export async function extractClipEvidence(
  input: ClipEvidenceInput,
  options: EvidenceExtractionOptions = {},
): Promise<ClipEvidence> {
  if (input.sourceBlob === null) return extractionFailed(input.plan)
  const resolved = resolveOptions(options)

  const url = URL.createObjectURL(input.sourceBlob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  video.load()

  try {
    const ready = await waitForDecodedData(video, resolved.loadTimeoutMs)
    if (!ready) return extractionFailed(input.plan)
    return await extractPlannedFrames(video, input.plan, options)
  } finally {
    // Drop the decoder before the URL: revoking first leaves the element holding a reference to a
    // now-unresolvable blob.
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/**
 * Every clip in a session, strictly one at a time. Sequential by construction rather than by
 * caller convention: Demo 1 is 3840x2160 and Demo 2 is 2160x3840, so N concurrent detached
 * decoders is not an acceptable amount of memory to hold (design R3).
 */
export async function extractSessionEvidence(
  clips: ClipEvidenceInput[],
  options: EvidenceExtractionOptions = {},
): Promise<ClipEvidence[]> {
  const evidence: ClipEvidence[] = []
  for (const clip of clips) {
    evidence.push(await extractClipEvidence(clip, options))
  }
  return evidence
}
