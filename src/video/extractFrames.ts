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
import { resolveEvidenceSeekCalibration } from './evidenceSeekOffset'
import { decodeFramesForward, frameShownAt, openDecodedFrameSource } from './decodedFrames'
import type { DecodedFrameSource } from './decodedFrames'
import { logPerfTimings, roundMs } from '../results/perfTimings'
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
 * is ~18 MB, and one session's evidence cache may hold two per metric across twelve metrics.
 * Derived from the same viewer-side reasoning that fixed `EVIDENCE_CROP_MIN_SIDE_PX` at 320: an
 * evidence image renders at a couple of hundred CSS px at most — the inline card thumbnail is
 * `w-36`, i.e. 144 CSS px nominal and 142 measured — so 640 device px covers it at 2x DPR with
 * room to spare. The crop is never UPSCALED to reach this — it is a cap, not a target — so the
 * display size stays the renderer's decision.
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
 *
 * It is no longer the whole seek target: that is now the planned timestamp PLUS this shift PLUS
 * `DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS`'s derived counterpart, in that order.
 */
export const DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS = 0

/**
 * The second seek-time term's fallback: half a frame, so the seek asks for the MIDDLE of a frame's
 * presentation interval rather than its start boundary (`strides-5t4`).
 *
 * `currentTime = t` displays the frame whose interval contains `t`, so the midpoint is the
 * semantically correct request — the boundary is the one point in the interval where a
 * sub-microsecond error changes the answer, and Chromium's measured truncation of `currentTime` to
 * integer microseconds guarantees such an error on any boundary that is not a whole microsecond.
 *
 * **Zero is correct for every clip with no derivable frame duration** — WebM, webcam recordings,
 * audio-only input, and any track with no usable `stts` — where it reproduces exactly the seek that
 * shipped before this existed. Like the offset above, the real value is per clip and is derived
 * from the clip's own bytes by `evidenceSeekOffset.ts`.
 */
export const DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS = 0

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
  /**
   * Half a frame, in seconds (see `DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS`). Derived and
   * overridden independently of `seekOffsetSeconds`: the two answer different questions, and a
   * caller pinning one has said nothing about the other.
   */
  midpointOffsetSeconds?: number
  /** Cap on the drawn canvas side (see `EVIDENCE_OUTPUT_MAX_SIDE_PX`). */
  maxOutputSidePx?: number
  /** Bounded wait for `loadeddata` on a detached element. */
  loadTimeoutMs?: number
  /** Bounded wait for each seek. A seek that exhausts it fails every image waiting on its frame. */
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
   * Checked before a decoder is opened, again after the queue grants a turn, and before every
   * SEEK thereafter — so the worst-case latency between the abort and the decoder being released is
   * one seek, itself bounded by `seekTimeoutMs`. It used to be checked once per image, which on a
   * ghosted pair let an abandoned pass seek and draw a whole second instant first: ~470 ms on a 4K
   * clip, spent on an image destined for the bin, with the superseding pass queued behind it
   * (`strides-zm8`).
   */
  signal?: AbortSignal
}

/** One renderable image: the plan it came from, and the canvas its instants were composited into. */
export interface ExtractedEvidenceFrame {
  plan: EvidenceFramePlan
  canvas: HTMLCanvasElement
}

/**
 * Mirrors `MetricEvidencePlan`'s discrimination so the renderer branches once. A plan that could not
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
  /**
   * Metrics whose evidence the caller ALREADY HOLDS for exactly this plan entry and this blob, and
   * which must therefore not be decoded again (`strides-zm8`). Each is returned in the result
   * verbatim — the same object, so the same canvas elements — at its own position in the plan's key
   * order, so the merged result is indistinguishable from a full extraction that happened to
   * reproduce those images.
   *
   * The caller owns the claim that a reused entry matches the plan. This module cannot check it: it
   * decides nothing about pixels beyond what the plan says, and a reused metric is by definition
   * one it was asked not to look at. A key here whose plan entry is not `'planned'` is ignored —
   * there was nothing to extract for it, so there is nothing to reuse.
   */
  reuse?: ReusedMetricEvidence
  /**
   * Told each metric's evidence the moment that metric is FINISHED — every one of its planned
   * images PRODUCED, and the pass not abandoned at any point up to and including the last one. A
   * metric that lost any image (a seek timeout) is never offered: it is a verdict for this pass,
   * not something a later pass should inherit instead of retrying.
   *
   * This is what lets a caller keep the work of a pass it is about to supersede. The scale-pass
   * graft supersedes the primary pass's extraction on every single-clip run, typically more than
   * halfway through, and the clip-level verdict of an abandoned pass is deliberately all-failed
   * (`extractPlannedFrames`); without this channel every finished metric in it was thrown away and
   * decoded again, identically, by the pass that replaced it.
   *
   * Never told about a reused metric (the caller already has it), about a metric the abort landed
   * inside, or about anything after the abort: the check that guards every seek is the same check
   * that guards this call, and both run synchronously, so a caller that aborts and then reads its
   * own cache cannot be written to behind its back.
   */
  onMetricExtracted?: (metric: MetricId, evidence: MetricEvidence) => void
}

