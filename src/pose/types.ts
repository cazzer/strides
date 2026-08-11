export const COMMON_KEYPOINT_NAMES = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const

export type KeypointName = (typeof COMMON_KEYPOINT_NAMES)[number]

export interface Keypoint {
  name: KeypointName
  x: number
  y: number
  score: number
}

export interface PoseFrame {
  /** Always length 12, one entry per COMMON_KEYPOINT_NAMES, in that fixed order. Never sparse. */
  keypoints: Keypoint[]
  /**
   * video.currentTime (seconds) — NOT wall-clock time. This is what lets a PoseFrame mean
   * the same thing for a live webcam stream and an uploaded file's playback position;
   * performance.now() would not.
   */
  timestamp: number
}
