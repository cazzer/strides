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

  it('draws points for the head keypoints (nose/ears) exactly like any other resolvable keypoint', () => {
    const frame = buildFrame({
      nose: { x: 100, y: 10 },
      left_ear: { x: 90, y: 12 },
      right_ear: { x: 110, y: 12 },
    })

    const ops = toDrawOps(frame)
    const points = ops.filter((op) => op.kind === 'point')

    expect(points).toContainEqual({ kind: 'point', name: 'nose', x: 100, y: 10, opacity: DETECTED_OPACITY })
    expect(points).toContainEqual({
      kind: 'point',
      name: 'left_ear',
      x: 90,
      y: 12,
      opacity: DETECTED_OPACITY,
    })
    expect(points).toContainEqual({
      kind: 'point',
      name: 'right_ear',
      x: 110,
      y: 12,
      opacity: DETECTED_OPACITY,
    })
  })

  it('draws all 4 head/neck edges when nose, ears, and shoulders all resolve', () => {
    const frame = buildFrame({
      nose: { x: 100, y: 10 },
      left_ear: { x: 90, y: 12 },
      right_ear: { x: 110, y: 12 },
      left_shoulder: { x: 85, y: 40 },
      right_shoulder: { x: 115, y: 40 },
    })

    const ops = toDrawOps(frame)
    const edgeKeys = ops
      .filter((op) => op.kind === 'edge')
      .map((op) => `${op.from}->${op.to}`)

    expect(edgeKeys).toContain('left_ear->nose')
    expect(edgeKeys).toContain('right_ear->nose')
    expect(edgeKeys).toContain('left_ear->left_shoulder')
    expect(edgeKeys).toContain('right_ear->right_shoulder')
  })

  it('skips every head/neck edge touching an unrecoverable ear', () => {
    const frame = buildFrame({
      nose: { x: 100, y: 10 },
      left_ear: { x: 90, y: 12, status: 'unrecoverable' },
      right_ear: { x: 110, y: 12, status: 'unrecoverable' },
      left_shoulder: { x: 85, y: 40 },
      right_shoulder: { x: 115, y: 40 },
    })

    const ops = toDrawOps(frame)
    const edgeKeys = ops
      .filter((op) => op.kind === 'edge')
      .map((op) => `${op.from}->${op.to}`)

    expect(edgeKeys).not.toContain('left_ear->nose')
    expect(edgeKeys).not.toContain('right_ear->nose')
    expect(edgeKeys).not.toContain('left_ear->left_shoulder')
    expect(edgeKeys).not.toContain('right_ear->right_shoulder')
  })

  it('a head-less frame (nose/ears unrecoverable) produces exactly the same ops as before the head was added', () => {
    const frame = buildFrame({
      left_shoulder: { x: 0, y: 0 },
      right_shoulder: { x: 20, y: 0 },
      left_hip: { x: 0, y: 100 },
      right_hip: { x: 20, y: 100 },
    })

    const ops = toDrawOps(frame)

    expect(ops.some((op) => op.kind === 'point' && op.name === 'nose')).toBe(false)
    expect(ops.some((op) => op.kind === 'point' && op.name === 'left_ear')).toBe(false)
    expect(ops.some((op) => op.kind === 'point' && op.name === 'right_ear')).toBe(false)
    expect(ops.every((op) => op.kind !== 'edge' || (op.from !== 'left_ear' && op.from !== 'right_ear'))).toBe(true)
    // Exactly the 4 body points + 4 body edges (shoulder-shoulder, hip-hip, and each side's
    // shoulder-hip) the pre-head skeleton produced for this shape.
    expect(ops.filter((op) => op.kind === 'point')).toHaveLength(4)
    expect(ops.filter((op) => op.kind === 'edge')).toHaveLength(4)
  })
})
