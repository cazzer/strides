import type { RawKeypoint } from '../common'

/**
 * A hand-built subset of BlazePose's 33-point output: the COMMON_KEYPOINT_NAMES subset (limbs,
 * nose/ears, and heel/foot-index) plus a handful of BlazePose-only points (face refinements,
 * fingers) that fall outside that subset and must be dropped by toPoseFrame, same as MoveNet's
 * remaining non-subset face points (eyes) are. heel/foot-index were added here in anticipation
 * (#30) before COMMON_KEYPOINT_NAMES widened to include them (#44) — they now pass through like
 * any other common keypoint. This backend is registered but broken end to end (see CLAUDE.md's
 * "Known issues") — this fixture only exercises compile-time name-mapping, never a live
 * inference result.
 */
export const BLAZEPOSE_RAW_KEYPOINTS: RawKeypoint[] = [
  { name: 'nose', x: 320, y: 100, score: 0.98 },
  { name: 'left_ear', x: 340, y: 95, score: 0.9 },
  { name: 'right_ear', x: 300, y: 95, score: 0.89 },
  { name: 'left_eye_inner', x: 328, y: 92, score: 0.96 },
  { name: 'left_pinky', x: 392, y: 282, score: 0.8 },
  { name: 'right_pinky', x: 248, y: 282, score: 0.79 },
  { name: 'left_index', x: 393, y: 283, score: 0.81 },
  { name: 'right_index', x: 247, y: 283, score: 0.8 },
  { name: 'left_shoulder', x: 360, y: 160, score: 0.95 },
  { name: 'right_shoulder', x: 280, y: 160, score: 0.94 },
  { name: 'left_elbow', x: 380, y: 220, score: 0.92 },
  { name: 'right_elbow', x: 260, y: 220, score: 0.91 },
  { name: 'left_wrist', x: 390, y: 280, score: 0.88 },
  { name: 'right_wrist', x: 250, y: 280, score: 0.87 },
  { name: 'left_hip', x: 350, y: 320, score: 0.93 },
  { name: 'right_hip', x: 290, y: 320, score: 0.93 },
  { name: 'left_knee', x: 355, y: 400, score: 0.9 },
  { name: 'right_knee', x: 285, y: 400, score: 0.9 },
  { name: 'left_ankle', x: 360, y: 480, score: 0.85 },
  { name: 'right_ankle', x: 280, y: 480, score: 0.86 },
  { name: 'left_heel', x: 362, y: 495, score: 0.83 },
  { name: 'right_heel', x: 278, y: 495, score: 0.82 },
  { name: 'left_foot_index', x: 365, y: 500, score: 0.8 },
  { name: 'right_foot_index', x: 275, y: 500, score: 0.79 },
]
