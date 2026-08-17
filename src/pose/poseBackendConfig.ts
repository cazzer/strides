import type { PoseDetectorConfig } from './detector'
import { DEFAULT_TRACKING_CROP_CONFIG } from './backends/trackingCropConfig'
import type { TrackingCropConfig } from './backends/trackingCropConfig'
import {
  DEFAULT_CONTINUITY_GATE_CONFIG,
  DEFAULT_PERSON_OF_INTEREST_CONFIG,
} from './backends/personOfInterestConfig'
import type {
  ContinuityGateConfig,
  PersonOfInterestConfig,
} from './backends/personOfInterestConfig'

export const DEFAULT_POSE_DETECTOR_CONFIG: PoseDetectorConfig = {
  backend: 'movenet',
  trackingCrop: DEFAULT_TRACKING_CROP_CONFIG,
  personOfInterest: DEFAULT_PERSON_OF_INTEREST_CONFIG,
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
      Omit<PoseDetectorConfig, 'trackingCrop' | 'personOfInterest'> & {
        trackingCrop: Partial<TrackingCropConfig>
        personOfInterest: Partial<
          Omit<PersonOfInterestConfig, 'continuityGate'> & {
            continuityGate: Partial<ContinuityGateConfig>
          }
        >
      }
    >
  }
}

/**
 * Resolves the detector config an app instance should use: the default (`movenet`, default
 * tracking-crop config), shallow-merged with the development-only `window` override if one is
 * present (`trackingCrop`/`personOfInterest` each merged one level deep, the same nested-shallow-
 * merge shape `resolveSamplingRobustnessConfig` uses for its own nested `robustness` field).
 *
 * `personOfInterest.continuityGate` needs one level deeper still: it is the only field on this
 * config that is itself an object, so without an explicit merge, overriding a single gate
 * threshold would blank the gate's `enabled` flag and its other threshold to `undefined` rather
 * than leaving them at their defaults.
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
    personOfInterest: {
      ...DEFAULT_PERSON_OF_INTEREST_CONFIG,
      ...override.personOfInterest,
      continuityGate: {
        ...DEFAULT_CONTINUITY_GATE_CONFIG,
        ...override.personOfInterest?.continuityGate,
      },
    },
  }
}
