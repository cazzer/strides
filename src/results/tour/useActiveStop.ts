import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { TourStopId } from '../../guidance/focusAreas'

/** The reading line, as a fraction of the viewport height: where MotionStoryStage reads too. */
export const READING_LINE_FRACTION = 0.42
/** How far below the tour's sticky bar the reading line sits at least, as a fraction of the screen
 * left under the bar. */
export const UNDER_BAR_FRACTION = 0.25

/**
 * Where the reading line is: 42% down the viewport, but never at or above the bottom of the tour's
 * sticky bar (`.runner-tour__header`, inside `root`) once it is stuck. On a short phone the session
 * header and the bar reach past 42% (375×548: the bar ends at 254 px, 42% is 230 px), so a stop at
 * rest, its top just under the bar, would never reach a line drawn there, and the runner would show
 * the stop before it (`strides-xsl3`). There the line is a quarter of the way down the screen under
 * the bar. Where the bar sticks (its `top`), not where it is: at the top of the page it has not
 * stuck yet, and a line under it would make the first stop active before the reader reached it.
 */
function readingLine(root: HTMLElement): number {
  const viewport = window.innerHeight
  const bar = root.querySelector<HTMLElement>('.runner-tour__header')
  const barBottom = bar ? (parseFloat(getComputedStyle(bar).top) || 0) + bar.getBoundingClientRect().height : 0
  return Math.max(viewport * READING_LINE_FRACTION, barBottom + (viewport - barBottom) * UNDER_BAR_FRACTION)
}

/**
 * Which tour stop the reader is on: the last `[data-tour-stop]` inside `rootRef` whose top has
 * reached the reading line, or `null` while the first is still below it. Keyboard focus landing in
 * a stop selects that stop at once (a fragment link focuses its stop too, through
 * `useRevealFragment`); the next scroll reads the line again.
 *
 * Scroll, window resize and the root's own resize are batched to one read per animation frame. `stopIds` is what the stops are,
 * so the listeners are re-read whenever the set of stops changes.
 */
export function useActiveStop(
  rootRef: RefObject<HTMLElement | null>,
  stopIds: readonly TourStopId[],
): TourStopId | null {
  const [active, setActive] = useState<TourStopId | null>(null)
  const stopKey = stopIds.join(' ')
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const known = new Set(stopKey.split(' '))
    const idOf = (element: Element | null): TourStopId | null => {
      const id = element instanceof HTMLElement ? element.dataset.tourStop : undefined
      return id !== undefined && known.has(id) ? (id as TourStopId) : null
    }
    let raf = 0
    const update = () => {
      const line = readingLine(root)
      let current: TourStopId | null = null
      for (const stop of root.querySelectorAll<HTMLElement>('[data-tour-stop]')) {
        if (stop.getBoundingClientRect().top <= line) current = idOf(stop) ?? current
      }
      setActive(current)
    }
    const schedule = () => {
      if (typeof requestAnimationFrame === 'function') {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(update)
      } else update()
    }
    const onFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const id = idOf(target.closest('[data-tour-stop]'))
      if (id !== null) setActive(id)
    }
    // A stop changing height (the scale-pass graft, a font load, a wrap) moves every stop below it
    // without a scroll, so the line is re-read when the root resizes too.
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    resizes?.observe(root)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    root.addEventListener('toggle', schedule, true)
    root.addEventListener('focusin', onFocus)
    schedule()
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      resizes?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      root.removeEventListener('toggle', schedule, true)
      root.removeEventListener('focusin', onFocus)
    }
  }, [rootRef, stopKey])
  return active
}