/** Evidence a caller already holds, keyed by the metric it belongs to (`ClipEvidenceInput.reuse`). */
export type ReusedMetricEvidence = Partial<Record<MetricId, MetricEvidence>>

/** The per-clip half of `ClipEvidenceInput`: everything but the bytes and the plan. */
type ClipExtractionHooks = Pick<ClipEvidenceInput, 'reuse' | 'onMetricExtracted'>

interface ResolvedOptions {
  seekOffsetSeconds: number
  midpointOffsetSeconds: number
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
    midpointOffsetSeconds:
      options.midpointOffsetSeconds ?? DEFAULT_EVIDENCE_MIDPOINT_OFFSET_SECONDS,
    maxOutputSidePx: options.maxOutputSidePx ?? EVIDENCE_OUTPUT_MAX_SIDE_PX,
    loadTimeoutMs: options.loadTimeoutMs ?? LOAD_TIMEOUT_MS,
    seekTimeoutMs: options.seekTimeoutMs ?? SEEK_TIMEOUT_MS,
    presentationTimeoutMs:
      options.presentationTimeoutMs ?? FRAME_PRESENTATION_TIMEOUT_MS,
    signal: options.signal,
  }
}

/**
 * The `currentTime` one planned instant is seeked to. Computed once per instant, and the schedule
 * in `extractPlannedFrames` dedupes on this exact number: two instants share a seek only when they
 * would each have asked the element for the identical `currentTime`.
 *
 * `null` for a target that is not a finite number, which fails the image before anything is
 * seeked. The schedule keys targets in a `Map`, which treats `NaN` as equal to itself, but matches
 * them with `===`, which does not — a `NaN` target would be chosen and then never drawn.
 */
function seekTargetOf(
  instant: EvidenceInstantPlan,
  durationSec: number,
  options: ResolvedOptions,
): number | null {
  // Edit-list shift FIRST, then the midpoint. The shift converts a media-clock frame START to a
  // presentation-clock frame START; only after that is "add half an interval" the middle of the
  // interval `currentTime` will be compared against. Both terms are additive so the order does not
  // move the number today — it stays correct if a non-unity-rate edit list is ever admitted.
  const requested =
    instant.timestamp + options.seekOffsetSeconds + options.midpointOffsetSeconds
  // The LAST frame's interval ends at the clip's end, so half a frame past its start can sit
  // beyond a duration the element will refuse. Clamped only against a duration it actually
  // reports: jsdom gives `NaN` and a webcam recording gives `Infinity`, and comparing against
  // either would poison the target or never fire.
  const target = Math.max(
    0,
    Number.isFinite(durationSec)
      ? Math.min(requested, durationSec)
      : requested,
  )
  return Number.isFinite(target) ? target : null
}

/**
 * Seeks to one target and waits for its frame. `'timed-out'` only when the SEEK itself never
 * completed — every image waiting on that frame is dropped rather than shipped with whichever
 * instant happened to be loaded. The presentation wait that follows a completed seek cannot fail it
 * (see `waitForPresentedFrame`).
 */
async function presentTarget(
  video: HTMLVideoElement,
  target: number,
  options: ResolvedOptions,
): Promise<'presented' | 'timed-out' | 'aborted'> {
  const outcome = await seekTo(video, target, options.seekTimeoutMs)
  if (outcome === 'timed-out') return 'timed-out'
  // An abort that arrived DURING the seek skips the presentation wait and the draws: every image
  // is already destined for the bin.
  if (options.signal?.aborted) return 'aborted'
  // `'already-there'` skips the wait rather than shortening it: the short-circuit means the element
  // is ALREADY showing this instant, so no new frame is coming and every arm but the backstop would
  // be dead. Waiting there could only burn the timeout and then draw the identical pixels.
  if (outcome === 'seeked') {
    await waitForPresentedFrame(video, options.presentationTimeoutMs)
  }
  return 'presented'
}

