import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** How much of the element must be on screen to count as seen. */
export const MOSTLY_VISIBLE_THRESHOLD = 0.9
/**
 * How tall the element must be to count as seen at all, in CSS px. An `IntersectionObserver`
 * reports a ratio of 1 for a zero-area target inside the root, so without a floor a figure squeezed
 * to nothing counted as on screen and the intro played out unseen (`strides-xsl3`).
 */
export const MOSTLY_VISIBLE_MIN_HEIGHT = 120

/**
 * Whether at least 90% of an element is on screen and it is at least 120 px tall: the first match
 * of `selector` inside `ref`'s element, or that element itself when nothing matches. The tour gates
 * the runner's intro on its FIGURE (the drawing, not the caption, controls or legend around it), on
 * top of the runner's own "seen" signal (any part on screen), so the intro never plays out with the
 * figure below the fold or too small to see.
 *
 * The element's size can change without its intersection ratio crossing a threshold (a figure that
 * grows from 0 px while fully on screen stays at ratio 1), so a resize re-reads it.
 *
 * True where `IntersectionObserver` is unavailable: nothing can be measured, so nothing is held back.
 */
export function useMostlyVisible(ref: RefObject<Element | null>, selector?: string): boolean {
  const supported = typeof IntersectionObserver === 'function'
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const container = ref.current
    const element = (selector ? container?.querySelector(selector) : null) ?? container
    if (!element || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        // An element taller than the viewport can never be 90% on screen; filling 90% of the
        // viewport counts instead.
        const viewport = entry.rootBounds?.height ?? Infinity
        const onScreen =
          entry.intersectionRatio >= MOSTLY_VISIBLE_THRESHOLD ||
          entry.intersectionRect.height >= viewport * MOSTLY_VISIBLE_THRESHOLD
        setVisible(onScreen && entry.boundingClientRect.height >= MOSTLY_VISIBLE_MIN_HEIGHT)
      },
      { threshold: [0, 0.25, 0.5, 0.75, MOSTLY_VISIBLE_THRESHOLD, 1] },
    )
    observer.observe(element)
    // Observing again delivers a fresh entry, with the new size.
    const resizes =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            observer.unobserve(element)
            observer.observe(element)
          })
        : null
    resizes?.observe(element)
    return () => {
      resizes?.disconnect()
      observer.disconnect()
    }
  }, [ref, selector])
  return supported ? visible : true
}
