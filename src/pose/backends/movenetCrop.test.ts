import { describe, expect, it } from 'vitest'
import { computeCropRect, deriveBoundingBox } from './movenetCrop'
import type { Keypoint } from '../types'

function kp(name: Keypoint['name'], x: number, y: number, score: number): Keypoint {
  return { name, x, y, score }
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
