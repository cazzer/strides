import { DEFAULT_ROBUSTNESS_CONFIG } from '../pose/robustness/types'
import type { RobustnessConfig } from '../pose/robustness/types'
import { DEFAULT_MAX_CONSECUTIVE_ERRORS, DEFAULT_DETECTION_TIMEOUT_MS } from './sampleClip'
import type { SequentialSamplingConfig } from './sequentialSamplingStep'
import { DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG } from './retroactivePersonSelection'
import type { RetroactivePersonSelectionConfig } from './retroactivePersonSelection'

/**
 * The sampling/robustness plane as one swappable object — bundles the interpolation layer's
 * `RobustnessConfig` (keypoint-confidence filtering, interpolation gap tolerance) together with
 * `sampleClip`'s detection error tolerance and per-frame timeout, and (since
 * add-webcodecs-sequential-sampling) the WebCodecs sequential-decode path's sampling-density knob,
 * so an eval harness comparing pipeline variants has one thing to swap for this whole plane
 * instead of several differently-shaped ones. `interpolate.ts`/`confidenceFilter.ts`/
 * `sampleClip.ts`/`sequentialSamplingStep.ts` are untouched — they already took these values as
 * parameters; this only bundles them for the one call site that resolves them.
 *
 * `personSelection` (since retroactive-person-selection) is the one member that is not merely a
 * re-home of an existing parameter — it configures a post-sampling stage that did not exist
 * before. It lives here rather than behind a `window` global of its own because it runs inside
 * the analysis pipeline, which already resolves exactly one of these objects per run; a second
 * global would be a second lifetime to reason about for no gain.
 */
export interface SamplingRobustnessConfig {
  robustness: RobustnessConfig
  maxConsecutiveErrors: number
  detectionTimeoutMs: number
  sequentialSampling: SequentialSamplingConfig
  personSelection: RetroactivePersonSelectionConfig
}

export const DEFAULT_SAMPLING_ROBUSTNESS_CONFIG: SamplingRobustnessConfig = {
  robustness: DEFAULT_ROBUSTNESS_CONFIG,
  maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
  detectionTimeoutMs: DEFAULT_DETECTION_TIMEOUT_MS,
  // `enabled: true` — the sequential-decode path is the default sampler, see
  // SequentialSamplingConfig.enabled's doc for the known open regression this accepts.
  // `targetSamplesPerSecond: null` = every decoded frame, matching the playback path's existing
  // "sample whatever the detector can keep up with" behavior rather than imposing a fixed rate.
  sequentialSampling: { enabled: true, targetSamplesPerSecond: null },
  // `enabled: true` — by explicit user decision (2026-08-16), OVERRIDING the pre-registered ship
  // rule, which fired: the stage is not a no-op on the side-view track demo, where one collapsed
  // detection splits the runner's own continuous track and strands its prefix. See
  // DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG's doc for what is knowingly accepted (issue #52's
  // items 1-3) and the live A/B behind it.
  personSelection: DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
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
      Omit<
        SamplingRobustnessConfig,
        'robustness' | 'sequentialSampling' | 'personSelection'
      > & {
        robustness: Partial<RobustnessConfig>
        sequentialSampling: Partial<SequentialSamplingConfig>
        personSelection: Partial<RetroactivePersonSelectionConfig>
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
    personSelection: {
      ...DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.personSelection,
      ...override.personSelection,
    },
  }
}