/**
 * Draws the element's presented frame through the plan's crop rect at the instant's opacity —
 * straight from the `<video>`, every time, never through an intermediate canvas or bitmap. That is
 * what keeps a deduplicated schedule pixel-identical to one seek per instant: the same source, the
 * same nine-argument call, the same `globalAlpha`, so the same single resample and the same blend.
 *
 * The nine-argument `drawImage` is the point (design R3): only the crop rect is ever read, and the
 * destination canvas is the display crop, so a 3840x2160 clip never allocates a full-frame canvas.
 */
function drawInstant(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  instant: EvidenceInstantPlan,
  crop: EvidenceFramePlan['crop'],
  outputSide: number,
): void {
  ctx.globalAlpha = instant.opacity
  ctx.drawImage(
    source,
    crop.x,
    crop.y,
    crop.side,
    crop.side,
    0,
    0,
    outputSide,
    outputSide,
  )
}

/**
 * One planned image in flight: its canvas, and how far through its instants the schedule has got.
 *
 * `instants` is always base first, then the ghost. The base is drawn at full opacity and the ghost
 * composited over it at the plan's blend alpha, making the result a double exposure of one runner
 * at two instants that is deliberately WEIGHTED TOWARD THE BASE — `source-over` onto a transparent
 * canvas gives `α·ghost + (1 − α)·base`, and `EVIDENCE_GHOST_BLEND_ALPHA` is below a half so the
 * base reads as the foreground body the caption and the solid annotation both already name
 * (`strides-c37`). That ORDER is a per-canvas invariant the schedule must keep whatever order it
 * seeks in: a base drawn second at full opacity erases the ghost rather than being blended with it.
 */
interface ImageInFlight {
  metric: MetricId
  plan: EvidenceFramePlan
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  side: number
  instants: EvidenceInstantPlan[]
  /** `seekTargetOf` each of `instants`, index for index. */
  targets: number[]
  /** How many of `instants` are on the canvas. */
  drawn: number
  /**
   * `'failed'` on any failure, including a ghost whose seek fails after its base already drew: a
   * range or cycle exemplar shorn of its second instant would read as a single still and assert
   * something the metric never claimed.
   */
  state: 'pending' | 'done' | 'failed'
}

/** A canvas for one planned image, or `null` where the element offers no 2D context or an
 * instant has no finite seek target. */
function openImage(
  metric: MetricId,
  item: EvidenceFramePlan,
  durationSec: number,
  options: ResolvedOptions,
): ImageInFlight | null {
  // Shared with the pure layer rather than restated: annotation geometry has to land on the same
  // canvas these pixels do, and `toEvidenceOutputSpace` scales by exactly this number.
  const side = evidenceOutputSide(item.crop.side, options.maxOutputSidePx)
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  const instants = item.ghost === null ? [item.base] : [item.base, item.ghost]
  const targets: number[] = []
  for (const instant of instants) {
    const target = seekTargetOf(instant, durationSec, options)
    if (target === null) return null
    targets.push(target)
  }
  return {
    metric,
    plan: item,
    canvas,
    ctx,
    side,
    instants,
    targets,
    drawn: 0,
    state: 'pending',
  }
}

/**
 * Draws every instant of `image` that the presented `target` frame satisfies, in instant order, and
 * annotates the image once its last instant is down. Only the image's NEXT instant may be drawn —
 * a ghost whose base is not on the canvas yet waits for a later visit to its target.
 */
function drawPresentedInstants(
  image: ImageInFlight,
  source: CanvasImageSource,
  target: number,
  maxOutputSidePx: number,
): void {
  while (image.drawn < image.targets.length && image.targets[image.drawn] === target) {
    drawInstant(image.ctx, source, image.instants[image.drawn], image.plan.crop, image.side)
    image.drawn += 1
  }
  if (image.drawn < image.targets.length) return
  // Annotation strictly after the photographic layers, and computed from the SAME `side` those were
  // drawn at — `planEvidenceAnnotations` recomputes it through `evidenceOutputSide` from the same
  // cap, so the marks and the pixels are scaled by one number by construction (design D3).
  //
  // The context reaching this call is dirty: `drawInstant` left `ctx.globalAlpha` at the last
  // instant's blend value — `EVIDENCE_GHOST_BLEND_ALPHA` on a ghosted pair, which is not the ghost's
  // MARK opacity and is not a half. `drawEvidenceAnnotation` resets it explicitly and drives every
  // mark from the op's own composed opacity; nothing here relies on the value above.
  drawEvidenceAnnotation(image.ctx, planEvidenceAnnotations(image.plan, maxOutputSidePx))
  image.state = 'done'
}

