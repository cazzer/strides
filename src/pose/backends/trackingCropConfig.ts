/**
 * The MoveNet tracking-crop plane as one swappable object — see `movenetCrop.ts`/`movenet.ts` for
 * the algorithm this configures. Just the type + default here, deliberately with no
 * override/resolve machinery of its own: `poseBackendConfig.ts`'s `resolvePoseDetectorConfig()`
 * folds this in as `PoseDetectorConfig.trackingCrop`, so `window.__STRIDES_POSE_BACKEND_OVERRIDE__`
 * stays the single override surface for backend + model variant + tracking-crop together, rather
 * than each config plane growing its own separate `window` global.
 */
export interface TrackingCropConfig {
  /** Total kill-switch: `false` bypasses all tracking state, always calling the full-frame path. */
  enabled: boolean
  /**
   * Per-keypoint score gate (over the 12 `COMMON_KEYPOINT_NAMES`) a keypoint must meet to count
   * toward a "usable" detection. Deliberately a standalone constant here, not imported from
   * `robustness/types.ts`'s `DEFAULT_MIN_KEYPOINT_CONFIDENCE` — same default value for
   * consistency, but an independently tunable knob for this different purpose (bounding-box
   * derivation, not interpolation gap-filling).
   */
  minKeypointConfidence: number
  /** Minimum number of qualifying keypoints for a detection to count as "usable". */
  minConfidentKeypoints: number
  /** Crop side length = `max(bbox width, bbox height) * paddingMultiplier`. */
  paddingMultiplier: number
  /** Floor on the crop side length, in source-video pixels. */
  minCropSidePx: number
  /** Consecutive not-usable crop-mode frames before falling back to full-frame detection. */
  reacquisitionLossThreshold: number
}

export const DEFAULT_TRACKING_CROP_CONFIG: TrackingCropConfig = {
  enabled: true,
  minKeypointConfidence: 0.3,
  minConfidentKeypoints: 4,
  paddingMultiplier: 1.75,
  minCropSidePx: 256,
  reacquisitionLossThreshold: 5,
}
