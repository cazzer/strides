import { describe, expect, it } from 'vitest'
import {
  bboxArea,
  boundingBoxCenterDistance,
  computeAcquisitionScore,
  computeBoundingBoxIoU,
  computeCropRect,
  deriveBoundingBox,
  isBoundingBoxAreaRatioWithin,
  isBoundingBoxContinuous,
  isWithinCenterSpeedBound,
  isWithinProximityThreshold,
  meanConfidence,
} from './movenetCrop'
import type { BoundingBoxPx } from './movenetCrop'
import { COMMON_KEYPOINT_NAMES } from '../types'
import type { Keypoint } from '../types'

function kp(
  name: Keypoint['name'],
  x: number,
  y: number,
  score: number,
): Keypoint {
  return { name, x, y, score }
}

/** A full 19-entry COMMON_KEYPOINT_NAMES set (matching `toPoseFrame`'s output shape), every
 * non-bbox-excluded joint confident at `score`, every excluded/unset one at 0. */
function fullKeypointSet(score: number): Keypoint[] {
  const present = new Set([
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
  ])
  return COMMON_KEYPOINT_NAMES.map((name) =>
    kp(name, 0, 0, present.has(name) ? score : 0),
  )
}

describe('deriveBoundingBox', () => {
  it('computes the correct min/max when all keypoints are confident', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 100, 50, 0.9),
      kp('right_shoulder', 200, 60, 0.9),
      kp('left_hip', 120, 300, 0.9),
      kp('right_hip', 210, 310, 0.9),
      kp('left_ankle', 90, 500, 0.9),
      kp('right_ankle', 220, 490, 0.9),
    ]

    const box = deriveBoundingBox(keypoints, 0.3, 4)

    expect(box).toEqual({ minX: 90, minY: 50, maxX: 220, maxY: 500 })
  })

  it('returns non-null when confident keypoint count is exactly minConfidentKeypoints', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 0, 0, 0.9),
      kp('right_shoulder', 10, 10, 0.9),
      kp('left_hip', 20, 20, 0.9),
      kp('right_hip', 30, 30, 0.9),
    ]

    expect(deriveBoundingBox(keypoints, 0.3, 4)).not.toBeNull()
  })

  it('returns null when confident keypoint count is one below minConfidentKeypoints', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 0, 0, 0.9),
      kp('right_shoulder', 10, 10, 0.9),
      kp('left_hip', 20, 20, 0.9),
    ]

    expect(deriveBoundingBox(keypoints, 0.3, 4)).toBeNull()
  })

  it('computes the box from qualifying keypoints only, ignoring low-confidence ones', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 100, 100, 0.9),
      kp('right_shoulder', 200, 100, 0.9),
      kp('left_hip', 150, 300, 0.9),
      kp('right_hip', 160, 300, 0.9),
      // Low-confidence outlier far outside the box above -- must not widen it.
      kp('left_ankle', -1000, 1000, 0.1),
      kp('right_ankle', 1000, -1000, 0.1),
    ]

    const box = deriveBoundingBox(keypoints, 0.3, 4)

    expect(box).toEqual({ minX: 100, minY: 100, maxX: 200, maxY: 300 })
  })

  it('excludes head keypoints from the box even when they are confident', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 100, 100, 0.9),
      kp('right_shoulder', 200, 100, 0.9),
      kp('left_hip', 150, 300, 0.9),
      kp('right_hip', 160, 300, 0.9),
      // Confident head points above the shoulders -- excluded by name, must not
      // raise the top edge (measured worse live; see BBOX_EXCLUDED_KEYPOINT_NAMES).
      kp('nose', 150, 20, 0.98),
      kp('left_ear', 170, 15, 0.95),
      kp('right_ear', 130, 15, 0.95),
    ]

    const box = deriveBoundingBox(keypoints, 0.3, 4)

    expect(box).toEqual({ minX: 100, minY: 100, maxX: 200, maxY: 300 })
  })

  it('excludes foot keypoints from the box even when they are confident', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 100, 100, 0.9),
      kp('right_shoulder', 200, 100, 0.9),
      kp('left_hip', 150, 300, 0.9),
      kp('right_hip', 160, 300, 0.9),
      // Confident foot points below the hips -- excluded by name, must not raise the bottom
      // edge (COCO-17 topology reasoning, not A/B evidence; see BBOX_EXCLUDED_KEYPOINT_NAMES).
      kp('left_heel', 140, 550, 0.9),
      kp('right_heel', 170, 550, 0.9),
      kp('left_foot_index', 145, 560, 0.9),
      kp('right_foot_index', 175, 560, 0.9),
    ]

    const box = deriveBoundingBox(keypoints, 0.3, 4)

    expect(box).toEqual({ minX: 100, minY: 100, maxX: 200, maxY: 300 })
  })

  it('does not count excluded foot keypoints toward minConfidentKeypoints', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 100, 100, 0.9),
      kp('right_shoulder', 200, 100, 0.9),
      kp('left_hip', 150, 300, 0.9),
      kp('left_heel', 140, 550, 0.9),
    ]

    expect(deriveBoundingBox(keypoints, 0.3, 4)).toBeNull()
  })

  it('does not count excluded head keypoints toward minConfidentKeypoints', () => {
    const keypoints: Keypoint[] = [
      kp('left_shoulder', 100, 100, 0.9),
      kp('right_shoulder', 200, 100, 0.9),
      kp('left_hip', 150, 300, 0.9),
      kp('nose', 150, 20, 0.98),
    ]

    expect(deriveBoundingBox(keypoints, 0.3, 4)).toBeNull()
  })
})

