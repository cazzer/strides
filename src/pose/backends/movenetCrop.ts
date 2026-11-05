import type { Keypoint } from '../types'

export interface BoundingBoxPx {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface CropRectPx {
  x: number
  y: number
  side: number
}

/**
 * Head keypoints are deliberately EXCLUDED from bbox derivation. The crop was designed and
 * verified (2026-08-11) against the pre-head-widening 12 limb/torso COMMON_KEYPOINT_NAMES; a
 * 2026-08-13 live A/B of the 15-point box (nose/ears included) measured it strictly worse than
 * both the 12-point box's original result and the crop-disabled baseline — head points inflate
 * the padded box side (~560px → ~674px on the reference fixture, less zoom benefit) and their
 * jitter destabilizes the box frame-to-frame (track detectedFrames 69-72 vs 75 disabled; park
 * cadence/VO confidence roughly halved). Limb extremities stay in on purpose: this app's metrics
 * depend on wrists/ankles a torso-only box would clip mid-stride.
 *
 * Foot keypoints (heel/foot_index, #44) are excluded too, but for a different reason: no A/B
 * evidence, just COCO-17 topology. This function's box was designed and empirically tuned around
 * COCO-17-shaped limb/torso points; MoveNet (the only backend this crop ever runs against) never
 * produces heel/foot_index at all, so they'd resolve to `{x:0,y:0,score:0}` via toPoseFrame's
 * missing-subset-keypoint default and get excluded from the box incidentally on every real call.
 * They're listed explicitly anyway rather than relying on that: coupling this function's
 * correctness to an unrelated module's default-fill contract, with no reference between the two,
 * is fragile — and `minKeypointConfidence` is runtime-overridable down to 0 via
 * `window.__STRIDES_POSE_BACKEND_OVERRIDE__`, which would silently defeat incidental exclusion by
 * confidence alone.
 */
const BBOX_EXCLUDED_KEYPOINT_NAMES = new Set([
  'nose',
  'left_ear',
  'right_ear',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
])

/**
 * Bounding box over the non-head keypoints scoring at or above `minKeypointConfidence`, or
 * `null` if fewer than `minConfidentKeypoints` qualify ("not usable" — the caller should not
 * engage/continue crop-mode tracking off this frame). Operates on this app's
 * already-`toPoseFrame`-mapped `COMMON_KEYPOINT_NAMES` minus `BBOX_EXCLUDED_KEYPOINT_NAMES`
 * (see above), not a backend's raw output.
 */
export function deriveBoundingBox(
  keypoints: Keypoint[],
  minKeypointConfidence: number,
  minConfidentKeypoints: number,
): BoundingBoxPx | null {
  const confident = keypoints.filter(
    (k) =>
      k.score >= minKeypointConfidence &&
      !BBOX_EXCLUDED_KEYPOINT_NAMES.has(k.name),
  )
  if (confident.length < minConfidentKeypoints) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const k of confident) {
    if (k.x < minX) minX = k.x
    if (k.y < minY) minY = k.y
    if (k.x > maxX) maxX = k.x
    if (k.y > maxY) maxY = k.y
  }

  return { minX, minY, maxX, maxY }
}

/** `box`'s area in px^2 -- the acquisition heuristic's size term (design.md's "Person-of-interest
 * scoring"). */
export function bboxArea(box: BoundingBoxPx): number {
  return (box.maxX - box.minX) * (box.maxY - box.minY)
}

/**
 * Mean keypoint score across the same non-head/non-foot-excluded set `deriveBoundingBox` scores
 * against (`BBOX_EXCLUDED_KEYPOINT_NAMES`) -- the acquisition heuristic's confidence term. Reads
 * every non-excluded `COMMON_KEYPOINT_NAMES` entry, including ones a candidate never resolved
 * (score 0 via `toPoseFrame`'s missing-keypoint default), so a candidate with fewer confidently
 * detected joints scores lower even at an identical bbox size.
 */
export function meanConfidence(keypoints: Keypoint[]): number {
  const eligible = keypoints.filter(
    (k) => !BBOX_EXCLUDED_KEYPOINT_NAMES.has(k.name),
  )
  if (eligible.length === 0) return 0
  return eligible.reduce((sum, k) => sum + k.score, 0) / eligible.length
}

