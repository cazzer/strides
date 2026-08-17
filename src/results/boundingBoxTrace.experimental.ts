/**
 * TEMPORARY probe for issue #57 — per-detection bounding-box trace, with NO area floor applied.
 *
 * Added, measured, and REVERTED per CLAUDE.md's experimental-probe cycle. Delete this file and the
 * one `console.log('[bbox-trace]', ...)` line in `useVideoAnalysis.ts` once the measurement is
 * recorded — before any A/B arm runs, so the A/B measures the shipped code path exactly.
 *
 * Why it exists: shipped diagnostics emit only per-SEGMENT `integratedAreaPx`/`medianAreaPx`,
 * capped at 10 segments. Re-deriving `minBoundingBoxAreaFraction` needs the per-DETECTION area
 * distribution — specifically two order statistics per clip (the largest spurious box and the
 * smallest genuine winner box), each of which has to be classified by looking at the keyframe at
 * its own timestamp. A `--arm` sweep over the floor cannot produce that: it reports how many
 * detections a candidate floor rejected, never WHOSE.
 *
 * The one property that makes this trace usable as evidence about the value under test: it applies
 * NO floor. Every box-yielding detection is reported, so the trace is identical whatever
 * `minBoundingBoxAreaFraction` currently is. It does apply the stage's own
 * `minKeypointConfidence`/`minConfidentKeypoints`, because the box it reports must be exactly the
 * box `selectRetroactivePersonOfInterest` derives — a differently-gated box would measure a
 * different quantity from the one the floor is compared against.
 */
import {
  bboxArea,
  deriveBoundingBox,
  meanConfidence,
} from '../pose/backends/movenetCrop'
import type { PoseSample } from '../pose/robustness/types'
import type { RetroactivePersonSelectionConfig } from './retroactivePersonSelection'

export interface BoundingBoxTraceDetection {
  /** Sample timestamp, seconds on the clip's own media clock — the value to seek to with ffmpeg. */
  t: number
  /** `bboxArea` in px², unfiltered. Non-finite values are reported as-is, not dropped. */
  a: number
  /** Box centre x/y, for telling a fixed-position phantom from a moving subject without a keyframe. */
  cx: number
  cy: number
  /** Box width/height, so an implausible aspect ratio is visible in the trace itself. */
  w: number
  h: number
  /** How many keypoints cleared `minKeypointConfidence` (bbox-eligible ones only). */
  n: number
  /** `meanConfidence` over the same eligible set. Free to collect, and it may show that phantoms
   * are separable by confidence — which would be a finding for a follow-up, not scope for #57. */
  s: number
}

export interface BoundingBoxTrace {
  frameWidth: number
  frameHeight: number
  frameArea: number
  totalSamples: number
  /** Samples carrying a detection at all (`frame !== null`). */
  detectedSamples: number
  /** Detected samples that yielded NO box (fewer than `minConfidentKeypoints` confident points). */
  boxlessSamples: number
  detections: BoundingBoxTraceDetection[]
}

/**
 * Duplicated from `movenetCrop.ts`, which does not export it, only so `n` counts the same
 * keypoints `deriveBoundingBox` actually hulls. Duplication is the right trade here: this file is
 * deleted at the end of the ticket, and `movenetCrop.ts` is explicitly out of scope for #57 — a
 * permanent export added for a temporary probe would outlive the probe.
 */
const BBOX_EXCLUDED_KEYPOINT_NAMES = new Set([
  'nose',
  'left_ear',
  'right_ear',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
])

export function traceBoundingBoxes(
  samples: PoseSample[],
  frameWidth: number,
  frameHeight: number,
  config: RetroactivePersonSelectionConfig,
): BoundingBoxTrace {
  const detections: BoundingBoxTraceDetection[] = []
  let detectedSamples = 0
  let boxlessSamples = 0

  for (const sample of samples) {
    const frame = sample.frame
    if (frame === null) continue
    detectedSamples += 1

    const box = deriveBoundingBox(
      frame.keypoints,
      config.minKeypointConfidence,
      config.minConfidentKeypoints,
    )
    if (box === null) {
      boxlessSamples += 1
      continue
    }

    const eligible = frame.keypoints.filter(
      (k) => !BBOX_EXCLUDED_KEYPOINT_NAMES.has(k.name),
    )
    detections.push({
      t: sample.timestamp,
      a: bboxArea(box),
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      w: box.maxX - box.minX,
      h: box.maxY - box.minY,
      n: eligible.filter((k) => k.score >= config.minKeypointConfidence).length,
      s: meanConfidence(frame.keypoints),
    })
  }

  return {
    frameWidth,
    frameHeight,
    frameArea: frameWidth * frameHeight,
    totalSamples: samples.length,
    detectedSamples,
    boxlessSamples,
    detections,
  }
}
