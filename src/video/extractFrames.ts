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
import { resolveEvidenceSeekOffsetSeconds } from './evidenceSeekOffset'
import {
  FRAME_PRESENTATION_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  SEEK_TIMEOUT_MS,
  queueDetachedDecode,
  seekTo,
  waitForPresentedFrame,
  withDecodedVideo,
} from './videoElement'

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
 * **One detached decoder at a time, process-wide, and abandonable.** The ordering lives inside
 * `extractClipEvidence` — the function that opens the decoder — on `videoElement.ts`'s shared
 * `queueDetachedDecode`, which `posterFrame.ts` puts inside `deriveClipPoster` for the same reason.
 * A `for await` loop can only order the clips of ONE call, and the overlap that mattered was
 * between SEPARATE calls: extraction starts a fresh pass whenever its input signature changes,
 * which it legitimately does mid-session when the background scale pass grafts
 * `verticalOscillationCm` in. Three 4K decoders were measured open at once. That queue is now ONE
 * queue for the whole app rather than one per feature — it used to be a tail private to this
 * module, which bounded evidence at one decoder and said nothing about the poster path's, leaving a
 * global peak of two structurally possible. Alongside it, `EvidenceExtractionOptions.signal` lets a
 * caller abandon a pass whose result nobody will read, so a superseded pass drops its decoder
 * instead of grinding on.
 *
 * **Never the visible element.** `useVideoAnalysis` re-arms the canonical `<video>` with
 * `muted`/`loop`/`currentTime = 0`/`play()` the moment a run reaches `phase: 'ready'`, so the clip
 * is actively replaying behind the results while this runs. Seeking it would yank the user's
 * playback around. (The retired pre-analysis quality gate did seek the visible element, but that
 * ran *before* the user could interact with playback — the justification is inverted here.) Every
 * entry point below therefore either takes a `<video>` the caller owns or mints its own detached
 * one from `sourceBlob`.
 *
 * **THIS module runs strictly after `phase: 'ready'`, never inside the sampling loop.** That is a
 * fact about when evidence extraction is CALLED, not a property of the `<video>` primitives it is
 * built from, and it deliberately stayed behind when those moved to `videoElement.ts`:
 * `useClipPoster` runs the same primitives DURING sampling, on purpose, and used to inherit this
 * sentence as a false claim about itself by importing half of them from here. The shared module
 * states no schedule; each consumer states its own, and the shared decoder queue is what makes two
 * different schedules safe to hold at once.
 */

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
 * a `robustFrames` timestamp therefore lands late by the clip's own `elst media_time`, and the
 * failure is plausible-looking rather than obvious: #68 ground-truthed it at +2 frames on all
 * three test clips.
 *
 * This offset is added to a planned timestamp **at seek time only**. It is never written back into
 * `robustFrames[].timestamp`, which is the sampling layer's own truth and is correct in its own
 * domain.
 *
 * **This constant is the fallback, not the answer.** The real value is per clip AND per sampler,
 * so `extractClipEvidence` derives it from the clip's own bytes
 * (`evidenceSeekOffset.ts`) rather than reading a number from here. Zero remains correct for every
 * clip that has no correction to make — every WebM/webcam blob and every MP4 whose container does
 * not shift the two clocks — which is why it stays the default an explicit caller inherits.
 */
export const DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS = 0

