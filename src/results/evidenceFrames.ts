import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { BoundingBoxPx, CropRectPx } from '../pose/backends/movenetCrop'
import {
  computeBoundingBoxIoU,
  computeCropRect,
} from '../pose/backends/movenetCrop'
import type {
  FormHeuristicsResult,
  MetricExemplar,
  MetricExemplarKind,
  MetricId,
  MetricResult,
} from '../heuristics/types'
import {
  MAX_EXEMPLARS_PER_METRIC,
  MIN_EXEMPLAR_QUALITY,
} from '../heuristics/exemplars'
import { resolveBilateralPair, resolvePoint } from '../heuristics/keypoints'
import { median } from '../heuristics/mathUtils'
import { estimateBodyScale } from '../heuristics/bodyScale'
import { estimateTravelDirection } from '../heuristics/travelDirection'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import { findNearestFrame } from './skeletonGeometry'
import { metricTier } from './metricConfidence'

/**
 * The PURE half of evidence-frame extraction: given a metric's exemplars plus that clip's
 * `robustFrames` and pixel dimensions, decide which timestamps to pull, what rectangle to crop
 * each to, which two to blend, and at what opacities. The impure half — a detached `<video>`,
 * seeking, `drawImage`, compositing — consumes this and lives elsewhere.
 *
 * **Zero DOM, zero canvas, deliberately.** jsdom has no canvas and this repo refuses the `canvas`
 * npm package as a native-binary CI/sandbox risk (`src/test/canvasTestUtils.ts`), so anything
 * decided in the drawing layer is untestable. The precedent is exact: `skeletonGeometry.ts`'s
 * `toDrawOps` is fully unit-tested while `SkeletonOverlay` gets a thin smoke test. Everything
 * decidable is decided here.
 *
 * **Timestamps come from `robustFrames[].timestamp` and nothing else.** `VideoMetadata.durationSec`
 * does not appear in this module, and this module's frame-size parameter is deliberately narrowed
 * to `{ width, height }` so it cannot: MediaRecorder WebM blobs commonly report an infinite
 * duration and `useVideoSource.ts` copies `video.duration` in unguarded, so any
 * fraction-of-duration arithmetic would produce garbage on webcam clips.
 */

/**
 * Relative enlargement of the box the exemplar's own crop keypoints produced. ONE pair of
 * constants for every metric, not a per-metric table: per-metric framing already exists one layer
 * up, in the seed ∪ context keypoint set each metric names on its own exemplars, so a foot crop
 * and a full-body crop already differ by an order of magnitude before any padding. A second
 * per-metric table would vary apparent subject scale across the gallery, which is the one thing a
 * single aspect ratio exists to hold constant.
 *
 * Lower than the tracking crop's 1.75 because the two buy different things. The tracking crop pads
 * for MOTION — its box is one frame old and the subject moves before the next inference. This box
 * is the union across both frames it will actually draw, so the motion is already inside it and
 * padding buys context only. `computeCropRect` squares by taking `max(width, height)`, so on the
 * tall-thin box a human produces the multiplier only controls the long-axis margin: 1.6 leaves
 * 30% of the box's own long dimension as margin at each end.
 */
export const EVIDENCE_CROP_PADDING_MULTIPLIER = 1.6

/**
 * Floor on the crop's side, in native video pixels — a guard against a DEGENERATE box, not a
 * target. `max(boxWidth, boxHeight) × 1.6` is `0` for a seed that resolves to a single point (one
 * hip with no resolvable context, or a knee/hip/ankle that nearly align), and without the floor
 * that crop is empty.
 *
 * Chosen against the VIEWER rather than a detector: a gallery image is on the order of 200-400 CSS
 * px, so 320 native px survives a 2× DPR display without upscaling to mush. Note
 * `computeCropRect` applies its `min(frameWidth, frameHeight)` cap LAST, so on a small source
 * (a 320×240 webcam clip) the cap wins and this floor can never demand pixels the source lacks.
 */
export const EVIDENCE_CROP_MIN_SIDE_PX = 320

/** The base instant is drawn first, at full opacity. */
export const EVIDENCE_BASE_OPACITY = 1
/**
 * The ghost is composited over the base at half opacity, making the result a symmetric 50/50
 * double exposure: on a static camera the identical background reproduces exactly while the two
 * body positions each render at half weight. Unequal opacities make the ghost read as a mistake
 * rather than a second instant. One fixed pair for every metric — a per-metric opacity table would
 * be taste with no evidence behind it.
 */
export const EVIDENCE_GHOST_OPACITY = 0.5

/**
 * Intersection-over-union above which a pair's two per-frame boxes are treated as the same
 * instant. A ghost of two indistinguishable frames is a blurry mess rather than a delta, and a
 * blurry double exposure is worse than one clean still.
 */
