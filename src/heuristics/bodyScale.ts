import type { RobustPoseFrame } from '../pose/robustness/types'
import { resolveBilateralPair, resolveMidpoint } from './keypoints'
import { distance, median } from './mathUtils'

export interface BodyScale {
  torsoLengthPx: number
  sampleCoverage: number
}

export interface HipWidth {
  hipWidthPx: number
  sampleCoverage: number
}

/**
 * Slack on a local-torso window boundary, in seconds. A frame exactly `halfWindowSeconds` away is
 * meant to be INSIDE the window, but frame timestamps are rarely exact binary fractions (`15/30`
 * minus `0/30` need not equal `0.5` to the last bit), so without slack the same physical window
 * could include its boundary frame at one frame rate and drop it at another. 1 µs is far below any
 * frame interval and is the quantum Chromium itself truncates `currentTime` to.
 */
const WINDOW_BOUNDARY_EPSILON_SECONDS = 1e-6

/**
 * One frame's torso length in pixels — shoulder-mid to hip-mid via `resolveMidpoint` — or `null`
 * when either midpoint cannot resolve. The per-frame sample that both `estimateBodyScale`
 * (clip-wide median) and `estimateLocalTorsoLengths` (windowed median) reduce over, so the two can
 * never disagree about what "a torso length" is.
 */
export function torsoLengthAt(frame: RobustPoseFrame): number | null {
  const shoulderMid = resolveMidpoint(frame, 'left_shoulder', 'right_shoulder')
  const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
  if (shoulderMid === null || hipMid === null) return null
  return distance(shoulderMid, hipMid)
}

/**
 * Torso length (shoulder-mid to hip-mid) is THE shared normalizer for view detection and all
 * three heuristics — deliberately not shoulder width or leg length. Shoulder width collapses
 * toward zero in side view (the camera looks straight along the mediolateral axis), which would
 * make it a degenerate denominator exactly in the view where these metrics matter most. Leg
 * length is itself modulated by the gait cycle being measured (a leg's apparent length changes
 * as the knee flexes through a stride), so normalizing by it would be quietly circular. Torso
 * length stays roughly constant across a stride and non-degenerate from either camera angle.
 *
 * Uses the median across all frames where both shoulder-mid and hip-mid resolve, rather than the
 * mean, so that a handful of frames with a badly-placed interpolated point don't drag the scale
 * estimate away from the runner's real proportions.
 */
export function estimateBodyScale(frames: RobustPoseFrame[]): BodyScale | null {
  const lengths: number[] = []

  for (const frame of frames) {
    const length = torsoLengthAt(frame)
    if (length !== null) lengths.push(length)
  }

  if (lengths.length === 0) return null

  return {
    torsoLengthPx: median(lengths),
    sampleCoverage: lengths.length / frames.length,
  }
}

/**
 * Left-right hip separation (median across frames) — `stepWidth`'s denominator, a different scale
 * reference from `estimateBodyScale`'s torso length. Uses `resolveBilateralPair`, the same strict
 * (both-sides-must-resolve) primitive `viewDetection.ts` uses for its own inline bilateral-spread
 * calc — reused here rather than reimplemented, but kept a separate function from
 * `estimateBodyScale` since the two are independent scale references over different keypoint pairs
 * with their own reduction order; not shared code with `viewDetection.ts` itself, which blends
 * hip+shoulder spread in a different reduction and would change its math if refactored to call
 * this.
 */
export function estimateHipWidth(frames: RobustPoseFrame[]): HipWidth | null {
  const widths: number[] = []

  for (const frame of frames) {
    const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
    if (hips === null) continue
    widths.push(Math.abs(hips.left.x - hips.right.x))
  }

  if (widths.length === 0) return null

  return {
    hipWidthPx: median(widths),
    sampleCoverage: widths.length / frames.length,
  }
}

/**
 * Per-frame LOCAL torso length: for each frame, the median `torsoLengthAt` over every frame whose
 * timestamp lies within `±halfWindowSeconds` of its own, or `null` when nothing in that window
 * resolves. Index-aligned with `frames`.
 *
 * `estimateBodyScale`'s single clip-wide median is the right denominator only while the runner's
 * on-screen size is roughly constant. A runner approaching a handheld camera can grow several-fold
 * across a clip, and an amplitude measured near either end of that approach is mis-sized by a
 * mid-clip torso. A windowed median follows the approach while still averaging over the torso's own
 * within-stride flex and the keypoints' frame-to-frame jitter, which a per-frame denominator would
 * not (`normalize-sagittal-excursion-by-local-torso`, design D2/D3).
 *
 * Keeps interpolated torso points, for the same reason `estimateBodyScale` does: a median tolerates
 * a few lerped samples. The window is TIME-based, not a frame count, so the same motion is smoothed
 * over the same seconds at 25, 30 or 60 fps; at a clip's ends it is truncated, never shifted.
 *
 * Frames MUST be in presentation (non-decreasing timestamp) order — the order every upstream stage
 * already produces and assumes. A decreasing timestamp throws a `RangeError` rather than silently
 * scanning a wrong window.
 */
export function estimateLocalTorsoLengths(
  frames: RobustPoseFrame[],
  halfWindowSeconds: number,
): (number | null)[] {
  if (!(halfWindowSeconds >= 0) || !Number.isFinite(halfWindowSeconds)) {
    throw new RangeError(
      `halfWindowSeconds must be a finite non-negative number, got ${halfWindowSeconds}`,
    )
  }
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].timestamp < frames[i - 1].timestamp) {
      throw new RangeError(
        `estimateLocalTorsoLengths needs frames in presentation order; timestamp ` +
          `${frames[i].timestamp} at index ${i} follows ${frames[i - 1].timestamp}`,
      )
    }
  }

  const lengths = frames.map(torsoLengthAt)
  const reach = halfWindowSeconds + WINDOW_BOUNDARY_EPSILON_SECONDS
  const result: (number | null)[] = []
  // Two pointers over a sorted timeline: `lo` is the first frame inside the window and `hi` one
  // past the last. Both only ever move forward, so the scan is linear in the frame count; the
  // per-window median is the only super-linear part, over at most ~1 s of frames.
  let lo = 0
  let hi = 0
  for (let i = 0; i < frames.length; i += 1) {
    const t = frames[i].timestamp
    while (frames[lo].timestamp < t - reach) lo += 1
    while (hi < frames.length && frames[hi].timestamp <= t + reach) hi += 1
    const window: number[] = []
    for (let j = lo; j < hi; j += 1) {
      const length = lengths[j]
      if (length !== null) window.push(length)
    }
    result.push(window.length > 0 ? median(window) : null)
  }
  return result
}
