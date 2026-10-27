import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** How much of the element must be on screen to count as seen. */
export const MOSTLY_VISIBLE_THRESHOLD = 0.9

/**
 * Whether at least 90% of `ref`'s element is on screen. The tour gates the runner's intro on it, on
 * top of the runner's own "seen" signal (any part on screen), so the intro never plays out with the
 * figure mostly below the fold.
 *
 * True where `IntersectionObserver` is unavailable: nothing can be measured, so nothing is held back.
 */
export function useMostlyVisible(ref: RefObject<Element | null>): boolean {
  const supported = typeof IntersectionObserver === 'function'
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        // An element taller than the viewport can never be 90% on screen; filling 90% of the
        // viewport counts instead.
        const viewport = entry.rootBounds?.height ?? Infinity
        setVisible(
          entry.intersectionRatio >= MOSTLY_VISIBLE_THRESHOLD ||
            entry.intersectionRect.height >= viewport * MOSTLY_VISIBLE_THRESHOLD,
        )
      },
      { threshold: [0, 0.25, 0.5, 0.75, MOSTLY_VISIBLE_THRESHOLD, 1] },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return supported ? visible : true
}