describe('computeCropRect', () => {
  it('centers a square crop on a bbox well inside the frame', () => {
    const box = { minX: 400, minY: 300, maxX: 600, maxY: 500 } // 200x200, center (500, 400)

    const rect = computeCropRect(box, 1920, 1080, 1.5, 100)

    // side = max(200, 200) * 1.5 = 300, well within [100, min(1920,1080)=1080]
    expect(rect.side).toBe(300)
    expect(rect.x).toBe(500 - 150)
    expect(rect.y).toBe(400 - 150)
  })

  it('clamps position by shifting, not shrinking, when the bbox is near an edge', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 } // center (50, 50), near top-left corner

    const rect = computeCropRect(box, 800, 600, 1.5, 100)

    // side = max(100, 100) * 1.5 = 150
    expect(rect.side).toBe(150)
    // Centered position would be (50 - 75, 50 - 75) = (-25, -25); clamped to 0, not shrunk.
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
  })

  it('caps the side to min(frameWidth, frameHeight) when the padded bbox would exceed the frame', () => {
    const box = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

    const rect = computeCropRect(box, 800, 600, 2, 100)

    // Uncapped side would be 1000 * 2 = 2000, but frame is only 800x600.
    expect(rect.side).toBe(600)
    // Still within frame bounds.
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.side).toBeLessThanOrEqual(800)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.y + rect.side).toBeLessThanOrEqual(600)
  })

  it('floors the side to minCropSidePx for a tiny/degenerate bbox', () => {
    const box = { minX: 500, minY: 400, maxX: 502, maxY: 401 } // ~2x1 px

    const rect = computeCropRect(box, 1920, 1080, 1.5, 256)

    expect(rect.side).toBe(256)
  })

  it('always returns a square crop within [0, frameWidth] x [0, frameHeight]', () => {
    const box = { minX: 1800, minY: 50, maxX: 1900, maxY: 120 } // near the right edge

    const rect = computeCropRect(box, 1920, 1080, 1.75, 256)

    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.side).toBeLessThanOrEqual(1920)
    expect(rect.y + rect.side).toBeLessThanOrEqual(1080)
  })
})

describe('bboxArea', () => {
  it('computes width x height', () => {
    const box: BoundingBoxPx = { minX: 10, minY: 20, maxX: 60, maxY: 120 }

    expect(bboxArea(box)).toBe(50 * 100)
  })
})

describe('meanConfidence', () => {
  it('averages score across the non-excluded 12-point set, ignoring excluded head/foot points', () => {
    const keypoints = fullKeypointSet(0.8).map((k) =>
      k.name === 'nose' ? { ...k, score: 0.99 } : k,
    )

    expect(meanConfidence(keypoints)).toBeCloseTo(0.8)
  })

  it('counts a missing (zero-score) non-excluded keypoint toward the average', () => {
    const keypoints = fullKeypointSet(0.9).map((k) =>
      k.name === 'left_wrist' ? { ...k, score: 0 } : k,
    )

    // 11 points at 0.9, 1 point at 0 -> (11 * 0.9) / 12
    expect(meanConfidence(keypoints)).toBeCloseTo((11 * 0.9) / 12)
  })
})

describe('computeAcquisitionScore', () => {
  it('multiplies bbox area by mean confidence', () => {
    const box: BoundingBoxPx = { minX: 0, minY: 0, maxX: 10, maxY: 10 } // area 100
    const keypoints = fullKeypointSet(0.5)

    expect(computeAcquisitionScore(box, keypoints)).toBeCloseTo(100 * 0.5)
  })
})

