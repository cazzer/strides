/**
 * The kill switch for drawing evidence images from a forward `VideoDecoder` pass instead of
 * detached-`<video>` seeks (`decodedFrames.ts`, `strides-6i6.4`). On by default; off makes every
 * clip extract exactly as it did before forward decoding existed.
 *
 * Its own switch rather than a reading of `sequentialSampling.enabled`: the two answer different
 * questions — which sampler produced the analysis inputs, and where evidence pixels come from — and
 * an A/B of either must be able to hold the other still.
 *
 * Dev-only override, read once per extraction, the same shape as the other planes:
 *
 * ```js
 * window.__STRIDES_FORWARD_DECODE_CONFIG_OVERRIDE__ = { enabled: false }
 * ```
 */
export interface ForwardDecodeConfig {
  enabled: boolean
}

export const DEFAULT_FORWARD_DECODE_CONFIG: ForwardDecodeConfig = { enabled: true }

declare global {
  interface Window {
    __STRIDES_FORWARD_DECODE_CONFIG_OVERRIDE__?: Partial<ForwardDecodeConfig>
  }
}

/** The default, with the dev-only `window` override laid over it. Production ignores the override. */
export function resolveForwardDecodeConfig(): ForwardDecodeConfig {
  if (!import.meta.env.DEV || typeof window === 'undefined') return DEFAULT_FORWARD_DECODE_CONFIG
  const override = window.__STRIDES_FORWARD_DECODE_CONFIG_OVERRIDE__
  if (override === undefined || override === null || typeof override !== 'object') {
    return DEFAULT_FORWARD_DECODE_CONFIG
  }
  return {
    enabled:
      typeof override.enabled === 'boolean'
        ? override.enabled
        : DEFAULT_FORWARD_DECODE_CONFIG.enabled,
  }
}
