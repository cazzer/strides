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