/**
 * The next frame to seek to, or `null` when no image is waiting on one (`strides-e4c.5`).
 *
 * The aim is ONE seek per distinct target, in ascending time. Instants repeat across metrics on
 * every clip — the vertical-oscillation family shares its bounce pair, footstrikes recur across the
 * footstrike metrics, `armSwingAmplitude`'s two images are the same two instants swapped — and a
 * seek is the whole cost of an image (~470 ms on a 4K clip).
 *
 * Strict ascending order is not always allowed, because a ghost may come BEFORE its own base in
 * time, and must still be composited AFTER it. Holding that earlier frame for later would mean an
 * intermediate canvas or bitmap, and a crop resampled into one and then blended out of it is not
 * guaranteed to match the same crop blended straight from the `<video>` — two quantisation steps
 * instead of one, and possibly a different YUV-to-RGB path. So every draw stays direct, and the
 * ORDER gives instead: this picks the earliest target at which every instant still waiting is
 * drawable now (its image's base is already down), which is a topological order of the
 * base-before-ghost constraints that runs ascending wherever they allow.
 *
 * Only a CYCLE leaves no such target — two images on the same two instants with base and ghost
 * swapped, as `armSwingAmplitude` plans on a front view. That is broken by visiting the earliest
 * target that has anything drawable at all; what it could not draw is visited again later. One
 * extra seek per cycle, against two saved by the shared pair.
 */
function nextSeekTarget(images: readonly ImageInFlight[]): number | null {
  // Per target still needed: whether every instant waiting on it is drawable on the next visit.
  const drawableNow = new Map<number, boolean>()
  let earliestDrawable: number | null = null
  for (const image of images) {
    if (image.state !== 'pending') continue
    const next = image.targets[image.drawn]
    if (earliestDrawable === null || next < earliestDrawable) earliestDrawable = next
    for (let index = image.drawn; index < image.targets.length; index += 1) {
      const target = image.targets[index]
      // Drawable on a visit to `target` only if nothing of this image is still owed before it. An
      // image has at most two instants, so past its next one that means the next one is here too.
      const drawable = index === image.drawn || image.targets[image.drawn] === target
      drawableNow.set(target, (drawableNow.get(target) ?? true) && drawable)
    }
  }
  let earliestComplete: number | null = null
  for (const [target, complete] of drawableNow) {
    if (complete && (earliestComplete === null || target < earliestComplete)) {
      earliestComplete = target
    }
  }
  return earliestComplete ?? earliestDrawable
}

function metricEntries(plan: ClipEvidencePlan): Array<[MetricId, MetricEvidencePlan]> {
  return Object.entries(plan) as Array<[MetricId, MetricEvidencePlan]>
}

/**
 * Every planned metric degrades to `'extraction-failed'`; every metric that already had no
 * evidence keeps the reason the plan gave it. Used when the clip never became extractable at all
 * (no bytes, or the detached element never decoded any).
 */
function extractionFailed(
  plan: ClipEvidencePlan,
  reuse: ReusedMetricEvidence = {},
): ClipEvidence {
  const evidence = {} as ClipEvidence
  for (const [metric, entry] of metricEntries(plan)) {
    evidence[metric] =
      entry.status === 'planned'
        ? (reusedFor(reuse, metric, entry) ?? {
            status: 'no-evidence',
            reason: 'extraction-failed',
          })
        : entry
  }
  return evidence
}

/** A reused metric's evidence, honoured only where the plan actually asked for images. */
function reusedFor(
  reuse: ReusedMetricEvidence,
  metric: MetricId,
  entry: MetricEvidencePlan,
): MetricEvidence | undefined {
  return entry.status === 'planned' ? reuse[metric] : undefined
}

/** Whether any planned metric is left for a decoder once the reused ones are taken out. */
function needsDecoder(plan: ClipEvidencePlan, reuse: ReusedMetricEvidence): boolean {
  return metricEntries(plan).some(
    ([metric, entry]) =>
      entry.status === 'planned' && reusedFor(reuse, metric, entry) === undefined,
  )
}

