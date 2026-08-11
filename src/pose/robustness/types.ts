import type { KeypointName, PoseFrame } from '../types'

/**
 * The robustness layer's input unit. Deliberately not the ticket's literal `PoseFrame | null`:
 * a `null` frame (detector found nobody) carries no timestamp of its own, but interpolation
 * needs a timestamp for every sample — including missing ones — to measure gap duration. The
 * caller (a future polling loop) already has `video.currentTime` in hand on every poll, detection
 * failure or not, so pairing it here costs nothing and avoids fabricating/interpolating
 * timestamps for missing samples. See design.md for the full rationale.
 */
export interface PoseSample {
  timestamp: number
  frame: PoseFrame | null
}

export type KeypointStatus = 'detected' | 'interpolated' | 'unrecoverable'

export interface RobustKeypoint {
  name: KeypointName
  /** null only when status === 'unrecoverable' — never a fabricated (0, 0) */
  x: number | null
  y: number | null
  /**
   * Real score if detected; lerp of real neighbor scores if interpolated (informational only —
   * reads as confident, consumers must gate on status, not score); 0 if unrecoverable.
   */
  score: number
  status: KeypointStatus
}

export type FrameSource = 'detected' | 'missing'

export interface RobustPoseFrame {
  timestamp: number
  /** Always length 12, COMMON_KEYPOINT_NAMES order. */
  keypoints: RobustKeypoint[]
  /** 'missing' iff the detector returned null for this sample. */
  source: FrameSource
}

export interface RobustnessConfig {
  /** Per-keypoint score below which a point is treated as "missing". */
  minKeypointConfidence: number
  /** Max real elapsed time across a gap that may still be interpolated. */
  maxGapSeconds: number
}

export const DEFAULT_MIN_KEYPOINT_CONFIDENCE = 0.3
export const DEFAULT_MAX_GAP_SECONDS = 0.5
export const DEFAULT_ROBUSTNESS_CONFIG: RobustnessConfig = {
  minKeypointConfidence: DEFAULT_MIN_KEYPOINT_CONFIDENCE,
  maxGapSeconds: DEFAULT_MAX_GAP_SECONDS,
}
