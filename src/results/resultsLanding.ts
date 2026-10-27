/**
 * The remembered landing view: once a reader skips or finishes the runner tour, later results open
 * on the summary instead (`strides-trn2.2`). Stored in `localStorage` under one key with one value;
 * anything else in that slot reads as "nothing remembered".
 *
 * Storage is a convenience here, never a requirement. A private window, blocked site data, or a
 * sandboxed frame can make the `localStorage` GETTER itself throw (`SecurityError`), not just
 * `getItem`/`setItem`, so the property access sits inside the `try` too. A failure means the reader
 * sees the tour again next time — the default view, not a broken page — so it is swallowed rather
 * than surfaced: there is nothing a reader could do about it, and no view depends on it succeeding.
 */
export const RESULTS_LANDING_KEY = 'strides.resultsLanding'

export type ResultsLanding = 'summary'

const SUMMARY_LANDING: ResultsLanding = 'summary'

/** `'summary'` when exactly that is stored, otherwise `null` — including when storage throws. */
export function readResultsLanding(): ResultsLanding | null {
  try {
    return window.localStorage.getItem(RESULTS_LANDING_KEY) === SUMMARY_LANDING ? SUMMARY_LANDING : null
  } catch {
    // Unavailable storage reads as "nothing remembered"; see the module comment.
    return null
  }
}

/** Remembers the summary as the landing view. Does nothing if storage is unavailable. */
export function writeResultsLanding(): void {
  try {
    window.localStorage.setItem(RESULTS_LANDING_KEY, SUMMARY_LANDING)
  } catch {
    // Not remembering is the safe failure: the next visit opens on the tour; see the module comment.
  }
}
