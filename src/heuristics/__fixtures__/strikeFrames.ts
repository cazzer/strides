import type { RobustPoseFrame } from '../../pose/robustness/types'
import { buildFrame } from './testFrames'

/** Frames per footstrike at 30fps — 10 puts strikes 0.333s apart, clear of the default
 * `footstrikeMinIntervalSeconds` (0.25) so every strike in `ankleOffsetsPx` survives dedup. */
const FRAMES_PER_STRIKE = 10
const FPS = 30
/** Shoulder-mid to hip-mid, so every px offset below reads as a round fraction of torso length. */
const TORSO_LENGTH_PX = 150
const HIP_MID_X = 200
const ANKLE_LIFT_PX = 40

export interface StrikeFrameOptions {
  /** Ankle-x offset from the hip midline at each successive footstrike, in px. One entry per
   * strike; the metrics under test read exactly this at exactly those frames. */
  ankleOffsetsPx: number[]
  /** Give the other foot a half-period-offset lift too, so strikes alternate feet — the shape
   * `stepWidth`'s constructed opposite-side pair needs, and the one a single-foot clip lacks. */
  alternateFeet?: boolean
  /** Left/right hip separation. `0` collapses hip-mid onto each hip, which is exactly
   * `stepWidth`/`stepWidthCm`'s degenerate outward-sign case. */
  hipSpreadPx?: number
  /** MediaPipe-only heel/toe keypoints, for the exemplar crop-context path. */
  withFeetKeypoints?: boolean
  pixelsPerMeter?: number | null
}

/**
 * A hand-built footstrike clip with per-strike ankle placement under direct control — the
 * synthetic gait generator produces a tightly bimodal, left/right-alternating offset distribution
 * whose extremes sit barely one MAD from the median, which is a realistic shape but a useless one
 * for exercising an exemplar's ranking or its outlier bound.
 *
 * Geometry: a static torso 150px tall with hip-mid at x=200, knees directly under hip-mid, and a
 * triangular ankle-y lift peaking (foot lowest on screen, i.e. a footstrike) at the middle frame
 * of each block. Hip-x never advances, so travel direction reads indeterminate and every offset
 * below is used unflipped — which keeps the expected values arithmetic rather than sign-dependent.
 */
export function buildStrikeFrames(options: StrikeFrameOptions): RobustPoseFrame[] {
  const { ankleOffsetsPx, alternateFeet = false, hipSpreadPx = 6 } = options
  const half = hipSpreadPx / 2
  const frames: RobustPoseFrame[] = []

  for (let i = 0; i < ankleOffsetsPx.length * FRAMES_PER_STRIKE; i += 1) {
    const offset = ankleOffsetsPx[Math.floor(i / FRAMES_PER_STRIKE)]
    const phase = i % FRAMES_PER_STRIKE
    const lift = (localPhase: number) =>
      560 + ANKLE_LIFT_PX * (1 - Math.abs(localPhase - FRAMES_PER_STRIKE / 2) / 5)
    const leftAnkle = { x: HIP_MID_X + offset, y: lift(phase) }
    const rightAnkle = {
      x: HIP_MID_X - offset,
      y: lift((phase + FRAMES_PER_STRIKE / 2) % FRAMES_PER_STRIKE),
    }

    frames.push(
      buildFrame(
        {
          left_shoulder: { x: HIP_MID_X - half, y: 400 - TORSO_LENGTH_PX },
          right_shoulder: { x: HIP_MID_X + half, y: 400 - TORSO_LENGTH_PX },
          left_hip: { x: HIP_MID_X - half, y: 400 },
          right_hip: { x: HIP_MID_X + half, y: 400 },
          left_knee: { x: HIP_MID_X, y: 500 },
          left_ankle: leftAnkle,
          ...(alternateFeet ? { right_knee: { x: HIP_MID_X, y: 500 }, right_ankle: rightAnkle } : {}),
          ...(options.withFeetKeypoints
            ? {
                left_heel: { x: leftAnkle.x - 15, y: leftAnkle.y + 5 },
                left_foot_index: { x: leftAnkle.x + 22, y: leftAnkle.y + 5 },
              }
            : {}),
        },
        i / FPS,
        options.pixelsPerMeter ?? null,
      ),
    )
  }

  return frames
}
