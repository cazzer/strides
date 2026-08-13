import type { PoseDetectorConfig } from './detector'
import { DEFAULT_TRACKING_CROP_CONFIG } from './backends/trackingCropConfig'
import type { TrackingCropConfig } from './backends/trackingCropConfig'

export const DEFAULT_POSE_DETECTOR_CONFIG: PoseDetectorConfig = {
  backend: 'movenet',
  trackingCrop: DEFAULT_TRACKING_CROP_CONFIG,
}

declare global {
  interface Window {
    /**
     * Development-only override for the active `PoseDetectorConfig`, read once per detector
     * creation (`usePoseDetector.ts`). Set via `page.addInitScript()` from a Playwright-driven
     * eval harness before the app mounts, or by hand in devtools. Never read outside a
     * development build (`import.meta.env.DEV`) — dead-code-eliminated from production, same
     * pattern as `samplingRobustnessConfig`'s override.
     */
    __STRIDES_POSE_BACKEND_OVERRIDE__?: Partial<
      Omit<PoseDetectorConfig, 'trackingCrop'> & { trackingCrop: Partial<TrackingCropConfig> }
    >
  }
}

/**
 * Resolves the detector config an app instance should use: the default (`movenet`, default
 * tracking-crop config), shallow-merged with the development-only `window` override if one is
 * present (`trackingCrop` merged one level deep, the same nested-shallow-merge shape
 * `resolveSamplingRobustnessConfig` uses for its own nested `robustness` field).
 */
export function resolvePoseDetectorConfig(): PoseDetectorConfig {
  const override = import.meta.env.DEV
    ? window.__STRIDES_POSE_BACKEND_OVERRIDE__
    : undefined

  if (!override) return DEFAULT_POSE_DETECTOR_CONFIG

  return {
    ...DEFAULT_POSE_DETECTOR_CONFIG,
    ...override,
    trackingCrop: {
      ...DEFAULT_TRACKING_CROP_CONFIG,
      ...override.trackingCrop,
    },
  }
}