export const EVIDENCE_NEAR_IDENTICAL_IOU = 0.98

/**
 * Metrics that emit no exemplars by design, so their absence is a decision rather than this run's
 * candidates all being gated out. `cadence` is a property of a SEQUENCE — two stills of a bounce
 * peak and trough depict an amplitude, which is the number the vertical-oscillation card reports
 * and the one cadence does not.
 */
const METRICS_WITHOUT_EVIDENCE: ReadonlySet<MetricId> = new Set(['cadence'])

/**
 * Exemplar kinds that still say something true from ONE frame, and may therefore be demoted to a
 * single rather than dropped when their pair collapses. A footstrike measured against the hip
 * midline is one whole measurement; a RANGE (`trunkLeanRange`, `overstrideRange`), a CYCLE
 * (`bounceCycle`, `armSwingCycle`, `stridePair`) or a peak that needs its adjacent trough to be
 * legible (`kneeFlexionPeak`) has nothing to say from one instant, so a collapsed pair of those
 * is dropped instead.
 *
 * Keyed on the exemplar's own `kind` rather than on `MetricId` deliberately: the kind is what the
 * exemplar says about itself and travels with it, so this module never has to hold an opinion
 * about what a given metric measured.
 */
const SINGLE_INSTANT_KINDS: ReadonlySet<MetricExemplarKind> = new Set([
  'footStrike',
  'stepWidthStrike',
])

/**
 * The clip's pixel dimensions, in the video's own native resolution — deliberately NOT
 * `VideoMetadata`, whose `durationSec` must not be reachable from this module (see the module
 * doc). A `VideoMetadata` value passes straight in.
 */
export interface EvidenceFrameSize {
  width: number
  height: number
}

/**
 * One keypoint an exemplar named, at one instant, in NATIVE VIDEO PIXELS — the same space
 * `crop` is in, so `toEvidenceOutputSpace` is the single step between the two.
 *
 * Three-state by construction, not two: `resolvePoint` treats `'detected'` and `'interpolated'`
 * alike as *resolvable* and only `'unrecoverable'` as absent, and collapsing that to
 * resolvable/not would erase exactly the distinction an annotation exists to show — an
 * interpolated joint is a position the pipeline INFERRED, and a thumbnail that draws it as
 * confidently as a detected one overstates what was measured. The unrecoverable arm carries no
 * coordinates at all, so a mark for it cannot be accidentally anchored at the origin: the type
 * makes "drop the mark" the only reachable option.
 */
export type EvidenceKeypointPosition =
  | {
      name: KeypointName
      status: 'detected' | 'interpolated'
      x: number
      y: number
    }
  | { name: KeypointName; status: 'unrecoverable' }

/**
 * Which screen-x direction counts as "outward" (away from the body's midline) for each side, at
 * ONE instant. `stepWidth`/`stepWidthCm` multiply their raw `ankle.x - hipMid.x` by this to turn
 * it into "landed on its own side" (+) versus "crossed over" (−) (`stepWidth.ts:222-224`), so a
 * caliper drawn without it points the wrong way on exactly half of all clips.
 *
 * Per-INSTANT, never clip-wide: the metric recomputes it at every footstrike from that frame's
 * own hips, and a runner's hips swap screen sides whenever the camera crosses them.
 */
export interface EvidenceOutwardSigns {
  left: 1 | -1
  right: 1 | -1
}

/** `0` is "indeterminate", not "no travel" — `estimateTravelDirection` returns it below a
 * half-torso net displacement, and a mark whose orientation depends on it must then be drawn
 * unoriented rather than guessed. */
export type EvidenceTravelDirection = 1 | -1 | 0

/** One frame of a plan: which instant to seek to, at what opacity to draw it, and everything an
 * annotation of that instant needs. */
export interface EvidenceInstantPlan {
  /**
   * Seconds on the clip's own media clock — the timestamp of the SAMPLED frame this instant
   * snapped to, not the continuous timestamp the exemplar asked for. The extractor seeks to a
   * frame that exists.
   */
  timestamp: number
  opacity: number
  /**
   * The exemplar's own named keypoints, resolved at THIS instant, in the exemplar's order and
   * deduplicated. Both halves of a ghosted pair carry their own list, so an annotation of the
   * base and an annotation of the ghost are independently drawable.
   *
   * Deliberately the exemplar's `cropKeypoints` and not the whole skeleton: the metric that
   * measured the instant is the only layer that knows which points its measurement is about, and
   * a tight crop drawn with all 21 points is mostly marks for joints outside the frame
   * (design D5).
   */
  keypoints: EvidenceKeypointPosition[]
  /** `null` when this frame's two hips do not both independently resolve, or resolve to the same
   * x — the degenerate case `stepWidth` records and hard-rejects (`stepWidth.ts:230`). Guessing a
   * side here would be a false statement about which way the runner's foot crossed. */
  outwardSign: EvidenceOutwardSigns | null
}