/** Acquisition heuristic score: bbox area weighted by mean keypoint confidence (design.md's
 * "Person-of-interest scoring" -- acquisition case). Highest score wins. */
export function computeAcquisitionScore(
  box: BoundingBoxPx,
  keypoints: Keypoint[],
): number {
  return bboxArea(box) * meanConfidence(keypoints)
}

/** Intersection-over-union of two bounding boxes, 0 when they don't overlap at all. */
export function computeBoundingBoxIoU(
  a: BoundingBoxPx,
  b: BoundingBoxPx,
): number {
  const intersectWidth = Math.max(
    0,
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
  )
  const intersectHeight = Math.max(
    0,
    Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY),
  )
  const intersectionArea = intersectWidth * intersectHeight
  if (intersectionArea === 0) return 0

  const unionArea = bboxArea(a) + bboxArea(b) - intersectionArea
  return unionArea === 0 ? 0 : intersectionArea / unionArea
}

/** Euclidean distance between two bounding boxes' centers, in px. */
export function boundingBoxCenterDistance(
  a: BoundingBoxPx,
  b: BoundingBoxPx,
): number {
  const aCenterX = (a.minX + a.maxX) / 2
  const aCenterY = (a.minY + a.maxY) / 2
  const bCenterX = (b.minX + b.maxX) / 2
  const bCenterY = (b.minY + b.maxY) / 2
  return Math.hypot(aCenterX - bCenterX, aCenterY - bCenterY)
}

/**
 * Whether `candidate`'s center sits within `distanceMultiple * reference`'s own side
 * (`max(width, height)`) of `reference`'s center -- the reacquisition heuristic's proximity
 * fallback for when every candidate has zero IoU with the last known box (design.md's
 * "Person-of-interest scoring").
 */
export function isWithinProximityThreshold(
  candidate: BoundingBoxPx,
  reference: BoundingBoxPx,
  distanceMultiple: number,
): boolean {
  const referenceSide = Math.max(
    reference.maxX - reference.minX,
    reference.maxY - reference.minY,
  )
  return (
    boundingBoxCenterDistance(candidate, reference) <=
    distanceMultiple * referenceSide
  )
}

/**
 * Steady-state position continuity: whether `candidate`'s center could plausibly have reached its
 * position from `reference`'s in `elapsedSeconds`, at no more than `sidesPerSecond` multiples of
 * `reference`'s own side (`max(width, height)`) per second.
 *
 * Expressed as a SPEED rather than a flat distance multiple (the shape
 * `isWithinProximityThreshold` uses) because this is judged per call, and this pipeline's
 * inter-call spacing is not fixed — the playback sampler samples whatever the detector keeps up
 * with, the sequential sampler has its own density knob, and one slow frame stretches the gap
 * arbitrarily. A flat multiple would be too tight at low sample rates and useless at high ones.
 *
 * A non-positive or non-finite `elapsedSeconds` returns `false`: a zero/negative/unknown gap makes
 * the bound degenerate, and this is the wrong place to adjudicate a timestamp anomaly. The caller
 * treats that as "the speed term is unavailable", not as a rejection — its IoU test still passes
 * on its own.
 */
export function isWithinCenterSpeedBound(
  candidate: BoundingBoxPx,
  reference: BoundingBoxPx,
  sidesPerSecond: number,
  elapsedSeconds: number,
): boolean {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return false

  const referenceSide = Math.max(
    reference.maxX - reference.minX,
    reference.maxY - reference.minY,
  )
  return (
    boundingBoxCenterDistance(candidate, reference) <=
    sidesPerSecond * referenceSide * elapsedSeconds
  )
}

/**
 * Steady-state scale continuity: whether `candidate`'s area is within a factor of `maxRatio` of
 * `reference`'s, in either direction. Catches the failure position continuity structurally can't
 * — a different person at a very different distance from the camera, standing close enough to the
 * tracked subject in image space to pass every proximity test (design.md's "The gate has two
 * independent tests").
 *
 * A zero-area reference returns `false` rather than dividing by zero: there is no meaningful
 * scale to be continuous with, so the conservative answer is "not established".
 */
export function isBoundingBoxAreaRatioWithin(
  candidate: BoundingBoxPx,
  reference: BoundingBoxPx,
  maxRatio: number,
): boolean {
  const referenceArea = bboxArea(reference)
  if (referenceArea <= 0) return false

  const ratio = bboxArea(candidate) / referenceArea
  return ratio >= 1 / maxRatio && ratio <= maxRatio
}

