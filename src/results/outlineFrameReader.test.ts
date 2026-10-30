import { describe, expect, it, vi } from 'vitest'
import { createOutlineFrameReader } from './outlineFrameReader'
import type { CropDrawer } from './outlineFrameReader'
import type { OutlineSegmentation, OutlineSegmenter } from '../pose/backends/mediapipePoseLandmarker'
import type { PoseFrameSource } from '../pose/detector'
import type { SwingFootOutlineFramePlan, SwingFootOutlinePlan } from '../heuristics/types'

// A 400 × 720 crop at (100, 50) of a 1000 × 1000 frame; hips 60 px apart at source y 350.
const CROP = { x: 100, y: 50, width: 400, height: 720 }

function framePlan(timestamp: number): SwingFootOutlineFramePlan {
  return {
    timestamp,
    sides: ['left'],
    crop: CROP,
    keypoints: {
      left_hip: { x: 330, y: 350, interpolated: false },
      right_hip: { x: 270, y: 350, interpolated: false },
      left_knee: { x: 335, y: 500, interpolated: false },
      right_knee: { x: 265, y: 500, interpolated: false },
    },
    quality: { left: 1, right: 1 },
  }
}

const plan: SwingFootOutlinePlan = {
  viewFit: { fit: 'primary', multiplier: 1 },
  periodSeconds: 0.33,
  hipWidthMedianPx: 60,
  lastFrameTimestamp: 2,
  windows: [],
  frames: [framePlan(0.5), framePlan(0.6)],
}

/** A crop-local mask: torso + left thigh (outer edge source x 350) + shank inside it. */
function maskValues(): Float32Array {
  const values = new Float32Array(CROP.width * CROP.height)
  const fill = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) values[(y - CROP.y) * CROP.width + (x - CROP.x)] = 0.9
  }
  fill(250, 350, 200, 350)
  fill(315, 350, 330, 500)
  fill(320, 345, 500, 670)
  return values
}

/** MediaPipe landmarks normalized to the crop, agreeing with MoveNet. */
function landmarks(): Array<{ x: number; y: number }> {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }))
  const norm = (x: number, y: number) => ({ x: (x - CROP.x) / CROP.width, y: (y - CROP.y) / CROP.height })
  points[23] = norm(330, 350)
  points[24] = norm(270, 350)
  points[25] = norm(335, 500)
  points[26] = norm(265, 500)
  return points
}

function fakeSegmenter(maskSize = { width: CROP.width, height: CROP.height }) {
  const closes: number[] = []
  const reads = vi.fn(() => maskValues())
  const segmenter: OutlineSegmenter = {
    segment: vi.fn((): OutlineSegmentation => ({
      landmarks: landmarks(),
      mask: { ...maskSize, getAsFloat32Array: reads },
      close: () => closes.push(1),
    })),
    close: vi.fn(),
  }
  return { segmenter, closes, reads }
}

const canvas = {} as HTMLCanvasElement
const source = (timestampSec: number): PoseFrameSource => ({ image: canvas, timestampSec, width: 1000, height: 1000 })

describe('createOutlineFrameReader', () => {
  it('segments only planned frames, at the plan crop, and returns no pose', async () => {
    const { segmenter } = fakeSegmenter()
    const drawCrop = vi.fn<CropDrawer>(() => canvas)
    const reader = createOutlineFrameReader(plan, segmenter, drawCrop)
    expect(await reader.detector.estimatePose(source(0.4))).toBeNull()
    expect(await reader.detector.estimatePose(source(0.5))).toBeNull()
    expect(await reader.detector.estimatePose(source(0.55))).toBeNull()
    expect(segmenter.segment).toHaveBeenCalledTimes(1)
    expect(drawCrop).toHaveBeenCalledWith(expect.objectContaining({ timestampSec: 0.5 }), CROP)
    expect(reader.stats().framesSegmented).toBe(1)
  })

  it('measures each planned side against the mask, in source pixels', async () => {
    const { segmenter } = fakeSegmenter()
    const reader = createOutlineFrameReader(plan, segmenter, () => canvas)
    await reader.detector.estimatePose(source(0.5))
    const [m] = reader.measurements()
    expect(m.timestamp).toBe(0.5)
    expect(m.mediaPipeDisagreement).toBeCloseTo(0, 6)
    const left = m.sides.left!
    expect(left.ok).toBe(true)
    if (left.ok) {
      expect(left.marks.thighEdge[0].x).toBe(350)
      expect(left.residual).toBeCloseTo(-5 / 60, 10)
      expect(left.protrusion).toBe(0)
    }
    expect(m.sides.right).toBeUndefined()
  })

  it('closes every segmentation, and keeps only small measurements', async () => {
    const { segmenter, closes, reads } = fakeSegmenter()
    const reader = createOutlineFrameReader(plan, segmenter, () => canvas)
    await reader.detector.estimatePose(source(0.5))
    await reader.detector.estimatePose(source(0.6))
    expect(closes).toHaveLength(2)
    expect(reads).toHaveBeenCalledTimes(2)
    // Nothing mask-sized survives the frame: every retained array is a ≤ 64-point contour or smaller.
    const arrays: unknown[] = []
    const walk = (value: unknown) => {
      if (Array.isArray(value)) arrays.push(value)
      if (value !== null && typeof value === 'object') for (const v of Object.values(value)) walk(v)
    }
    walk(reader.measurements())
    expect(arrays.every((a) => (a as unknown[]).length <= 64)).toBe(true)
    expect(arrays.some((a) => a instanceof Float32Array)).toBe(false)
  })

  it('records no-mask, and still closes, when the mask is not crop-sized', async () => {
    const { segmenter, closes } = fakeSegmenter({ width: 256, height: 256 })
    const reader = createOutlineFrameReader(plan, segmenter, () => canvas)
    await reader.detector.estimatePose(source(0.5))
    expect(reader.measurements()[0].sides.left).toEqual({ ok: false, reason: 'no-mask' })
    expect(reader.stats().framesWithoutMask).toBe(1)
    expect(closes).toHaveLength(1)
  })

  it('closes the segmentation even when measuring throws', async () => {
    const closes: number[] = []
    const segmenter: OutlineSegmenter = {
      segment: () => ({
        landmarks: landmarks(),
        mask: { width: CROP.width, height: CROP.height, getAsFloat32Array: () => { throw new Error('gpu') } },
        close: () => closes.push(1),
      }),
      close: () => {},
    }
    const reader = createOutlineFrameReader(plan, segmenter, () => canvas)
    await expect(reader.detector.estimatePose(source(0.5))).rejects.toThrow('gpu')
    expect(closes).toHaveLength(1)
  })
})