/**
 * Runs a whole clip's plan against a `<video>` the CALLER owns and has already loaded — the same
 * shape as `sampleClip(video, ...)`. Readiness is not re-checked here; `extractClipEvidence` below
 * is the entry point that owns loading.
 *
 * `options.seekOffsetSeconds` and `options.midpointOffsetSeconds` fall back to their
 * `DEFAULT_EVIDENCE_*` constants here rather than being derived: this entry point is handed an
 * element, not a blob, so it has nothing to derive from. `extractClipEvidence` is the one that
 * owns the bytes and therefore the derivation.
 *
 * Every distinct seek target is visited once, in ascending time wherever the base-before-ghost
 * order allows, and every image needing that frame is drawn from it (`nextSeekTarget`). The RESULT
 * does not depend on that order: metrics come back in the plan's own key order, each with its
 * images in plan order, and every metric that planned at least one image but produced none
 * reports `'extraction-failed'` rather than an empty list. A seek that times out drops exactly the
 * images that were waiting on that frame.
 *
 * An abandoned pass (`options.signal`) abandons the WHOLE clip at the next seek, rather than
 * returning the images it happened to finish: a half-extracted clip reported as `'extracted'` would
 * be a partial answer wearing a complete one's shape, and nothing downstream could tell the
 * difference. The metrics it DID finish are not lost for that — each was already reported, whole,
 * through `hooks.onMetricExtracted` the moment its last image was drawn, a channel that cannot carry
 * a half-finished one. Under the time-ordered schedule metrics finish in the order their LAST
 * instants fall, not in plan order.
 *
 * `hooks.reuse` names metrics the caller already holds: they are passed through by reference, in
 * their plan position, and never seeked (see `ClipEvidenceInput.reuse`).
 */
export function extractPlannedFrames(
  video: HTMLVideoElement,
  plan: ClipEvidencePlan,
  options: EvidenceExtractionOptions = {},
  hooks: ClipExtractionHooks = {},
): Promise<ClipEvidence> {
  return extractPlannedFramesCounted(video, plan, options, hooks, { seeks: 0, decodePasses: 0 })
}

/** What a pass actually did, beyond its result. Dev-only instrumentation. */
interface ExtractionStats {
  /** Seeks issued — one per distinct target, plus one per base/ghost cycle the schedule broke. */
  seeks: number
  /** Forward decode passes run instead of seeks (`strides-6i6.4`) — one, plus one more wherever a
   * ghost precedes its own base. */
  decodePasses: number
}

/**
 * One clip's images in flight, and the bookkeeping that turns them into a result — shared by the
 * seek driver (`extractPlannedFramesCounted`) and the forward-decode driver (`extractByDecoding`),
 * which differ only in where the frame each instant is drawn from comes from.
 */
interface ExtractionRun {
  inFlight: ImageInFlight[]
  /** Settles `metric` if none of its images is still pending, reporting it when complete. */
  settle: (metric: MetricId) => void
  /** The merged result, in plan key order. Only valid once nothing is pending. */
  result: () => ClipEvidence
  /** The caller's reuse plus every metric this run has already settled COMPLETE — what a
   * fallback to the seek path may reuse instead of drawing again. */
  completed: () => ReusedMetricEvidence
}

function openExtractionRun(
  plan: ClipEvidencePlan,
  durationSec: number,
  resolved: ResolvedOptions,
  hooks: ClipExtractionHooks,
): ExtractionRun {
  const reuse = hooks.reuse ?? {}

  const decoded = metricEntries(plan).filter(
    (pair): pair is [MetricId, Extract<MetricEvidencePlan, { status: 'planned' }>] =>
      pair[1].status === 'planned' && reusedFor(reuse, pair[0], pair[1]) === undefined,
  )
  // Plan order, metric by metric and item by item, so a metric's surviving images keep their plan
  // order whatever order the schedule finished them in.
  const images: Array<ImageInFlight | null> = []
  const imagesOf = new Map<MetricId, Array<ImageInFlight | null>>()
  for (const [metric, entry] of decoded) {
    const opened = entry.items.map((item) => openImage(metric, item, durationSec, resolved))
    imagesOf.set(metric, opened)
    images.push(...opened)
  }
  const inFlight = images.filter((image): image is ImageInFlight => image !== null)

  // Each decoded metric's verdict, settled the moment none of its images is still pending — and
  // the same object later merged into the result, so what a caller kept IS what the pass returned.
  const settled = new Map<MetricId, MetricEvidence>()
  const complete = new Set<MetricId>()
  const settle = (metric: MetricId) => {
    const own = imagesOf.get(metric) ?? []
    if (settled.has(metric) || own.some((image) => image?.state === 'pending')) return
    const items = own
      .filter((image): image is ImageInFlight => image?.state === 'done')
      .map((image) => ({ plan: image.plan, canvas: image.canvas }))
    const verdict: MetricEvidence =
      items.length > 0
        ? { status: 'extracted', items }
        : { status: 'no-evidence', reason: 'extraction-failed' }
    settled.set(metric, verdict)
    // Only a COMPLETE answer is offered for keeping: a metric that lost an image to a seek timeout
    // — or lost all of them — is a fine verdict for this pass, but a caller that kept it would
    // reuse it for as long as the plan entry stays the same, and the primary pass that produces
    // most harvests runs exactly while the scale pass contends for the GPU. Not keeping it lets the
    // next pass try again, as the whole-clip re-extraction used to.
    if (verdict.status === 'extracted' && items.length === own.length) {
      complete.add(metric)
      hooks.onMetricExtracted?.(metric, verdict)
    }
  }
  // A metric with nothing left to seek — no items, or no canvas for any of them — is settled up
  // front; it can never be complete, so this offers nothing.
  for (const [metric] of decoded) settle(metric)

  return {
    inFlight,
    settle,
    result: () => {
      const evidence = {} as ClipEvidence
      for (const [metric, entry] of metricEntries(plan)) {
        evidence[metric] =
          entry.status !== 'planned'
            ? entry
            : (reusedFor(reuse, metric, entry) ?? settled.get(metric)!)
      }
      return evidence
    },
    completed: () => {
      const kept: ReusedMetricEvidence = { ...reuse }
      for (const metric of complete) kept[metric] = settled.get(metric)
      return kept
    },
  }
}

