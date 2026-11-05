/**
 * Which code produced a saved assessment. `vite.config.ts` sets `VITE_STRIDES_COMMIT` from
 * `GITHUB_SHA` (the Pages deploy), else `git rev-parse --short HEAD`, else leaves it unset. Vitest
 * does not load `vite.config.ts`, so tests read `'unknown'`.
 */
export interface BuildInfo {
  commit: string
}

export function buildInfo(): BuildInfo {
  const commit = import.meta.env.VITE_STRIDES_COMMIT
  return { commit: typeof commit === 'string' && commit !== '' ? commit : 'unknown' }
}
