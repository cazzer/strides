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
  'nose',
  'left_ear',
  'right_ear',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
] as const

export type KeypointName = (typeof COMMON_KEYPOINT_NAMES)[number]

export interface Keypoint {
  name: KeypointName
  x: number
  y: number
  score: number
}

export interface PoseFrame {
  /** One entry per name in COMMON_KEYPOINT_NAMES, in that fixed order, never sparse —
   * applyRobustness joins positionally, so a frame of any other length is a contract violation,
   * not degraded input. */
  keypoints: Keypoint[]
  /**
   * video.currentTime (seconds) — NOT wall-clock time. This is what lets a PoseFrame mean
   * the same thing for a live webcam stream and an uploaded file's playback position;
   * performance.now() would not.
   */
  timestamp: number
  /**
   * Pixels per real-world meter for THIS frame, when the backend can measure it (currently only
   * the MediaPipe Pose Landmarker, from its hip-centered `worldLandmarks`). Optional rather than
   * nullable on purpose: the key's absence means "this backend doesn't measure scale at all"
   * (MoveNet), and a backend that doesn't measure it must produce byte-for-byte the object it
   * produced before this field existed — so never emit `pixelsPerMeter: undefined`, omit the key.
   *
   * When present, always a finite number strictly greater than 0; a backend that can't produce a
   * trustworthy measurement for one frame (degenerate geometry, missing world landmarks) omits
   * the key for that frame rather than emitting 0/NaN/Infinity.
   */
  pixelsPerMeter?: number
}