/** One renderable image: a base frame, optionally a ghost composited over it, and the square crop
 * both are drawn through. */
export interface EvidenceFramePlan {
  metric: MetricId
  kind: MetricExemplarKind
  /** Present only where the metric measures per side and both instants share it. */
  side?: 'left' | 'right'
  quality: number
  label: string
  base: EvidenceInstantPlan
  /** `null` for a single-instant exemplar, and for a pair that collapsed to its base. */
  ghost: EvidenceInstantPlan | null
  /** Square, in native video pixels — the display size is the gallery's decision, not this one. */
  crop: CropRectPx
  /**
   * Which way the runner is travelling across the frame, clip-wide. `trunkLean` (`:171`),
   * `overstriding` (`:177`), `footStrikePattern` (`:192`) and `strideLength` (`:182`) all
   * multiply their raw screen-relative offset by it, so on a right-to-left runner the reported
   * sign is the OPPOSITE of the on-screen one — an arrow or arc oriented from the picture alone
   * would point the wrong way with nothing to catch it.
   *
   * Same value on every item of a clip. Duplicated per item rather than hung off
   * `ClipEvidencePlan`, which is a total `Record<MetricId, …>` with no room for a sibling key,
   * and duplication keeps the draw layer from needing a second lookup.
   */
  travelDirection: EvidenceTravelDirection
  /** The exemplar arrived as a pair and is planned as a single: its two instants were
   * indistinguishable, or the ghost could not be resolved to a sampled frame. */
  demotedFromPair: boolean
}

/**
 * Why a metric has no evidence, distinguished so the UI (and the coverage line) can tell "this
 * metric never emits" from "this run produced nothing" from "we never got as far as trying".
 *
 * - `not-emitted` — the metric emits no exemplars by design (`cadence`).
 * - `all-gated-out` — candidates existed and none survived the quality gate or this layer's own
 *   resolution rules.
 * - `metric-excluded` — the metric renders no card at all (no value, or camera geometry that
 *   cannot support the measurement), so there is nothing for a picture to explain.
 * - `frames-unavailable` — the clip has no usable sampled frames or no usable pixel dimensions.
 * - `extraction-failed` — planned fine, but the impure extractor could not produce the image. Never
 *   produced by this module; the layer that extracts substitutes it before summarizing.
 */
export type EvidenceUnavailableReason =
  | 'not-emitted'
  | 'all-gated-out'
  | 'metric-excluded'
  | 'frames-unavailable'
  | 'extraction-failed'

/** Discriminated so "no evidence" is never an empty array indistinguishable from "not computed
 * yet". */
export type MetricEvidencePlan =
  | { status: 'planned'; items: EvidenceFramePlan[] }
  | { status: 'no-evidence'; reason: EvidenceUnavailableReason }

/** Every metric gets an entry — a missing key would reintroduce exactly the ambiguity the
 * discriminated result above exists to remove. */
export type ClipEvidencePlan = Record<MetricId, MetricEvidencePlan>

/**
 * Half the median interval between consecutive sampled frames — the distance beyond which a
 * requested instant is closer to some other frame than to the one `findNearestFrame` returned.
 *
 * A tolerance is mandatory rather than nice-to-have: `findNearestFrame` CLAMPS and carries no
 * distance limit of its own, so without this check a timestamp from a different clip (or from a
 * separately-sampled scale pass) resolves silently to the first or last frame of this one.
 *
 * `null` below two frames, where there is no interval to measure.
 */
export function evidenceSnapToleranceSeconds(
  frames: RobustPoseFrame[],
): number | null {
  if (frames.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < frames.length; i += 1) {
    intervals.push(frames[i].timestamp - frames[i - 1].timestamp)
  }
  const tolerance = median(intervals) / 2
  return Number.isFinite(tolerance) && tolerance > 0 ? tolerance : null
}

/** `findNearestFrame` plus the distance check it does not provide. `null` when the nearest frame
 * is further away than the tolerance allows — a foreign timestamp is rejected, never clamped. */
export function snapToSampledFrame(
  frames: RobustPoseFrame[],
  timestamp: number,
  toleranceSeconds: number,
): RobustPoseFrame | null {
  const frame = findNearestFrame(frames, timestamp)
  if (frame === null) return null
  return Math.abs(frame.timestamp - timestamp) <= toleranceSeconds ? frame : null
}

