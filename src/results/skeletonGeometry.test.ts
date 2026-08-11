import { describe, expect, it } from 'vitest'
import {
  DETECTED_OPACITY,
  INTERPOLATED_OPACITY,
  findNearestFrame,
  toDrawOps,
} from './skeletonGeometry'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

describe('findNearestFrame', () => {
  const frames: RobustPoseFrame[] = [0, 1, 2, 3, 4].map((t) =>
    buildFrame({ left_hip: { x: 0, y: 0 } }, t),
  )

  it('returns null for an empty frame list', () => {
    expect(findNearestFrame([], 1)).toBeNull()
  })

  it('returns the exact match when t lands on a frame timestamp', () => {
    expect(findNearestFrame(frames, 2)).toBe(frames[2])
  })

  it('returns the nearer neighbor when t falls between two frames', () => {
    expect(findNearestFrame(frames, 2.6)).toBe(frames[3])
    expect(findNearestFrame(frames, 2.4)).toBe(frames[2])
  })

  it('clamps to the first frame when t is before the range', () => {
    expect(findNearestFrame(frames, -5)).toBe(frames[0])
  })

  it('clamps to the last frame when t is after the range', () => {
    expect(findNearestFrame(frames, 50)).toBe(frames[4])
  })

  it('works for a single-frame list', () => {
    const single = [buildFrame({ left_hip: { x: 0, y: 0 } }, 3)]
    expect(findNearestFrame(single, 100)).toBe(single[0])
  })
})

describe('toDrawOps', () => {
  it('draws a point for every detected keypoint at full opacity', () => {
    const frame = buildFrame({
      left_shoulder: { x: 10, y: 20 },
      right_shoulder: { x: 30, y: 20 },
    })

    const ops = toDrawOps(frame)
    const points = ops.filter((op) => op.kind === 'point')

    expect(points).toHaveLength(2)
    expect(points).toContainEqual({
      kind: 'point',
      name: 'left_shoulder',
      x: 10,
      y: 20,
      opacity: DETECTED_OPACITY,
    })
  })

  it('draws interpolated points at reduced opacity', () => {
    const frame = buildFrame({
      left_shoulder: { x: 10, y: 20, status: 'interpolated' },
    })

    const ops = toDrawOps(frame)
    const point = ops.find((op) => op.kind === 'point')

    expect(point?.opacity).toBe(INTERPOLATED_OPACITY)
  })

  it('skips unrecoverable points entirely — no draw op at all', () => {
    const frame = buildFrame({
      left_shoulder: { x: 10, y: 20, status: 'unrecoverable' },
    })

    const ops = toDrawOps(frame)
    expect(ops.some((op) => op.kind === 'point' && op.name === 'left_shoulder')).toBe(
      false,
    )
  })

  it('draws an edge between two resolvable, connected keypoints', () => {
    const frame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 100 },
    })

    const ops = toDrawOps(frame)
    const edge = ops.find(
      (op) => op.kind === 'edge' && op.from === 'left_shoulder' && op.to === 'left_hip',
    )

    expect(edge).toMatchObject({
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 100,
      opacity: DETECTED_OPACITY,
    })
  })

  it('skips an edge when either endpoint is unrecoverable', () => {
    const frame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      left_hip: { x: 0, y: 100, status: 'unrecoverable' },
    })

    const ops = toDrawOps(frame)
    const edge = ops.find(
      (op) => op.kind === 'edge' && op.from === 'left_shoulder' && op.to === 'left_hip',
    )

    expect(edge).toBeUndefined()
  })

  it("an edge's opacity is the weaker of its two endpoints' statuses", () => {
    const frame = buildFrame({
      left_shoulder: { x: 0, y: 0, status: 'detected' },
      left_hip: { x: 0, y: 100, status: 'interpolated' },
    })

    const ops = toDrawOps(frame)
    const edge = ops.find(
      (op) => op.kind === 'edge' && op.from === 'left_shoulder' && op.to === 'left_hip',
    )

    expect(edge?.opacity).toBe(INTERPOLATED_OPACITY)
  })

  it('produces no ops for a fully unrecoverable frame', () => {
    const frame = buildFrame({})
    expect(toDrawOps(frame)).toEqual([])
  })
})
