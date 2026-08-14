import { DEFAULT_ROBUSTNESS_CONFIG } from '../pose/robustness/types'
import type { RobustnessConfig } from '../pose/robustness/types'
import { DEFAULT_MAX_CONSECUTIVE_ERRORS, DEFAULT_DETECTION_TIMEOUT_MS } from './sampleClip'
import type { SequentialSamplingConfig } from './sequentialSamplingStep'

/**
 * The sampling/robustness plane as one swappable object — bundles the interpolation layer's
 * `RobustnessConfig` (keypoint-confidence filtering, interpolation gap tolerance) together with
 * `sampleClip`'s detection error tolerance and per-frame timeout, and (since
 * add-webcodecs-sequential-sampling) the WebCodecs sequential-decode path's sampling-density knob,
 * so an eval harness comparing pipeline variants has one thing to swap for this whole plane
 * instead of several differently-shaped ones. `interpolate.ts`/`confidenceFilter.ts`/
 * `sampleClip.ts`/`sequentialSamplingStep.ts` are untouched — they already took these values as
 * parameters; this only bundles them for the one call site that resolves them.
 */
export interface SamplingRobustnessConfig {
  robustness: RobustnessConfig
  maxConsecutiveErrors: number
  detectionTimeoutMs: number
  sequentialSampling: SequentialSamplingConfig
}

export const DEFAULT_SAMPLING_ROBUSTNESS_CONFIG: SamplingRobustnessConfig = {
  robustness: DEFAULT_ROBUSTNESS_CONFIG,
  maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
  detectionTimeoutMs: DEFAULT_DETECTION_TIMEOUT_MS,
  // `null` = every decoded frame, matching the playback path's existing "sample whatever the
  // detector can keep up with" behavior rather than imposing a new fixed rate by default.
  sequentialSampling: { targetSamplesPerSecond: null },
}

declare global {
  interface Window {
    /**
     * Development-only override for the active `SamplingRobustnessConfig`, read once per
     * analysis run (`useVideoAnalysis.ts`). Set via `page.evaluate()` from a Playwright-driven
     * eval harness before triggering analysis, or by hand in devtools. Never read outside a
     * development build (`import.meta.env.DEV`) — dead-code-eliminated from production, the same
     * pattern `analysisDiagnostics`'s console auto-log already uses.
     */
    __STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__?: Partial<
      Omit<SamplingRobustnessConfig, 'robustness' | 'sequentialSampling'> & {
        robustness: Partial<RobustnessConfig>
        sequentialSampling: Partial<SequentialSamplingConfig>
      }
    >
  }
}

/**
 * Resolves the config an analysis run should use: the default, shallow-merged with the
 * development-only `window` override if one is present (never read outside a dev build).
 */
export function resolveSamplingRobustnessConfig(): SamplingRobustnessConfig {
  const override = import.meta.env.DEV
    ? window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__
    : undefined

  if (!override) return DEFAULT_SAMPLING_ROBUSTNESS_CONFIG

  return {
    ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG,
    ...override,
    robustness: {
      ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.robustness,
      ...override.robustness,
    },
    sequentialSampling: {
      ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.sequentialSampling,
      ...override.sequentialSampling,
    },
  }
}
