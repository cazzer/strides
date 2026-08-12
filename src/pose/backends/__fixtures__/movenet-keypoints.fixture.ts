import type { RawKeypoint } from '../common'

/**
 * A hand-built 17-entry raw keypoint set matching MoveNet's full COCO output, including the 2
 * eye points that fall outside the COMMON_KEYPOINT_NAMES subset (nose and both ears are in it)
 * and must be dropped by toPoseFrame.
 */
export const MOVENET_RAW_KEYPOINTS: RawKeypoint[] = [
  { name: 'nose', x: 320, y: 100, score: 0.98 },
  { name: 'left_eye', x: 330, y: 90, score: 0.97 },
  { name: 'right_eye', x: 310, y: 90, score: 0.96 },
  { name: 'left_ear', x: 340, y: 95, score: 0.9 },
  { name: 'right_ear', x: 300, y: 95, score: 0.89 },
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
]