async function extractPlannedFramesCounted(
  video: HTMLVideoElement,
  plan: ClipEvidencePlan,
  options: EvidenceExtractionOptions,
  hooks: ClipExtractionHooks,
  stats: ExtractionStats,
): Promise<ClipEvidence> {
  const resolved = resolveOptions(options)
  const reuse = hooks.reuse ?? {}
  const run = openExtractionRun(plan, video.duration, resolved, hooks)
  const { inFlight, settle } = run

  for (;;) {
    const target = nextSeekTarget(inFlight)
    if (target === null) break
    // Per SEEK, so an abandoned pass starts no further one and pays for at most the one in flight.
    // It used to be checked once per image, which on a ghosted pair let an abandoned pass seek and
    // draw a whole second instant first (`strides-zm8`).
    if (resolved.signal?.aborted) return extractionFailed(plan, reuse)
    stats.seeks += 1
    const outcome = await presentTarget(video, target, resolved)
    if (outcome === 'aborted' || resolved.signal?.aborted) {
      return extractionFailed(plan, reuse)
    }
    const touched = new Set<MetricId>()
    for (const image of inFlight) {
      if (image.state !== 'pending' || image.targets[image.drawn] !== target) continue
      touched.add(image.metric)
      if (outcome === 'timed-out') image.state = 'failed'
      else drawPresentedInstants(image, video, target, resolved.maxOutputSidePx)
    }
    // Re-checked after the draws and before anything is reported: an abort that lands while this
    // frame is being drawn must not let the metric those draws finished be offered for keeping.
    // Both this check and the reports below run synchronously, so a caller that aborts and then
    // reads its own cache cannot be written to behind its back.
    // Every visit draws or fails at least one image: `nextSeekTarget` only returns a target some
    // pending image's next instant is at. Asserted rather than assumed, because a visit that
    // changed nothing would be chosen again, forever.
    if (touched.size === 0) {
      throw new Error(`evidence schedule made no progress at seek target ${target}`)
    }
    if (resolved.signal?.aborted) return extractionFailed(plan, reuse)
    for (const metric of touched) settle(metric)
  }

  return run.result()
}

/**
 * How a forward-decode attempt ended. `'unavailable'` hands the clip to the seek path, carrying the
 * metrics the attempt already finished whole — each was already reported through
 * `onMetricExtracted`, so the seek path reuses rather than redraws them.
 */
type DecodeAttempt =
  | { kind: 'done'; evidence: ClipEvidence }
  | { kind: 'unavailable'; completed: ReusedMetricEvidence }

/**
 * The same plan, drawn from `VideoFrame`s out of forward decode passes instead of seeks
 * (`strides-6i6.4`, `decodedFrames.ts`). Identical in everything but the frame source:
 *
 * - **Which frame.** Each instant's `currentTime` target is computed exactly as the seek path
 *   computes it (`seekTargetOf`, both offsets included), then mapped to the frame a `<video>` shows
 *   there (`frameShownAt`). A target that mapping will not vouch for sends the WHOLE clip to the
 *   seek path before a single pixel is drawn. The duration clamp is not applied: a target at or past
 *   the presented end is one `frameShownAt` refuses, so the clamp's only effect is reached by the
 *   seek path instead.
 * - **Which pixels.** Every instant is drawn by the same `drawInstant` — the same nine-argument
 *   `drawImage`, the same crop, the same `globalAlpha` — straight from the decoded frame, never via
 *   an intermediate canvas, and annotated by the same `drawPresentedInstants`.
 * - **Which order.** A canvas still takes its base before its ghost. A pass draws each image's NEXT
 *   instant as its frame arrives, in presentation order; a ghost that precedes its own base in time
 *   is drawn by the next pass. Every pass advances every pending image by at least one instant, so
 *   a plan needs at most two.
 *
 * Abandonment is checked as each frame arrives and between passes, with the seek path's semantics:
 * an aborted clip is all `'extraction-failed'`, and a metric finished before the abort was already
 * reported whole.
 */