export interface EvidenceExtractionOptions {
  /**
   * Per-clip seek-time calibration, in seconds (see `DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS`).
   * Applied to every planned timestamp before seeking and nowhere else.
   *
   * Omitted is not "zero": `extractClipEvidence` derives the clip's own value when this is absent,
   * and only an explicitly-passed number overrides that. Tests and callers that must pin the seek
   * exactly pass `0`.
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
  /**
   * Abandons the pass. A pass whose result nobody will read — superseded by a later one, or torn
   * down with the component that asked for it — must stop holding a 4K decoder rather than grind
   * through the clips behind it, and this is how a caller says so.
   *
   * Abandonment is a VERDICT, never a rejection: an aborted clip resolves `'extraction-failed'`
   * for every metric that planned images, the same shape a clip that could not be decoded gets.
   * Nothing here throws, so a caller that never looks at the result cannot produce an unhandled
   * rejection by walking away from one.
   *
   * Checked before a decoder is opened, again after the queue grants a turn, and once per planned
   * image thereafter — so the worst-case latency between the abort and the decoder being released
   * is one exemplar, itself bounded by `seekTimeoutMs`.
   */
  signal?: AbortSignal
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

interface ResolvedOptions {
  seekOffsetSeconds: number
  maxOutputSidePx: number
  loadTimeoutMs: number
  seekTimeoutMs: number
  presentationTimeoutMs: number
  /** Carried through unresolved — an absent signal means "never abandoned", not a default. */
  signal: AbortSignal | undefined
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
    signal: options.signal,
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
 * the plan's blend alpha, making the result a double exposure of one runner at two instants that is
 * deliberately WEIGHTED TOWARD THE BASE — `source-over` onto a transparent canvas gives
 * `α·ghost + (1 − α)·base`, and `EVIDENCE_GHOST_BLEND_ALPHA` is below a half so the base reads as
 * the foreground body the caption and the solid annotation both already name (`strides-c37`). The
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
  // instant's blend value — `EVIDENCE_GHOST_BLEND_ALPHA` on a ghosted pair, which is not the ghost's
  // MARK opacity and is not a half. `drawEvidenceAnnotation` resets it explicitly and drives every
  // mark from the op's own composed opacity; nothing here relies on the value above.
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
 * `options.seekOffsetSeconds` falls back to `DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS` here rather
 * than being derived: this entry point is handed an element, not a blob, so it has nothing to
 * derive from. `extractClipEvidence` is the one that owns the bytes and therefore the derivation.
 *
 * Metrics are extracted in the plan's own key order, and every metric that planned at least one
 * image but produced none reports `'extraction-failed'` rather than an empty list.
 *
 * An abandoned pass (`options.signal`) abandons the WHOLE clip at the next image boundary, rather
 * than returning the images it happened to finish: a half-extracted clip reported as `'extracted'`
 * would be a partial answer wearing a complete one's shape, and nothing downstream could tell the
 * difference.
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
      // Per IMAGE, not per clip: the point of abandoning is to stop holding a decoder, and a
      // whole clip's plan is on the order of forty instants.
      if (resolved.signal?.aborted) return extractionFailed(plan)
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
 * One clip, one detached decoder, torn down before returning. The element, its object URL and the
 * teardown are `withDecodedVideo`'s (`videoElement.ts`) — identical plumbing to the poster path's,
 * because it is literally the same code rather than a second copy of it. A clip whose element never
 * decodes degrades every planned metric to `'extraction-failed'`.
 */
async function decodeClipEvidence(
  sourceBlob: Blob,
  plan: ClipEvidencePlan,
  options: EvidenceExtractionOptions,
): Promise<ClipEvidence> {
  // Re-checked AFTER the queue has granted a turn, not only before the call joined it: a pass
  // abandoned while it waited must not then go on to open the decoder it was queued for — nor
  // read the blob for the calibration below, which is why this sits ahead of that too.
  if (options.signal?.aborted) return extractionFailed(plan)

  // Derived from THIS clip's bytes, not read off a constant — see `evidenceSeekOffset.ts`. An
  // explicit option still wins, so a caller (and every unit test) can pin the seek exactly.
  // Resolved here rather than in `resolveOptions` because it is async and because it needs the
  // blob, which only this function has.
  const seekOffsetSeconds =
    options.seekOffsetSeconds ??
    (await resolveEvidenceSeekOffsetSeconds(sourceBlob))
  const withOffset: EvidenceExtractionOptions = { ...options, seekOffsetSeconds }
  const resolved = resolveOptions(withOffset)

  return withDecodedVideo(
    sourceBlob,
    resolved.loadTimeoutMs,
    (video) => extractPlannedFrames(video, plan, withOffset),
    () => extractionFailed(plan),
  )
}

/**
 * One clip's evidence, **strictly after every extraction already asked for**.
 *
 * "Already asked for" spans poster derivation too, not just other extractions: the wait is
 * `videoElement.ts`'s single `queueDetachedDecode`, shared with `deriveClipPoster`. It is imposed
 * here rather than asked of callers, and here specifically because this is the function that opens
 * the decoder. `extractSessionEvidence`'s `for await` loop orders the clips of ONE call and can do
 * no more — extraction starts a whole new pass whenever its input signature changes, which it
 * legitimately does mid-session when the background scale pass grafts `verticalOscillationCm` into
 * the fused heuristics, and nothing ordered those passes against each other. Measured: three 4K
 * decoders open at once on a four-clip session. Chaining onto one module-level tail makes "one
 * detached decoder exists at a time" a property of the shared module instead of a convention every
 * call site has to know about — the same posture, and the same 4K memory reason, as
 * `deriveClipPoster`.
 *
 * Nothing-to-do calls take no place in the queue: a clip with no bytes, and a pass already
 * abandoned, both open no decoder, so making them wait behind one would be pure latency.
 */
export function extractClipEvidence(
  input: ClipEvidenceInput,
  options: EvidenceExtractionOptions = {},
): Promise<ClipEvidence> {
  const { sourceBlob, plan } = input
  if (sourceBlob === null || options.signal?.aborted) {
    return Promise.resolve(extractionFailed(plan))
  }
  return queueDetachedDecode(() =>
    decodeClipEvidence(sourceBlob, plan, options),
  )
}

/**
 * Every clip in a session, strictly one at a time. Sequential by construction rather than by
 * caller convention: Demo 1 is 3840x2160 and Demo 2 is 2160x3840, so N concurrent detached
 * decoders is not an acceptable amount of memory to hold (design R3).
 *
 * It needs no serialization and no abandonment logic of its own — both live in
 * `extractClipEvidence`, which this loop goes through like any other caller. Two overlapping calls
 * to THIS function therefore interleave their clips one at a time rather than doubling up, which
 * is the guarantee the loop alone could never give.
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
