import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { mixPoints, pointsAtTimestamp, pointsForFrame, REFERENCE_POINTS } from './motionStoryGeometry'

function frame(timestamp: number, xOffset = 0): RobustPoseFrame {
  return {
    timestamp,
    source: 'detected',
    pixelsPerMeter: null,
    keypoints: COMMON_KEYPOINT_NAMES.map((name, index) => ({
      name, x: 100 + index * 10 + xOffset, y: 200 + index * 5,
      score: 0.9, status: 'detected',
    })),
  }
}

describe('motion story geometry', () => {
  it('projects measured joints through the same square crop as evidence pixels', () => {
    const points = pointsForFrame(frame(0), { x: 100, y: 200, side: 320 })
    expect(points?.left_shoulder).toMatchObject({ x: 0, y: 0, inferred: false })
    expect(points?.right_ankle).toMatchObject({ x: 110, y: 55, inferred: false })
  })

  it('uses the frame nearest the evidence timestamp and refuses an incomplete body', () => {
    const frames = [frame(0), frame(1, 200)]
    const crop = { x: 100, y: 200, side: 320 }
    expect(pointsAtTimestamp(frames, 0.9, crop)?.left_hip?.x).toBeGreaterThan(
      pointsAtTimestamp(frames, 0.1, crop)?.left_hip?.x ?? 0,
    )
    const incomplete = frame(0)
    for (const point of incomplete.keypoints) point.status = 'unrecoverable'
    expect(pointsForFrame(incomplete, null)).toBeNull()
  })

  it('morphs reference joints to actual positions without fabricating absent detections', () => {
    const target = { left_knee: { x: 200, y: 210 } }
    expect(mixPoints(REFERENCE_POINTS, target, 0).left_knee).toEqual(REFERENCE_POINTS.left_knee)
    expect(mixPoints(REFERENCE_POINTS, target, 1).left_knee).toMatchObject(target.left_knee)
    expect(mixPoints(REFERENCE_POINTS, target, 0.5).right_knee).toBeUndefined()
  })

  it('retains an inferred joint marker so it can be drawn faintly', () => {
    const sample = frame(0)
    sample.keypoints.find((point) => point.name === 'left_knee')!.status = 'interpolated'
    const points = pointsForFrame(sample, { x: 100, y: 200, side: 320 })
    expect(points?.left_knee?.inferred).toBe(true)
    expect(points?.right_knee?.inferred).toBe(false)
  })
})
