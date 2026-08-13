/**
 * The background scale pass's one switch (D4) — a kill switch, resolved once per analysis run at
 * the moment the primary pass reaches 'ready' (`useVideoAnalysis.ts`), pattern-cloned from
 * `samplingRobustnessConfig.ts`: typed default, dev-only window override, resolver that merges
 * the two. Kept as a one-field config object (rather than a bare boolean) so a future scale-pass
 * knob — a different watchdog multiplier, say — extends this shape instead of adding a second
 * override global.
 */
export interface ScalePassConfig {
  /** Whether the background MediaPipe scale pass runs at all after a primary pass that measured
   * no real-world scale. Off = the centimetre metric renders exactly as it did before the scale
   * pass existed (the availability caveat). */
  enabled: boolean
}

export const DEFAULT_SCALE_PASS_CONFIG: ScalePassConfig = { enabled: true }

declare global {
  interface Window {
    /**
     * Development-only override for the active `ScalePassConfig`, read once per analysis run at
     * primary-ready (`useVideoAnalysis.ts`). Set via `page.addInitScript()` from a
     * Playwright-driven eval harness before the app mounts, or by hand in devtools. Never read
     * outside a development build (`import.meta.env.DEV`) — dead-code-eliminated from
     * production, same pattern as `samplingRobustnessConfig`'s and `poseBackendConfig`'s
     * overrides.
     */
    __STRIDES_SCALE_PASS_CONFIG_OVERRIDE__?: Partial<ScalePassConfig>
  }
}

/**
 * Resolves the config a run's scale-pass decision should use: the default, shallow-merged with
 * the development-only `window` override if one is present (never read outside a dev build).
 */
export function resolveScalePassConfig(): ScalePassConfig {
  const override = import.meta.env.DEV
    ? window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__
    : undefined

  if (!override) return DEFAULT_SCALE_PASS_CONFIG

  return { ...DEFAULT_SCALE_PASS_CONFIG, ...override }
}
