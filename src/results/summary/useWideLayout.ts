import { useSyncExternalStore } from 'react'

/** Tailwind's `lg` breakpoint, where the summary puts the runner beside the rows. */
const WIDE_QUERY = '(min-width: 64rem)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_QUERY)
    : null
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  if (!list) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

/**
 * Whether the summary is laid out wide (runner beside the rows, `lg` and up). False where
 * `matchMedia` is unavailable: the narrow layout is the default, as in the CSS.
 */
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false)
}
