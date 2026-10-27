import { useSyncExternalStore } from 'react'

/**
 * A short phone: below Tailwind's `lg` (64rem, the same range as `max-lg:`) and at most 720 px
 * tall, which is most phones in Safari once its toolbars are counted. There the tour's bar and the
 * runner's controls share one row (`strides-xsl3`).
 */
export const SHORT_PHONE_QUERY = '(width < 64rem) and (height <= 720px)'

// One MediaQueryList for the page, re-created only if `window.matchMedia` itself is replaced
// (a test stubbing it), as in `usePrefersReducedMotion`.
let cachedFor: typeof window.matchMedia | null = null
let cached: MediaQueryList | null = null

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  if (cachedFor !== window.matchMedia) {
    cachedFor = window.matchMedia
    cached = window.matchMedia(SHORT_PHONE_QUERY)
  }
  return cached
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  if (!list) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

/** Whether the tour is on a short phone. False where `matchMedia` is unavailable. */
export function useShortPhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false)
}