/**
 * Axis-aligned box over a set of positions. `null` for an empty set, and non-finite coordinates
 * are skipped rather than poisoning the box into `Infinity` — the robustness layer should never
 * emit one, but a box is what the whole crop is derived from and an unbounded rect is worse than
 * no rect.
 *
 * Deliberately NOT `deriveBoundingBox` (`movenetCrop.ts`): that one takes raw scored keypoints and
 * hard-excludes the head and foot names, which is the opposite of what the per-metric crop sets
 * ask for — `trunkLean` seeds on the head to read "upright", and `footStrikePattern` on the foot.
 */
export function boundingBoxOfPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): BoundingBoxPx | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

/**
 * The box the exemplar's own crop keypoints occupy at one frame. Any keypoint that does not
 * resolve is simply omitted — context keypoints are strictly optional (`left_heel` and friends are
 * MediaPipe-only and resolve `'unrecoverable'` on MoveNet, the default backend), so a crop must be
 * well-defined from whatever part of the set does resolve. `null` when none of them do.
 */
export function frameCropBox(
  frame: RobustPoseFrame,
  cropKeypoints: KeypointName[],
): BoundingBoxPx | null {
  const points = cropKeypoints
    .map((name) => resolvePoint(frame, name))
    .filter((point): point is NonNullable<typeof point> => point !== null)
  return boundingBoxOfPoints(points)
}

/**
 * The exemplar's named keypoints resolved at one frame, in native video pixels — the annotation
 * half of what `frameCropBox` does for the crop half, sharing `resolvePoint` so the two can never
 * disagree about whether a point exists.
 *
 * Every named keypoint gets an entry, including the ones that did not resolve: "this metric never
 * named that joint" and "it named it and the pipeline lost it" are different facts, and only the
 * second one is worth telling a reader about. Duplicates are dropped so a name appearing twice in
 * an exemplar's crop set (two same-side seeds unioned across a pair, say) cannot produce two marks
 * stacked at one position.
 */
export function resolveInstantKeypoints(
  frame: RobustPoseFrame,
  names: KeypointName[],
): EvidenceKeypointPosition[] {
  return [...new Set(names)].map((name) => {
    const point = resolvePoint(frame, name)
    if (point === null) return { name, status: 'unrecoverable' as const }
    return {
      name,
      status: point.interpolated ? ('interpolated' as const) : ('detected' as const),
      x: point.x,
      y: point.y,
    }
  })
}

/**
 * `stepWidth`'s per-footstrike outward polarity, recomputed here from the frame's own hips —
 * `stepWidth.ts:222-223` verbatim, not an approximation of it, including its STRICT bilateral
 * gate (`resolveBilateralPair`, not the tolerant `resolveMidpoint`): a hip-mid that collapsed onto
 * one side would make `sideHip.x - hipMid.x` identically zero and the sign meaningless, which is
 * the exact bug that file was fixed for.
 *
 * **"Verbatim" holds for the PRIMARY pass only — it is FALSE for the two GRAFTED metrics.**
 * `stepWidthCm` and `verticalOscillationCm` arrive from the background MediaPipe scale pass
 * (`scalePassGraft.ts:43-50`), which carries its exemplars' timestamps but NOT its
 * `RobustPoseFrame[]`: "the only frames any consumer holds are the primary pass's". Every caller
 * of this function passes a primary-pass (MoveNet) frame snapped to the grafted timestamp, so for
 * those two metrics the polarity below is recomputed from a DIFFERENT detector's estimate of the
 * same instant, not from the frame the metric measured. At a near-frontal step-width strike the
 * two hips sit a few pixels apart and the two detectors can order them oppositely, so the sign
 * here can be the inverse of the one `stepWidth.ts:222` used — which would label a crossover
 * strike as landing on its own side, contradicting that file's own crossover caveat (`:273-277`).
 *
 * The annotation layer therefore refuses to orient any mark for a grafted metric — see
 * `GRAFTED_METRICS` in `evidenceAnnotations.ts`, which is where that decision is recorded. This
 * function keeps returning the value, because it is still the correct polarity for the frame it
 * was handed; what is not correct is attributing it to a grafted metric's measurement.
 *
 * `null` rather than the metric's `|| 1` fallback where the sign is zero. The metric needs a
 * number to finish an arithmetic expression and records the frame as `degenerate` so the exemplar
 * is rejected; a plan has no such obligation and an annotation must simply not claim a direction
 * it cannot derive.
 */
export function resolveOutwardSigns(
  frame: RobustPoseFrame,
): EvidenceOutwardSigns | null {
  const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
  if (hips === null) return null
  const hipMidX = (hips.left.x + hips.right.x) / 2
  // Each side is signed against the midline independently rather than one being negated from the
  // other: exact antisymmetry holds in real arithmetic but a float midpoint need not sit exactly
  // between its endpoints, and a derived sign that disagreed with a measured one would be worse
  // than no sign.
  const left = Math.sign(hips.left.x - hipMidX)
  const right = Math.sign(hips.right.x - hipMidX)
  if (left === 0 || right === 0) return null
  return { left: left as 1 | -1, right: right as 1 | -1 }
}

