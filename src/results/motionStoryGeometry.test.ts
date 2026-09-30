import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { buildMotionSequence, mixPoints, pointsAtTimestamp, pointsForFrame, REFERENCE_POINTS } from './motionStoryGeometry'

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

  it('builds a recorded motion loop near the evidence frame with one fixed crop', () => {
    const samples = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((time, index) => {
      const sample = frame(time, index * 30)
      sample.keypoints.find((point) => point.name === 'left_knee')!.x! += index % 2 === 0 ? -12 : 12
      return sample
    })
    const loop = buildMotionSequence(samples, 0.6)
    expect(loop?.frames).toHaveLength(7)
    expect(loop?.duration).toBeCloseTo(1.05)
    expect(loop?.frames[0].points.left_hip?.x).toBeCloseTo(loop?.frames[1].points.left_hip?.x ?? 0)
    expect(loop?.frames[0].points.left_knee?.x).not.toBe(loop?.frames[1].points.left_knee?.x)
    expect(loop?.frames[0].points.left_knee?.y).toBe(loop?.frames[1].points.left_knee?.y)
  })

  it('never bridges missing detections or a long sampling gap', () => {
    const first = [0, 0.15, 0.3, 0.45].map((time) => frame(time))
    const absent = frame(0.6)
    absent.source = 'missing'
    const second = [0.75, 0.9, 1.05, 1.2].map((time) => frame(time, 50))
    expect(buildMotionSequence([...first, absent, ...second], 0.9)).toBeNull()
    expect(buildMotionSequence([frame(0), frame(0.1), frame(0.2), frame(0.7), frame(0.8), frame(0.9)], 0.7)).toBeNull()
  })

  it('requires directly detected body joints and sorts out-of-order samples', () => {
    const samples = [0, 0.15, 0.3, 0.45, 0.6].map((time) => frame(time))
    const weak = frame(0.75)
    weak.keypoints.filter((point) => point.name.includes('knee') || point.name.includes('ankle'))
      .forEach((point) => { point.status = 'interpolated' })
    expect(buildMotionSequence([...samples].reverse(), 0.3)?.frames.map((item) => item.timestamp))
      .toEqual([0, 0.15, 0.3, 0.45, 0.6])
    expect(buildMotionSequence([...samples.slice(0, 4), weak], 0.3)).toBeNull()
  })

  it('keeps a stray joint from shrinking the whole runner in the motion crop', () => {
    const samples = [0, 0.15, 0.3, 0.45, 0.6].map((time) => frame(time))
    samples[2].keypoints.find((point) => point.name === 'left_wrist')!.x = 10_000
    expect(buildMotionSequence(samples, 0.3)?.crop.side).toBeLessThan(400)
  })

  it('uses directly detected legs for crop scale when shoulders are unavailable', () => {
    const samples = [0, 0.15, 0.3, 0.45, 0.6].map((time) => frame(time))
    for (const sample of samples) {
      sample.keypoints.filter((point) => point.name.includes('shoulder'))
        .forEach((point) => { point.status = 'interpolated' })
    }
    samples[2].keypoints.find((point) => point.name === 'left_wrist')!.x = 10_000
    const loop = buildMotionSequence(samples, 0.3)
    expect(loop?.frames).toHaveLength(5)
    expect(loop?.crop.side).toBeLessThan(400)
  })

  it('does not admit frames whose hip centers have missing vertical coordinates', () => {
    const samples = [0, 0.15, 0.3, 0.45, 0.6].map((time) => frame(time))
    for (const point of samples[2].keypoints) {
      if (point.name === 'left_hip' || point.name === 'right_hip') point.y = null
      if (point.name === 'left_wrist') point.x = 10_000
    }
    expect(buildMotionSequence(samples, 0.3)).toBeNull()
  })
})
