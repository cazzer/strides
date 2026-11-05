/**
 * The progress page's place in history (design D6). Not a router: like the results views
 * (`resultsViewMode.ts`), entries are stamped and `popstate` reads the stamp. The progress entry
 * keeps the results view's own `stridesView` stamp, so popping onto it never switches the view.
 */
export const PAGE_PARAM = 'page'
export const PROGRESS_VALUE = 'progress'
export const PAGE_STATE_KEY = 'stridesPage'

export type SessionPage = 'session' | 'progress'

export function resolveSessionPage(search: string): SessionPage {
  const values = new URLSearchParams(search).getAll(PAGE_PARAM)
  return values.length === 1 && values[0] === PROGRESS_VALUE ? 'progress' : 'session'
}

export function sessionPageFromHistoryState(state: unknown): SessionPage {
  if (typeof state !== 'object' || state === null) return 'session'
  return (state as Record<string, unknown>)[PAGE_STATE_KEY] === PROGRESS_VALUE ? 'progress' : 'session'
}

function currentState(): Record<string, unknown> {
  const state: unknown = window.history.state
  return typeof state === 'object' && state !== null ? { ...(state as Record<string, unknown>) } : {}
}

function addressWithPage(page: SessionPage): string {
  const next = new URL(window.location.href)
  if (page === 'progress') next.searchParams.set(PAGE_PARAM, PROGRESS_VALUE)
  else next.searchParams.delete(PAGE_PARAM)
  return next.href
}

/** Opens progress as a new history entry, so browser Back returns to the results. */
export function pushProgressPage(): void {
  window.history.pushState({ ...currentState(), [PAGE_STATE_KEY]: PROGRESS_VALUE }, '', addressWithPage('progress'))
}

/** Stamps the entry the page loaded on (`?page=progress`). */
export function stampProgressPage(): void {
  window.history.replaceState({ ...currentState(), [PAGE_STATE_KEY]: PROGRESS_VALUE }, '', window.location.href)
}

/** Leaves progress in place, for a page that opened on it and has no entry to go back to. */
export function replaceWithSessionPage(): void {
  const state = currentState()
  delete state[PAGE_STATE_KEY]
  window.history.replaceState(state, '', addressWithPage('session'))
}
