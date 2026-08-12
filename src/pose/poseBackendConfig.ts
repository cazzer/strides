import type { PoseDetectorConfig } from './detector'

export const DEFAULT_POSE_DETECTOR_CONFIG: PoseDetectorConfig = { backend: 'movenet' }

declare global {
  interface Window {
    /**
     * Development-only override for the active `PoseDetectorConfig`, read once per detector
     * creation (`usePoseDetector.ts`). Set via `page.addInitScript()` from a Playwright-driven
     * eval harness before the app mounts, or by hand in devtools. Never read outside a
     * development build (`import.meta.env.DEV`) — dead-code-eliminated from production, same
     * pattern as `samplingRobustnessConfig`'s override.
     */
    __STRIDES_POSE_BACKEND_OVERRIDE__?: Partial<PoseDetectorConfig>
  }
}

/**
 * Resolves the detector config an app instance should use: the default (`movenet`),
 * shallow-merged with the development-only `window` override if one is present.
 */
export function resolvePoseDetectorConfig(): PoseDetectorConfig {
  const override = import.meta.env.DEV
    ? window.__STRIDES_POSE_BACKEND_OVERRIDE__
    : undefined

  if (!override) return DEFAULT_POSE_DETECTOR_CONFIG

  return { ...DEFAULT_POSE_DETECTOR_CONFIG, ...override }
}
