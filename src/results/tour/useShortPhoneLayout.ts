import { useSyncExternalStore } from 'react'

/**
 * A short phone: below Tailwind's `lg` (64rem) and at most 720 px tall, which is most phones in
 * Safari once its toolbars are counted. There the tour's bar and the runner's controls share one
 * row (`strides-xsl3`).
 */
export const SHORT_PHONE_QUERY = '(max-width: 63.999rem) and (max-height: 720px)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(SHORT_PHONE_QUERY)
    : null
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
