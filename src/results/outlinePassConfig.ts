/**
 * The background outline pass's kill switch (`strides-uz48`), cloned from `scalePassConfig.ts`:
 * typed default, dev-only window override, resolved once per analysis run at primary-ready. Off =
 * no outline pass runs, and a front clip's sideways-foot-travel card reads as unavailable.
 */
export interface OutlinePassConfig {
  enabled: boolean
}

export const DEFAULT_OUTLINE_PASS_CONFIG: OutlinePassConfig = { enabled: true }

declare global {
  interface Window {
    /** Development-only override for `OutlinePassConfig`, set via `page.addInitScript()` before
     * the app mounts. Never read outside a development build (`import.meta.env.DEV`). */
    __STRIDES_OUTLINE_PASS_CONFIG_OVERRIDE__?: Partial<OutlinePassConfig>
  }
}

export function resolveOutlinePassConfig(): OutlinePassConfig {
  const override = import.meta.env.DEV
    ? window.__STRIDES_OUTLINE_PASS_CONFIG_OVERRIDE__
    : undefined
  if (!override) return DEFAULT_OUTLINE_PASS_CONFIG
  return { ...DEFAULT_OUTLINE_PASS_CONFIG, ...override }
}