/**
 * The shrink half of scale continuity (`strides-p1qt.18`): whether `candidate` is no smaller than
 * `recentPeakAreaPx / maxRatio`, where `recentPeakAreaPx` is the largest box the SAME track has
 * produced over a short recent window.
 *
 * `isBoundingBoxAreaRatioWithin` compares against the previous frame only, which makes it a
 * ratchet: a subject whose box shrinks a little per frame -- leaving through a frame edge, or
 * walking behind someone -- can be followed all the way down to a much smaller box, and from there
 * onto whoever was beside them. On private IMG_9345 the runner exits left at 244k -> 97k px^2 over
 * five frames (each step within 3x), and the next frame is a background runner at 45k (within 3x of
 * 97k), whom both the online gate and retroactive segmentation then follow for 20 frames.
 *
 * Every cause of a box being too small -- clipping at an edge, occlusion, keypoints dropping below
 * the confidence floor -- only ever SHRINKS it; nothing makes a person's box spuriously larger than
 * the person. So the recent peak, not the last frame, is the measure of how big this person is, and
 * shrinkage is judged against it. Growth is left to the frame-to-frame test, so an approaching or
 * entering runner is unaffected. `null` (no history) passes, and so does a box the frame edge
 * truncates (see `isTruncatedByFrameEdge`) when the caller supplies `frame`.
 */
export function isAboveRecentPeakFloor(
  candidate: BoundingBoxPx,
  recentPeakAreaPx: number | null,
  maxRatio: number,
  frame: FrameSizePx | null = null,
): boolean {
  if (recentPeakAreaPx === null || !(recentPeakAreaPx > 0)) return true
  // A box the frame edge truncates is a lower bound on the person's size: the edge already
  // explains why it is small (a runner leaving the frame), so it is no evidence of a different
  // person. Only an UNtruncated box far below the recent peak is.
  if (frame !== null && isTruncatedByFrameEdge(candidate, frame)) return true
  return bboxArea(candidate) * maxRatio >= recentPeakAreaPx
}

export interface FrameSizePx {
  width: number
  height: number
}

/**
 * How close (as a fraction of the frame's SHORTER side) a keypoint hull may come to an edge and
 * still count as cut off by it. A hull spans joints, not the body's silhouette -- hands, feet and
 * head reach beyond it -- so a body leaving through an edge shows a hull that stops short of the
 * edge, not one that touches it. Measured (strides-p1qt.18, 4K and 1080p): runners' last frames
 * before exiting end 7–31 px from the edge; the smallest gap on a person who is fully in frame
 * next to an exiting runner was 76 px (IMG_9345 f115). 2% is 43 px at 2160 and 22 px at 1080.
 */
export const FRAME_EDGE_TRUNCATION_MARGIN_FRACTION = 0.02

/** Whether `box` comes within `FRAME_EDGE_TRUNCATION_MARGIN_FRACTION` of any frame edge. */
export function isTruncatedByFrameEdge(
  box: BoundingBoxPx,
  frame: FrameSizePx,
): boolean {
  const margin =
    FRAME_EDGE_TRUNCATION_MARGIN_FRACTION * Math.min(frame.width, frame.height)
  return (
    box.minX <= margin ||
    box.minY <= margin ||
    box.maxX >= frame.width - margin ||
    box.maxY >= frame.height - margin
  )
}

/**
 * The largest area among `history` entries no older than `windowSeconds` before `atSeconds` --
 * the reference `isAboveRecentPeakFloor` needs. `null` when the window is disabled (`<= 0`) or
 * nothing in `history` falls inside it.
 */
export function recentPeakAreaPx(
  history: readonly { timestamp: number; areaPx: number }[],
  atSeconds: number,
  windowSeconds: number,
): number | null {
  if (!(windowSeconds > 0)) return null
  let peak: number | null = null
  for (const entry of history) {
    if (entry.timestamp < atSeconds - windowSeconds) continue
    if (entry.timestamp > atSeconds) continue
    if (peak === null || entry.areaPx > peak) peak = entry.areaPx
  }
  return peak
}