async function extractByDecoding(
  source: DecodedFrameSource,
  plan: ClipEvidencePlan,
  options: EvidenceExtractionOptions,
  hooks: ClipExtractionHooks,
  stats: ExtractionStats,
): Promise<DecodeAttempt> {
  const resolved = resolveOptions(options)
  const reuse = hooks.reuse ?? {}
  const run = openExtractionRun(plan, Number.NaN, resolved, hooks)
  const { inFlight, settle } = run

  // Re-key every instant from a `currentTime` target to the decoder timestamp of the frame that
  // target shows — before anything is drawn, so a refusal costs nothing.
  for (const image of inFlight) {
    for (let index = 0; index < image.targets.length; index += 1) {
      const key = frameShownAt(source.timeline, image.targets[index])
      if (key === null) return { kind: 'unavailable', completed: run.completed() }
      image.targets[index] = key
    }
  }

  const { width, height } = source.track
  for (;;) {
    const pending = inFlight.filter((image) => image.state === 'pending')
    if (pending.length === 0) break
    if (resolved.signal?.aborted) return { kind: 'done', evidence: extractionFailed(plan, reuse) }
    const wanted = new Set<number>()
    for (const image of pending) {
      for (let index = image.drawn; index < image.targets.length; index += 1) {
        wanted.add(image.targets[index])
      }
    }
    stats.decodePasses += 1
    let progressed = false
    const outcome = await decodeFramesForward(
      source.track,
      wanted,
      (frame, key) => {
        // The plan's crop rect is in the pixel space the `<video>` path draws from; a frame
        // reporting any other size would put the same rect somewhere else.
        if (frame.displayWidth !== width || frame.displayHeight !== height) {
          throw new Error('decoded frame size differs from the track')
        }
        const touched = new Set<MetricId>()
        for (const image of inFlight) {
          if (image.state !== 'pending' || image.targets[image.drawn] !== key) continue
          touched.add(image.metric)
          drawPresentedInstants(image, frame, key, resolved.maxOutputSidePx)
        }
        if (touched.size > 0) progressed = true
        // Same discipline as the seek driver: nothing is reported once the pass is abandoned.
        if (resolved.signal?.aborted) return
        for (const metric of touched) settle(metric)
      },
      { signal: resolved.signal, stallTimeoutMs: resolved.loadTimeoutMs },
    )
    if (outcome === 'aborted' || resolved.signal?.aborted) {
      return { kind: 'done', evidence: extractionFailed(plan, reuse) }
    }
    if (outcome === 'failed' || !progressed) {
      return { kind: 'unavailable', completed: run.completed() }
    }
  }
  return { kind: 'done', evidence: run.result() }
}

/** Instants a plan asks for: one per instant, so two for a ghosted pair. Dev-only instrumentation —
 * the seeks before `strides-e4c.5` deduplicated them, kept beside `seeks` so the two compare. */
function countPlannedInstants(
  plan: ClipEvidencePlan,
  reuse: ReusedMetricEvidence,
): number {
  let instants = 0
  for (const [metric, entry] of metricEntries(plan)) {
    if (entry.status !== 'planned' || reusedFor(reuse, metric, entry) !== undefined) continue
    for (const item of entry.items) instants += item.ghost === null ? 1 : 2
  }
  return instants
}

/** Images handed back by reference rather than decoded. Dev-only instrumentation. */
function countReusedImages(plan: ClipEvidencePlan, reuse: ReusedMetricEvidence): number {
  let images = 0
  for (const [metric, entry] of metricEntries(plan)) {
    const reused = reusedFor(reuse, metric, entry)
    if (reused?.status === 'extracted') images += reused.items.length
  }
  return images
}

/** Images this pass actually DECODED — a reused metric's images are counted by
 * `countReusedImages` instead, so the line reports decode work rather than its result's size. */