/**
 * The clip's direction of travel, computed the way the METRICS compute it and not merely the way
 * that reads naturally here: over the presence-TRIMMED frames, with a body scale estimated from
 * those same trimmed frames.
 *
 * This is load-bearing, not tidiness. The plan is handed the UNTRIMMED `robustFrames` while
 * `runClipAnalysisPipeline.ts:59-60` hands `computeFormHeuristics` the output of
 * `trimToPresenceWindow`, and the two arrays can disagree about the sign outright — not only near
 * the indeterminate threshold. `estimateTravelDirection` reads the first and last frame where
 * hip-mid resolves *at all*, while the presence trim also demands shoulder-mid and a minimum run
 * length, so a frame outside the window (a bystander, or the subject with an occluded torso) can
 * supply an endpoint the metric never saw and flip the sign with both readings well clear of the
 * threshold. `evidenceFrames.test.ts` builds exactly that clip. Reproducing the metrics' own input
 * removes the disagreement by construction instead of arguing it is rare.
 *
 * Both `trimToPresenceWindow` and `computeFormHeuristics` are called at their default
 * `HeuristicsConfig` in that pipeline, which is why this needs no config of its own — if either
 * call ever takes a non-default config, this one has to take the same one.
 */
export function evidenceTravelDirection(
  frames: RobustPoseFrame[],
): EvidenceTravelDirection {
  const metricFrames = trimToPresenceWindow(frames)
  const bodyScale = estimateBodyScale(metricFrames)
  if (bodyScale === null) return 0
  return estimateTravelDirection(metricFrames, bodyScale)
}

/**
 * The side of the square canvas one crop is drawn into. Owned here rather than in the extractor
 * so the pure layer can express the video→output transform below without importing the impure
 * module; the cap arrives as an argument for the same reason (`EVIDENCE_OUTPUT_MAX_SIDE_PX` lives
 * next to the drawing, and importing it here would be a cycle).
 *
 * The crop is never UPSCALED to reach the cap — `min` before `round`, so a small crop keeps its
 * own size.
 */
export function evidenceOutputSide(
  cropSide: number,
  maxOutputSidePx: number,
): number {
  return Math.max(1, Math.round(Math.min(cropSide, maxOutputSidePx)))
}

/**
 * Native video pixels → the output canvas's own coordinate space. The forward direction of
 * `movenet.ts:86-95`'s `toVideoSpaceKeypoints`, and the algebra implicit in the nine-argument
 * `drawImage` the extractor issues — written here, in the pure half, so annotation geometry is
 * asserted by tests rather than by looking at a picture.
 *
 * **The scale is `outputSide / crop.side`, not `maxOutputSidePx / crop.side`.** The rounding is in
 * the numerator only and `computeCropRect` returns a FLOAT side, so the scale is ≠ 1 even for a
 * crop well under the cap. Assuming otherwise puts every mark a fraction of a pixel off on most
 * clips and visibly off on some.
 */
export function toEvidenceOutputSpace(
  point: { x: number; y: number },
  crop: CropRectPx,
  outputSide: number,
): { x: number; y: number } {
  const scale = outputSide / crop.side
  return { x: (point.x - crop.x) * scale, y: (point.y - crop.y) * scale }
}

function unionBoxes(boxes: BoundingBoxPx[]): BoundingBoxPx | null {
  if (boxes.length === 0) return null
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  }
}

function isUsableFrameSize(frameSize: EvidenceFrameSize): boolean {
  return (
    Number.isFinite(frameSize.width) &&
    Number.isFinite(frameSize.height) &&
    frameSize.width > 0 &&
    frameSize.height > 0
  )
}

/**
 * The square crop both frames of an exemplar are drawn through, unioned across every frame passed
 * so a ghost reads as one runner at two instants rather than as two different shots.
 *
 * Padding, squaring and clamping all come from `computeCropRect`, reused rather than
 * reimplemented: it already clamps to the frame by SHIFTING rather than shrinking, so the returned
 * side is always exactly what the padding/floor/cap math produced, and a subject half out of frame
 * yields an in-bounds rect rather than a negative-width one. Squareness is what makes the gallery
 * read as a coherent set rather than a ragged pile.
 */
