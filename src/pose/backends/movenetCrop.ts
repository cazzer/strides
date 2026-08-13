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
 */
const BBOX_EXCLUDED_KEYPOINT_NAMES = new Set(['nose', 'left_ear', 'right_ear'])

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
    (k) => k.score >= minKeypointConfidence && !BBOX_EXCLUDED_KEYPOINT_NAMES.has(k.name),
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