function countExtractedImages(
  evidence: ClipEvidence,
  plan: ClipEvidencePlan,
  reuse: ReusedMetricEvidence,
): number {
  let images = 0
  for (const [metric, entry] of metricEntries(plan)) {
    if (reusedFor(reuse, metric, entry) !== undefined) continue
    const produced = evidence[metric]
    if (produced.status === 'extracted') images += produced.items.length
  }
  return images
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
  hooks: ClipExtractionHooks,
  options: EvidenceExtractionOptions,
  requestedAt: number,
): Promise<ClipEvidence> {
  const reuse = hooks.reuse ?? {}
  // Re-checked AFTER the queue has granted a turn, not only before the call joined it: a pass
  // abandoned while it waited must not then go on to open the decoder it was queued for — nor
  // read the blob for the calibration below, which is why this sits ahead of that too.
  if (options.signal?.aborted) return extractionFailed(plan, reuse)
  const startedAt = performance.now()

  // Derived from THIS clip's bytes, not read off a constant — see `evidenceSeekOffset.ts`. An
  // explicit option still wins PER TERM, so a caller (and every unit test) can pin either seek
  // component exactly without silently pinning the other. Resolved here rather than in
  // `resolveOptions` because it is async and because it needs the blob, which only this function
  // has — and in ONE call, so a clip pays for at most one container parse.
  const needsDerivation =
    options.seekOffsetSeconds === undefined ||
    options.midpointOffsetSeconds === undefined
  const calibration = needsDerivation
    ? await resolveEvidenceSeekCalibration(sourceBlob)
    : null
  const calibrated: EvidenceExtractionOptions = {
    ...options,
    seekOffsetSeconds: options.seekOffsetSeconds ?? calibration?.offsetSeconds,
    midpointOffsetSeconds:
      options.midpointOffsetSeconds ?? calibration?.midpointOffsetSeconds,
  }
  const resolved = resolveOptions(calibrated)
  const calibratedAt = performance.now()
  const stats: ExtractionStats = { seeks: 0, decodePasses: 0 }

  // Forward decoding first, where the clip allows it (`strides-6i6.4`); the seek path below is the
  // fallback for everything it declines, and for whatever it could not finish.
  let evidence: ClipEvidence | null = null
  let seekHooks = hooks
  let frameSource: 'decode' | 'seek' = 'seek'
  const decodeSource = await openDecodedFrameSource(sourceBlob)
  const sourceOpenedAt = performance.now()
  if (decodeSource !== null && !options.signal?.aborted) {
    const attempt = await extractByDecoding(decodeSource, plan, calibrated, hooks, stats)
    if (attempt.kind === 'done') {
      evidence = attempt.evidence
      frameSource = 'decode'
    } else {
      seekHooks = { ...hooks, reuse: attempt.completed }
    }
  }
  const decodeDoneAt = performance.now()

  let decodedAt: number | null = null
  if (evidence === null) {
    const fallbackReuse = seekHooks.reuse ?? {}
    evidence = await withDecodedVideo(
      sourceBlob,
      resolved.loadTimeoutMs,
      (video) => {
        decodedAt = performance.now()
        return extractPlannedFramesCounted(video, plan, calibrated, seekHooks, stats)
      },
      () => extractionFailed(plan, fallbackReuse),
    )
  }
  const doneAt = performance.now()
  if (import.meta.env.DEV) logPerfTimings('evidence-extraction', {
    bytes: sourceBlob.size,
    queueWaitMs: roundMs(startedAt - requestedAt),
    calibrationMs: roundMs(calibratedAt - startedAt),
    frameSource,
    decodeSourceMs: roundMs(sourceOpenedAt - calibratedAt),
    decodeMs: decodeSource === null ? null : roundMs(decodeDoneAt - sourceOpenedAt),
    decodePasses: stats.decodePasses,
    videoLoadMs: decodedAt === null ? null : roundMs(decodedAt - decodeDoneAt),
    seekAndDrawMs: decodedAt === null ? null : roundMs(doneAt - decodedAt),
    plannedSeeks: countPlannedInstants(plan, reuse),
    seeks: stats.seeks,
    images: countExtractedImages(evidence, plan, reuse),
    reusedImages: countReusedImages(plan, reuse),
    aborted: options.signal?.aborted === true,
    totalMs: roundMs(doneAt - startedAt),
  })
  return evidence
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
 * Nothing-to-do calls take no place in the queue: a clip with no bytes, a pass already abandoned,
 * and a clip whose every planned metric the caller already holds (`input.reuse`) all open no
 * decoder, so making them wait behind one would be pure latency.
 */
export function extractClipEvidence(
  input: ClipEvidenceInput,
  options: EvidenceExtractionOptions = {},
): Promise<ClipEvidence> {
  const { sourceBlob, plan, ...hooks } = input
  const reuse = hooks.reuse ?? {}
  // A clip whose every planned metric is already held is fully known without a single seek, so it
  // joins no queue and opens no decoder — the merge below fills in nothing but those held metrics.
  if (sourceBlob === null || options.signal?.aborted || !needsDecoder(plan, reuse)) {
    return Promise.resolve(extractionFailed(plan, reuse))
  }
  const requestedAt = performance.now()
  return queueDetachedDecode(() =>
    decodeClipEvidence(sourceBlob, plan, hooks, options, requestedAt),
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