export function computeEvidenceCropRect(
  frames: RobustPoseFrame[],
  cropKeypoints: KeypointName[],
  frameSize: EvidenceFrameSize,
): CropRectPx | null {
  if (!isUsableFrameSize(frameSize)) return null
  const boxes = frames
    .map((frame) => frameCropBox(frame, cropKeypoints))
    .filter((box): box is BoundingBoxPx => box !== null)
  const union = unionBoxes(boxes)
  if (union === null) return null
  return computeCropRect(
    union,
    frameSize.width,
    frameSize.height,
    EVIDENCE_CROP_PADDING_MULTIPLIER,
    EVIDENCE_CROP_MIN_SIDE_PX,
  )
}

/** The sampled frames one exemplar resolves to. `ghost` is `null` for a single-instant exemplar
 * and for a pair whose ghost half did not snap. */
export interface ResolvedExemplarFrames {
  base: RobustPoseFrame
  ghost: RobustPoseFrame | null
  /** The exemplar named a paired instant that could not be resolved to a sampled frame. */
  ghostUnresolved: boolean
}

/**
 * Exemplar → the sampled frames it names. `null` when the BASE does not snap: the base is the
 * instant the reported value is most directly about, so an exemplar that cannot name it has no
 * picture to show.
 *
 * The base is `timestamp` and the ghost is `pairedTimestamp`, read straight off the exemplar
 * rather than re-derived. Which of a pair is the base was decided by the metric that emitted it —
 * furthest from its own median for a range exemplar, closest for a representative one — and this
 * module cannot recompute that: a metric's per-instance distribution is not reachable from here,
 * and for a bounce cycle or a stride pair the two instants share one value and there is no median
 * to be distant from at all.
 */
export function resolveExemplarFrames(
  exemplar: MetricExemplar,
  frames: RobustPoseFrame[],
  toleranceSeconds: number,
): ResolvedExemplarFrames | null {
  const base = snapToSampledFrame(frames, exemplar.timestamp, toleranceSeconds)
  if (base === null) return null
  if (exemplar.pairedTimestamp === undefined) {
    return { base, ghost: null, ghostUnresolved: false }
  }
  const ghost = snapToSampledFrame(
    frames,
    exemplar.pairedTimestamp,
    toleranceSeconds,
  )
  return { base, ghost, ghostUnresolved: ghost === null }
}

/**
 * Whether a pair's two boxes describe the same picture — one of the two near-identical tests, the
 * other being both instants snapping to the same sampled frame, which `planExemplarFrames` applies
 * directly since it holds the frames.
 *
 * The comparison is between the two unpadded per-frame boxes, NOT between two padded crop rects.
 * The padded rect is a single union across both frames, so there is only one of it to compare;
 * and even derived per frame it would be the wrong input, because padding, squaring, the 320 px
 * floor and the frame clamp each compress differences — two genuinely different instants near a
 * frame edge can clamp to the identical square, and any small box lands on the floor. The
 * unpadded box is the body geometry at that instant, which is what "do these two look the same"
 * means.
 */
export function isNearIdenticalPair(
  baseBox: BoundingBoxPx,
  ghostBox: BoundingBoxPx,
): boolean {
  // Exact equality first, because IoU cannot see it on a DEGENERATE box: `computeBoundingBoxIoU`
  // returns 0 whenever the intersection has zero area, so two boxes that collapsed to the same
  // single point — or to the same perfectly horizontal line, which a bilateral pair at one height
  // produces — would otherwise read as "completely different" and ship the blurry double exposure
  // this check exists to prevent. Strict equality needs no threshold of its own and cannot fire on
  // a pair that genuinely moved.
  if (
    baseBox.minX === ghostBox.minX &&
    baseBox.minY === ghostBox.minY &&
    baseBox.maxX === ghostBox.maxX &&
    baseBox.maxY === ghostBox.maxY
  ) {
    return true
  }
  return computeBoundingBoxIoU(baseBox, ghostBox) >= EVIDENCE_NEAR_IDENTICAL_IOU
}

/**
 * One resolved frame → the instant the extractor seeks to and the annotation layer draws over.
 * Everything positional is captured HERE, while the `RobustPoseFrame` is still in hand — the plan
 * is the last place that holds it, and re-resolving downstream would either need the frames
 * threaded into the impure extractor or a second snap that could land on a different frame.
 */
function instantPlan(
  frame: RobustPoseFrame,
  cropKeypoints: KeypointName[],
  opacity: number,
): EvidenceInstantPlan {
  return {
    timestamp: frame.timestamp,
    opacity,
    keypoints: resolveInstantKeypoints(frame, cropKeypoints),
    outwardSign: resolveOutwardSigns(frame),
  }
}