describe('computeBoundingBoxIoU', () => {
  it('returns 1 for identical boxes', () => {
    const box: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

    expect(computeBoundingBoxIoU(box, box)).toBe(1)
  })

  it('returns 0 for disjoint boxes', () => {
    const a: BoundingBoxPx = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const b: BoundingBoxPx = { minX: 100, minY: 100, maxX: 110, maxY: 110 }

    expect(computeBoundingBoxIoU(a, b)).toBe(0)
  })

  it('computes intersection-over-union for partially overlapping boxes', () => {
    const a: BoundingBoxPx = { minX: 0, minY: 0, maxX: 10, maxY: 10 } // area 100
    const b: BoundingBoxPx = { minX: 5, minY: 5, maxX: 15, maxY: 15 } // area 100
    // Intersection: [5,10]x[5,10] = 25. Union: 100 + 100 - 25 = 175.

    expect(computeBoundingBoxIoU(a, b)).toBeCloseTo(25 / 175)
  })
})

describe('boundingBoxCenterDistance', () => {
  it('computes the euclidean distance between two box centers', () => {
    const a: BoundingBoxPx = { minX: 0, minY: 0, maxX: 10, maxY: 10 } // center (5, 5)
    const b: BoundingBoxPx = { minX: 20, minY: 40, maxX: 30, maxY: 50 } // center (25, 45)

    expect(boundingBoxCenterDistance(a, b)).toBeCloseTo(Math.hypot(20, 40))
  })
})

describe('isWithinProximityThreshold', () => {
  it('is true when the candidate center sits within distanceMultiple x reference side', () => {
    const reference: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 50 } // side 100
    const candidate: BoundingBoxPx = { minX: 150, minY: 0, maxX: 250, maxY: 50 } // center shifted 150px

    expect(isWithinProximityThreshold(candidate, reference, 2)).toBe(true)
  })

  it('is false when the candidate center sits beyond distanceMultiple x reference side', () => {
    const reference: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 50 } // side 100
    const candidate: BoundingBoxPx = { minX: 300, minY: 0, maxX: 400, maxY: 50 } // center shifted 350px

    expect(isWithinProximityThreshold(candidate, reference, 2)).toBe(false)
  })
})

describe('isWithinCenterSpeedBound', () => {
  // side 100, center (50, 25)
  const reference: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 50 }

  it('scales the allowed displacement with elapsed time', () => {
    // 250px of center displacement: allowed at 3 sides/s over 1s (300px), not over 0.5s (150px).
    const candidate: BoundingBoxPx = { minX: 250, minY: 0, maxX: 350, maxY: 50 }

    expect(isWithinCenterSpeedBound(candidate, reference, 3, 1)).toBe(true)
    expect(isWithinCenterSpeedBound(candidate, reference, 3, 0.5)).toBe(false)
  })

  it('uses the reference box\'s longer dimension as its side, so the bound scales with subject distance', () => {
    // Same 250px displacement, but a reference twice as tall -- side 200, so 3 sides/s over 0.5s
    // allows 300px and the same candidate now passes.
    const tall: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 200 }
    const candidate: BoundingBoxPx = { minX: 250, minY: 75, maxX: 350, maxY: 275 }

    expect(isWithinCenterSpeedBound(candidate, tall, 3, 0.5)).toBe(true)
  })

  it('returns false for a non-positive or non-finite elapsed time rather than dividing by it', () => {
    const candidate: BoundingBoxPx = { minX: 1, minY: 0, maxX: 101, maxY: 50 }

    // Even a near-identical candidate: with no usable gap there is no meaningful speed to bound,
    // so the caller falls back on its IoU test instead of this one.
    expect(isWithinCenterSpeedBound(candidate, reference, 3, 0)).toBe(false)
    expect(isWithinCenterSpeedBound(candidate, reference, 3, -1)).toBe(false)
    expect(isWithinCenterSpeedBound(candidate, reference, 3, NaN)).toBe(false)
    expect(isWithinCenterSpeedBound(candidate, reference, 3, Infinity)).toBe(
      false,
    )
  })
})

describe('isBoundingBoxAreaRatioWithin', () => {
  // area 10000
  const reference: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

  it('is symmetric: passes a candidate up to maxRatio larger OR smaller', () => {
    const larger: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 250 } // 2.5x
    const smaller: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 40 } // 0.4x

    expect(isBoundingBoxAreaRatioWithin(larger, reference, 3)).toBe(true)
    expect(isBoundingBoxAreaRatioWithin(smaller, reference, 3)).toBe(true)
  })

  it('rejects beyond maxRatio in either direction', () => {
    const muchLarger: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 400 } // 4x
    // The reported failure's shape: a distant bystander roughly a third the subject's height.
    const muchSmaller: BoundingBoxPx = { minX: 0, minY: 0, maxX: 34, maxY: 34 } // ~0.12x

    expect(isBoundingBoxAreaRatioWithin(muchLarger, reference, 3)).toBe(false)
    expect(isBoundingBoxAreaRatioWithin(muchSmaller, reference, 3)).toBe(false)
  })

  it('returns false for a zero-area reference rather than dividing by zero', () => {
    const degenerate: BoundingBoxPx = { minX: 10, minY: 10, maxX: 10, maxY: 90 }

    expect(isBoundingBoxAreaRatioWithin(reference, degenerate, 3)).toBe(false)
  })
})