/**
 * The position half of `isBoundingBoxContinuous`: any bbox overlap at all, OR a center
 * displacement within the speed bound. Exported on its own for a caller whose candidate has no
 * meaningful scale — the retroactive selector's check on a sub-`minConfidentKeypoints` keypoint
 * hull, whose area says how many joints were confident, not how far away the person is.
 *
 * IoU is strictly positive only for a positive-area intersection, so a degenerate (point or line)
 * candidate never passes the first term, even lying wholly inside `reference`; only the speed term
 * can carry it.
 */
export function isPositionContinuous(
  candidate: BoundingBoxPx,
  reference: BoundingBoxPx,
  elapsedSeconds: number,
  maxCenterSpeedSidesPerSecond: number,
): boolean {
  return (
    computeBoundingBoxIoU(candidate, reference) > 0 ||
    isWithinCenterSpeedBound(
      candidate,
      reference,
      maxCenterSpeedSidesPerSecond,
      elapsedSeconds,
    )
  )
}

/** The two thresholds `isBoundingBoxContinuous` needs. Structurally a subset of
 * `ContinuityGateConfig` (which adds its own `enabled` flag) and of
 * `RetroactivePersonSelectionConfig`, so either can be passed straight in — the shape is declared
 * here, in the module that owns the geometry, rather than importing either consumer's config type
 * (which would point this leaf module back up at its callers). */
export interface BoundingBoxContinuityBounds {
  maxCenterSpeedSidesPerSecond: number
  maxAreaRatio: number
}

/**
 * Whether `candidate` could plausibly be the same person as `reference`, `elapsedSeconds` later:
 * position continuity (any bbox overlap at all, OR a center displacement within the speed bound)
 * AND scale continuity (area ratio inside the symmetric band, and -- when the caller supplies the
 * track's `recentPeakArea` -- not shrunk below it by more than the same band; see
 * `isAboveRecentPeakFloor`). Purely the composition of the two
 * geometric tests — it holds no opinion about whether continuity should be *consulted*, which is
 * each caller's own business (the online gate has its own `enabled`/no-anchor/suspended early
 * returns; the retroactive selector applies its area floor before ever asking).
 *
 * Shared by the online anchor gate (`movenet.ts`'s `isContinuousWithAnchor`) and the retroactive
 * person-selection stage (`src/results/retroactivePersonSelection.ts`'s segmentation criterion) so
 * "these two boxes are the same person" means exactly one thing in this codebase — the two answer
 * the same geometric question about the same `deriveBoundingBox` output, just at different times
 * (during the run vs. over the finished sample sequence) and with independently tuned bounds.
 */
export function isBoundingBoxContinuous(
  candidate: BoundingBoxPx,
  reference: BoundingBoxPx,
  elapsedSeconds: number,
  bounds: BoundingBoxContinuityBounds,
  recentPeakArea: number | null = null,
  frame: FrameSizePx | null = null,
): boolean {
  return (
    isPositionContinuous(
      candidate,
      reference,
      elapsedSeconds,
      bounds.maxCenterSpeedSidesPerSecond,
    ) &&
    isBoundingBoxAreaRatioWithin(candidate, reference, bounds.maxAreaRatio) &&
    isAboveRecentPeakFloor(candidate, recentPeakArea, bounds.maxAreaRatio, frame)
  )
}

/**
 * A padded, square crop rectangle (in source-video pixels) centered on `box`, clamped to stay
 * within `[0, frameWidth] × [0, frameHeight]` by shifting its position — never by shrinking its
 * side — so the returned side length is always exactly what the padding/floor/cap math produced.
 */
export function computeCropRect(
  box: BoundingBoxPx,
  frameWidth: number,
  frameHeight: number,
  paddingMultiplier: number,
  minCropSidePx: number,
): CropRectPx {
  const centerX = (box.minX + box.maxX) / 2
  const centerY = (box.minY + box.maxY) / 2
  const boxWidth = box.maxX - box.minX
  const boxHeight = box.maxY - box.minY

  const maxSide = Math.min(frameWidth, frameHeight)
  const paddedSide = Math.max(boxWidth, boxHeight) * paddingMultiplier
  const side = Math.min(Math.max(paddedSide, minCropSidePx), maxSide)

  const x = Math.min(Math.max(centerX - side / 2, 0), frameWidth - side)
  const y = Math.min(Math.max(centerY - side / 2, 0), frameHeight - side)

  return { x, y, side }
}
