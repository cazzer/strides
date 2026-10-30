import type { PoseDetector, PoseFrameSource } from '../pose/detector'
import type { OutlineSegmenter } from '../pose/backends/mediapipePoseLandmarker'
import {
  clampOutlineCrop,
  measureFrameOutline,
  outlineFirstMaskRow,
  rowRuns,
} from '../heuristics/swingFootOutline'
import type { OutlineAgreementPoints, OutlineCropRect, OutlineMaskRuns } from '../heuristics/swingFootOutline'
import type {
  SwingFootOutlineFrameMeasurement,
  SwingFootOutlinePlan,
} from '../heuristics/types'

/** MediaPipe Pose landmark indices of the hips and knees (`mediapipePoseLandmarker.ts`). */
const MP_LEFT_HIP = 23
const MP_RIGHT_HIP = 24
const MP_LEFT_KNEE = 25
const MP_RIGHT_KNEE = 26

/** Copies one crop of the sampler's full-frame canvas, at native pixels, onto a canvas the
 * segmenter reads. */
export type CropDrawer = (source: PoseFrameSource, crop: OutlineCropRect) => HTMLCanvasElement | null

/** The default drawer: one reused canvas, 9-argument `drawImage` (no rescale). */
export function createCanvasCropDrawer(): CropDrawer {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  return (source, crop) => {
    if (!ctx) return null
    if (canvas.width !== crop.width) canvas.width = crop.width
    if (canvas.height !== crop.height) canvas.height = crop.height
    ctx.drawImage(source.image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    return canvas
  }
}

export interface OutlineReaderStats {
  /** Frames the segmenter actually ran on. */
  framesSegmented: number
  /** Per-segmentation wall time, ms (detect + mask reduction). */
  segmentMs: number[]
  /** Segmentations whose mask was missing or not crop-sized. */
  framesWithoutMask: number
}

export interface OutlineFrameReader {
  /** Pass to the sampler in place of a pose detector. Returns null for every frame: the samples
   * are discarded, and the reading is collected below. */
  detector: PoseDetector
  measurements(): SwingFootOutlineFrameMeasurement[]
  stats(): OutlineReaderStats
}

/**
 * The outline pass's PoseDetector adapter. For a frame the plan names (exact timestamp match —
 * the sampler hands this the same timestamps the primary pass saw), it copies the MoveNet-guided
 * crop, segments it, reduces the mask IN THE LOOP to runs from the thigh band down, measures each
 * planned side, and closes the segmentation. Nothing larger than one crop's run lists is ever
 * held, and no float mask outlives its frame. Unplanned frames cost no inference.
 */
export function createOutlineFrameReader(
  plan: SwingFootOutlinePlan,
  segmenter: OutlineSegmenter,
  drawCrop: CropDrawer = createCanvasCropDrawer(),
): OutlineFrameReader {
  const planned = new Map(plan.frames.map((frame) => [frame.timestamp, frame]))
  const measurements: SwingFootOutlineFrameMeasurement[] = []
  const stats: OutlineReaderStats = { framesSegmented: 0, segmentMs: [], framesWithoutMask: 0 }

  const detector: PoseDetector = {
    async estimatePose(source) {
      const frame = planned.get(source.timestampSec)
      if (frame === undefined) return null
      const crop = clampOutlineCrop(frame.crop, source.width, source.height)
      const image = crop === null ? null : drawCrop(source, crop)
      if (crop === null || image === null) {
        measurements.push(measureFrameOutline(frame, null, null, plan.hipWidthMedianPx))
        return null
      }
      const startedAt = performance.now()
      const segmentation = segmenter.segment(image)
      try {
        const landmarks = segmentation.landmarks
        const at = (index: number) => ({
          x: crop.x + landmarks![index].x * crop.width,
          y: crop.y + landmarks![index].y * crop.height,
        })
        const mediaPipe: OutlineAgreementPoints | null =
          landmarks !== null && landmarks.length > MP_RIGHT_KNEE
            ? {
                left_hip: at(MP_LEFT_HIP),
                right_hip: at(MP_RIGHT_HIP),
                left_knee: at(MP_LEFT_KNEE),
                right_knee: at(MP_RIGHT_KNEE),
              }
            : null
        let runs: OutlineMaskRuns | null = null
        const mask = segmentation.mask
        if (mask !== null && mask.width === crop.width && mask.height === crop.height) {
          const values = mask.getAsFloat32Array()
          const firstRow = outlineFirstMaskRow(frame, crop.y)
          const rows: number[][] = []
          for (let row = firstRow; row < crop.height; row += 1) {
            rows.push(rowRuns(values, row * crop.width, crop.width))
          }
          runs = { originX: crop.x, originY: crop.y, width: crop.width, height: crop.height, firstRow, rows }
        } else {
          stats.framesWithoutMask += 1
        }
        measurements.push(measureFrameOutline(frame, runs, mediaPipe, plan.hipWidthMedianPx))
      } finally {
        segmentation.close()
        stats.framesSegmented += 1
        stats.segmentMs.push(performance.now() - startedAt)
      }
      return null
    },
    dispose() {},
  }

  return {
    detector,
    measurements: () => measurements,
    stats: () => stats,
  }
}
