import { useSyncExternalStore } from 'react'

const QUERY = '(forced-colors: active)'

// One MediaQueryList for the page, re-created only if `window.matchMedia` itself is replaced
// (a test stubbing it), as in `usePrefersReducedMotion`.
let cachedFor: typeof window.matchMedia | null = null
let cached: MediaQueryList | null = null

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  if (cachedFor !== window.matchMedia) {
    cachedFor = window.matchMedia
    cached = window.matchMedia(QUERY)
  }
  return cached
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  if (!list) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return query()?.matches ?? false
}

/**
 * Whether forced colours are active (Windows contrast themes); false where `matchMedia` is
 * unavailable. The runner hides its footage plate there (`forced-colors:hidden`), so nothing may
 * say a photo is shown.
 */
export function useForcedColors(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