/**
 * One exemplar → one renderable plan, or `null` when it cannot be rendered honestly.
 *
 * A pair collapses to its base — demoted for a kind that still says something true from one frame,
 * dropped otherwise — when its ghost does not resolve to a sampled frame, when both halves land on
 * the same frame, when the ghost frame has no resolvable crop keypoint (so there is no evidence
 * the measured region is even inside the crop at that instant), or when the two per-frame boxes
 * are near-identical.
 *
 * `travelDirection` is threaded in rather than derived per exemplar because it is a property of
 * the CLIP: `planClipEvidence` computes it once and every item of every metric carries the same
 * value. The default keeps this function independently callable — it is exported and unit-tested
 * directly — and derives the identical number from the same frames.
 *
 * The parameter is a plain override, NOT a guarantee: passing an explicit value that disagrees
 * with `evidenceTravelDirection(frames)` yields a plan whose sign contradicts its own frames, and
 * nothing here rejects that. Every in-repo caller passes the derived value. If you are writing a
 * new caller, pass the derived value or omit the argument — an inverted sign silently flips the
 * direction of every caliper drawn from this plan, and no test downstream will catch it.
 */
export function planExemplarFrames(
  metric: MetricId,
  exemplar: MetricExemplar,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
  toleranceSeconds: number,
  travelDirection: EvidenceTravelDirection = evidenceTravelDirection(frames),
): EvidenceFramePlan | null {
  const resolved = resolveExemplarFrames(exemplar, frames, toleranceSeconds)
  if (resolved === null) return null

  const baseBox = frameCropBox(resolved.base, exemplar.cropKeypoints)
  if (baseBox === null) return null

  const ghostBox =
    resolved.ghost === null
      ? null
      : frameCropBox(resolved.ghost, exemplar.cropKeypoints)

  const isPair = exemplar.pairedTimestamp !== undefined
  const pairCollapsed =
    isPair &&
    (resolved.ghost === null ||
      ghostBox === null ||
      resolved.ghost === resolved.base ||
      isNearIdenticalPair(baseBox, ghostBox))

  if (pairCollapsed && !SINGLE_INSTANT_KINDS.has(exemplar.kind)) return null

  const ghost = pairCollapsed ? null : resolved.ghost
  const drawnFrames =
    ghost === null ? [resolved.base] : [resolved.base, ghost]
  const crop = computeEvidenceCropRect(
    drawnFrames,
    exemplar.cropKeypoints,
    frameSize,
  )
  if (crop === null) return null

  return {
    metric,
    kind: exemplar.kind,
    ...(exemplar.side === undefined ? {} : { side: exemplar.side }),
    quality: exemplar.quality,
    label: exemplar.label,
    base: instantPlan(
      resolved.base,
      exemplar.cropKeypoints,
      EVIDENCE_BASE_OPACITY,
    ),
    ghost:
      ghost === null
        ? null
        : instantPlan(ghost, exemplar.cropKeypoints, EVIDENCE_GHOST_OPACITY),
    crop,
    travelDirection,
    demotedFromPair: isPair && ghost === null,
  }
}

/**
 * One metric → its evidence, or a named reason there is none.
 *
 * The quality gate and the per-metric budget are re-applied here rather than trusted from
 * upstream. Both are the same constants imported from the same module, so the two layers cannot
 * drift; re-asserting them means an exemplar that reached a `MetricResult` without going through
 * the shared selector still cannot render as evidence, and the gallery gets a hard bound on how
 * many images one card can grow. The budget is applied AFTER this layer's own drops, so a metric
 * whose first choice cannot be resolved here still spends its second — and without re-sorting,
 * because the emitting metric already ranked them and a second ranking here could disagree.
 */
export function planMetricEvidence(
  metric: MetricResult,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
  travelDirection: EvidenceTravelDirection = evidenceTravelDirection(frames),
): MetricEvidencePlan {
  // Evidence renders only for metrics that render a card. A tier-3 metric has no card to hang a
  // deep link on, and a picture explaining a number the app declined to report — or one the camera
  // geometry could not support — is a picture of a measurement that was not made.
  if (metricTier(metric) === 'excluded') {
    return { status: 'no-evidence', reason: 'metric-excluded' }
  }
  if (METRICS_WITHOUT_EVIDENCE.has(metric.metric)) {
    return { status: 'no-evidence', reason: 'not-emitted' }
  }

  const tolerance = evidenceSnapToleranceSeconds(frames)
  if (tolerance === null || !isUsableFrameSize(frameSize)) {
    return { status: 'no-evidence', reason: 'frames-unavailable' }
  }

  const candidates = (metric.exemplars ?? []).filter(
    (exemplar) => exemplar.quality >= MIN_EXEMPLAR_QUALITY,
  )
  const items = candidates
    .map((exemplar) =>
      planExemplarFrames(
        metric.metric,
        exemplar,
        frames,
        frameSize,
        tolerance,
        travelDirection,
      ),
    )
    .filter((item): item is EvidenceFramePlan => item !== null)
    .slice(0, MAX_EXEMPLARS_PER_METRIC)

  return items.length > 0
    ? { status: 'planned', items }
    : { status: 'no-evidence', reason: 'all-gated-out' }
}

