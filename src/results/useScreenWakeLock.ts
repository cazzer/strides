import { useEffect } from 'react'

/** The slice of the Screen Wake Lock API this hook uses, so jsdom and older browsers type-check. */
interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null
  const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
  return api && typeof api.request === 'function' ? api : null
}

/**
 * Keeps the screen on while `active` (`strides-6os1`): on a phone analysis takes a minute or more
 * (`strides-6i6`), and a screen that sleeps mid-run hides the page, which pauses the playback
 * sampler and leaves the reader returning to an unfinished analysis.
 *
 * Presentation-only, by construction: nothing in the sampling path reads it, so it cannot move a
 * measurement (`perf-no-fidelity-tradeoffs`). Feature-detected, and a refused request is ignored —
 * the browser may decline (battery saver, a hidden tab), and that must never surface as an error.
 * Re-requested whenever the page becomes visible again while still active, because browsers release
 * a screen wake lock the moment the page is hidden.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    const api = wakeLockApi()
    if (!active || api === null) return

    let sentinel: WakeLockSentinelLike | null = null
    let disposed = false

    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      if (sentinel !== null && !sentinel.released) return
      api.request('screen').then(
        (lock) => {
          if (disposed) {
            void lock.release().catch(() => {})
            return
          }
          sentinel = lock
        },
        () => {},
      )
    }

    const onVisibilityChange = () => acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)
    acquire()

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (sentinel !== null && !sentinel.released) void sentinel.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}
