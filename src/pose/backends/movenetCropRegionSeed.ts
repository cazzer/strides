import type { Keypoint } from '../types'

/**
 * The single-pose MoveNet detector's own crop region, in the library's normalized image
 * coordinates (`@tensorflow-models/pose-detection` 2.x, `MoveNetDetector.cropRegion`).
 */
export interface SinglePoseCropRegion {
  yMin: number
  xMin: number
  yMax: number
  xMax: number
  height: number
  width: number
}

/** The library's own `MIN_CROP_KEYPOINT_SCORE` (movenet/constants.js). */
const MIN_CROP_KEYPOINT_SCORE = 0.2

/** The 17 COCO keypoints the library's crop rule reads — the subset of `COMMON_KEYPOINT_NAMES`
 * a MoveNet pose actually carries. */
const COCO_KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const

const TORSO_KEYPOINT_NAMES = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
] as const

/**
 * The crop region the single-pose detector would itself have chosen for its NEXT call had it just
 * detected `keypoints` (source-video pixels) — a port of the library's `determineNextCropRegion`
 * (movenet/crop_utils.js), kept rule-for-rule so a seeded region is one the library could have
 * reached on its own.
 *
 * `null` where the library would fall back to its full-image initial region instead: torso not
 * visible, or the body so large that the crop would exceed half the frame's longer side. A `null`
 * seed means "leave the reset in place" — exactly the behaviour without seeding.
 */
export function computeSinglePoseCropRegionSeed(
  keypoints: Keypoint[],
  imageWidth: number,
  imageHeight: number,
): SinglePoseCropRegion | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null
  const byName = new Map<string, Keypoint>(keypoints.map((k) => [k.name, k]))
  const score = (name: string): number => byName.get(name)?.score ?? 0
  const point = (name: string): { x: number; y: number } | null => {
    const k = byName.get(name)
    return k && Number.isFinite(k.x) && Number.isFinite(k.y) ? k : null
  }

  const torsoVisible =
    (score('left_hip') > MIN_CROP_KEYPOINT_SCORE ||
      score('right_hip') > MIN_CROP_KEYPOINT_SCORE) &&
    (score('left_shoulder') > MIN_CROP_KEYPOINT_SCORE ||
      score('right_shoulder') > MIN_CROP_KEYPOINT_SCORE)
  if (!torsoVisible) return null

  const leftHip = point('left_hip')
  const rightHip = point('right_hip')
  if (leftHip === null || rightHip === null) return null
  const centerY = (leftHip.y + rightHip.y) / 2
  const centerX = (leftHip.x + rightHip.x) / 2

  // The library ranges the torso over all four torso joints regardless of score, and the body over
  // every keypoint at or above the crop score floor.
  let torsoY = 0
  let torsoX = 0
  for (const name of TORSO_KEYPOINT_NAMES) {
    const p = point(name)
    if (p === null) return null
    torsoY = Math.max(torsoY, Math.abs(centerY - p.y))
    torsoX = Math.max(torsoX, Math.abs(centerX - p.x))
  }
  let bodyY = 0
  let bodyX = 0
  for (const name of COCO_KEYPOINT_NAMES) {
    const p = point(name)
    if (p === null || score(name) < MIN_CROP_KEYPOINT_SCORE) continue
    bodyY = Math.max(bodyY, Math.abs(centerY - p.y))
    bodyX = Math.max(bodyX, Math.abs(centerX - p.x))
  }

  let half = Math.max(torsoX * 1.9, torsoY * 1.9, bodyY * 1.2, bodyX * 1.2)
  half = Math.min(
    half,
    Math.max(centerX, imageWidth - centerX, centerY, imageHeight - centerY),
  )
  if (half > Math.max(imageWidth, imageHeight) / 2) return null

  const yMin = (centerY - half) / imageHeight
  const xMin = (centerX - half) / imageWidth
  const yMax = (centerY + half) / imageHeight
  const xMax = (centerX + half) / imageWidth
  return { yMin, xMin, yMax, xMax, height: yMax - yMin, width: xMax - xMin }
}

/** The library-internal surface seeding writes to. Not part of the package's typed API. */
interface SeedableSinglePoseDetector {
  reset(): void
  cropRegion?: SinglePoseCropRegion | null
}

/**
 * Resets the single-pose detector and starts its internal crop-region tracking from `seed` instead
 * of the library's centre-square guess. Returns whether it did; `false` leaves the detector
 * untouched (not even reset).
 *
 * Writes the library's private `cropRegion` field. That is deliberate and guarded: the field is
 * read only when the next `estimatePoses` call begins (`if (!this.cropRegion) init…`), and is
 * present on any detector that has run once (the library creates it on its first call and `reset()`
 * nulls it). A detector without the field -- a different library build, or a test double -- is
 * left exactly as it was, so the caller keeps the result it already has.
 */
export function resetSinglePoseDetector(
  detector: SeedableSinglePoseDetector,
  seed: SinglePoseCropRegion,
): boolean {
  if (!('cropRegion' in detector)) return false
  detector.reset()
  if (detector.cropRegion !== null) return false
  detector.cropRegion = seed
  return true
}