/**
 * One clip's whole plan, one entry per metric. Iterates the heuristics result's own property order
 * (minus `view`, which is not a metric) the same way `computeAnalysisDiagnostics` does, so the key
 * order is fixed and the coverage line downstream stays diffable between runs.
 */
export function planClipEvidence(
  heuristics: FormHeuristicsResult,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
): ClipEvidencePlan {
  const metricEntries = Object.entries(heuristics).filter(
    (entry): entry is [MetricId, FormHeuristicsResult[MetricId]] =>
      entry[0] !== 'view',
  )
  // Once per clip, not once per metric: it costs three passes over every frame and eleven metrics
  // asking the same question of the same array would get the same answer eleven times.
  const travelDirection = evidenceTravelDirection(frames)
  const plan = {} as ClipEvidencePlan
  for (const [id, metric] of metricEntries) {
    plan[id] = planMetricEvidence(metric, frames, frameSize, travelDirection)
  }
  return plan
}

/**
 * One clip's contribution to the coverage line. `plan` is that clip's own plan, with any
 * `'extraction-failed'` verdict already substituted by the layer that extracted — this module
 * never produces that reason, and summarizing before extraction has settled would report a pending
 * state as a verdict.
 */
export interface EvidenceCoverageClip {
  clipIndex: number
  /** That clip's `robustFrames.length`. */
  frameCount: number
  plan: ClipEvidencePlan
}

export interface EvidenceCoverageExemplar {
  kind: MetricExemplarKind
  side?: 'left' | 'right'
  quality: number
  timestamp: number
  /** `null` on a single, and after a near-identical demotion. */
  pairedTimestamp: number | null
  demotedFromPair: boolean
  cropSidePx: number
}

export interface EvidenceCoverageMetric {
  status: 'planned' | 'no-evidence'
  /** `null` iff `status === 'planned'`. */
  reason: EvidenceUnavailableReason | null
  exemplars: EvidenceCoverageExemplar[]
}

export interface EvidenceCoveragePayload {
  clips: Array<{
    clipIndex: number
    frameCount: number
    metrics: Partial<Record<MetricId, EvidenceCoverageMetric>>
  }>
  /** Per-metric winning clip index across a multi-clip session, so N-clip provenance is checkable
   * without reading it off the DOM. */
  sourceIndices: Partial<Record<MetricId, number>>
}

/**
 * The `[evidence-coverage]` payload, built purely. The layer that owns the console emits it once
 * per run, DEV-gated; this function does no logging and touches no DOM, so the schema is
 * unit-testable on its own.
 *
 * **Nothing image-shaped, ever** — no `ImageBitmap`, canvas, `Blob`, object URL or data URI is
 * reachable from here. Numbers and enums only; a crop rect's SIDE is a number and is fine, a crop
 * is not. And no metric `value`/`confidence`: `[analysis-diagnostics]` already carries those, and
 * two sources of truth for the same number can disagree. `quality` here is the exemplar's own gate
 * score, which that line does not carry.
 *
 * `timestamp`/`pairedTimestamp` are on it deliberately — they are exactly what a
 * `ffmpeg -i clip -ss <t> -frames:v 1` ground-truthing pass needs as input.
 */
export function summarizeEvidenceCoverage(
  clips: EvidenceCoverageClip[],
  sourceIndices: Partial<Record<MetricId, number>>,
): EvidenceCoveragePayload {
  return {
    clips: clips.map((clip) => {
      const metrics: Partial<Record<MetricId, EvidenceCoverageMetric>> = {}
      for (const [id, entry] of Object.entries(clip.plan) as Array<
        [MetricId, MetricEvidencePlan]
      >) {
        metrics[id] =
          entry.status === 'planned'
            ? {
                status: 'planned',
                reason: null,
                exemplars: entry.items.map((item) => ({
                  kind: item.kind,
                  ...(item.side === undefined ? {} : { side: item.side }),
                  quality: item.quality,
                  timestamp: item.base.timestamp,
                  pairedTimestamp: item.ghost?.timestamp ?? null,
                  demotedFromPair: item.demotedFromPair,
                  cropSidePx: item.crop.side,
                })),
              }
            : { status: 'no-evidence', reason: entry.reason, exemplars: [] }
      }
      return {
        clipIndex: clip.clipIndex,
        frameCount: clip.frameCount,
        metrics,
      }
    }),
    sourceIndices,
  }
}