describe('isBoundingBoxContinuous', () => {
  // side 100, center (50, 50), area 10000
  const reference: BoundingBoxPx = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  const bounds = { maxCenterSpeedSidesPerSecond: 3, maxAreaRatio: 3 }

  it('accepts an overlapping candidate of similar scale', () => {
    const candidate: BoundingBoxPx = { minX: 20, minY: 10, maxX: 130, maxY: 105 }

    expect(isBoundingBoxContinuous(candidate, reference, 0.05, bounds)).toBe(
      true,
    )
  })

  it('accepts a non-overlapping candidate reachable within the speed bound', () => {
    // 250px of center displacement at 3 sides/s over 1s (300px allowed), zero IoU.
    const candidate: BoundingBoxPx = { minX: 250, minY: 0, maxX: 350, maxY: 100 }

    expect(computeBoundingBoxIoU(candidate, reference)).toBe(0)
    expect(isBoundingBoxContinuous(candidate, reference, 1, bounds)).toBe(true)
    expect(isBoundingBoxContinuous(candidate, reference, 0.5, bounds)).toBe(
      false,
    )
  })

  it('rejects on scale alone even when the boxes overlap completely', () => {
    // Fully contained (IoU > 0, position continuity passes trivially), but ~1/16 the area.
    const candidate: BoundingBoxPx = { minX: 40, minY: 40, maxX: 65, maxY: 65 }

    expect(computeBoundingBoxIoU(candidate, reference)).toBeGreaterThan(0)
    expect(isBoundingBoxContinuous(candidate, reference, 0.05, bounds)).toBe(
      false,
    )
  })

  it('falls back on IoU when the elapsed time is unusable, rather than rejecting outright', () => {
    const candidate: BoundingBoxPx = { minX: 5, minY: 5, maxX: 105, maxY: 105 }

    // The speed term is unavailable at elapsed 0, but the boxes overlap, so position holds.
    expect(isWithinCenterSpeedBound(candidate, reference, 3, 0)).toBe(false)
    expect(isBoundingBoxContinuous(candidate, reference, 0, bounds)).toBe(true)
  })

  it('is exactly position-AND-scale, with position being IoU-OR-speed', () => {
    // An exhaustive truth-table check against the two primitives it composes -- this function is
    // shared by the online anchor gate and the offline person-selection stage, so its composition
    // must not quietly drift into extra guard logic.
    const candidates: BoundingBoxPx[] = [
      { minX: 5, minY: 5, maxX: 105, maxY: 105 }, // overlapping, same scale
      { minX: 250, minY: 0, maxX: 350, maxY: 100 }, // far, same scale
      { minX: 40, minY: 40, maxX: 65, maxY: 65 }, // overlapping, tiny
      { minX: 900, minY: 900, maxX: 925, maxY: 925 }, // far and tiny
      { minX: 0, minY: 0, maxX: 400, maxY: 400 }, // overlapping, huge
    ]

    for (const candidate of candidates) {
      for (const elapsed of [0, 0.05, 0.5, 1]) {
        const expected =
          (computeBoundingBoxIoU(candidate, reference) > 0 ||
            isWithinCenterSpeedBound(
              candidate,
              reference,
              bounds.maxCenterSpeedSidesPerSecond,
              elapsed,
            )) &&
          isBoundingBoxAreaRatioWithin(
            candidate,
            reference,
            bounds.maxAreaRatio,
          )

        expect(isBoundingBoxContinuous(candidate, reference, elapsed, bounds)).toBe(
          expected,
        )
      }
    }
  })

  it('honors the bounds it is given, not any built-in default', () => {
    // ~3.6x the reference's area: rejected at maxAreaRatio 3, accepted at the offline stage's 4.
    const candidate: BoundingBoxPx = { minX: 0, minY: 0, maxX: 190, maxY: 190 }

    expect(
      isBoundingBoxContinuous(candidate, reference, 0.05, {
        ...bounds,
        maxAreaRatio: 3,
      }),
    ).toBe(false)
    expect(
      isBoundingBoxContinuous(candidate, reference, 0.05, {
        ...bounds,
        maxAreaRatio: 4,
      }),
    ).toBe(true)
  })
})
