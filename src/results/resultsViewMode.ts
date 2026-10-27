import type { ResultsLanding } from './resultsLanding'

/**
 * Which results view the page shows, and where that choice lives: the `view` search parameter,
 * with the remembered landing (`resultsLanding.ts`) as the fallback.
 *
 * No router — none is installed and none should be (guided-results-view design.md D7.4). The mode is
 * read once from `location.search` at mount. Each switch the reader makes PUSHES a history entry
 * stamped with its mode (`{ stridesView: mode }`), so browser Back steps to the previous view instead
 * of leaving the page and losing the in-memory analysis; `popstate` reads the stamp back. The stamp,
 * not the address, says which view an entry shows: the tour and the summary share an address, so
 * only the stamp tells Back-to-the-summary from Back-to-a-replayed-tour.
 *
 * **The tour is the default, and the parse is deliberately strict** (`strides-trn2.2`). Exactly one
 * `view` parameter whose value is exactly `tour`, `summary` or `classic` selects that view, and
 * `guide` — the guided view's old value, the default from `strides-8c3` until the tour replaced it —
 * selects the tour, so every link written before the change still opens on the default. Everything
 * else falls back: absent, empty, an unknown value, a differently-cased `CLASSIC`, and a repeated
 * parameter even when one of its copies is valid. The fallback is the remembered landing when one is
 * set (a reader who skipped the tour once lands on the summary), otherwise the tour. An explicit
 * value always beats the landing; `guide` does too, because it names the default view, not a
 * preference for whatever the reader last saw.
 *
 * Only classic is ever written to the address. Tour and summary remove `view`: the summary is
 * reached by skipping the tour and remembered through storage, not through the link, so a shared
 * address without `view` opens on whatever the recipient would normally see.
 */
export type ResultsViewMode = 'tour' | 'summary' | 'classic'

/** The search parameter the mode lives in. */
export const RESULTS_VIEW_PARAM = 'view'

const CLASSIC_VALUE = 'classic'
const LEGACY_GUIDE_VALUE = 'guide'
const EXPLICIT_VALUES: readonly ResultsViewMode[] = ['tour', 'summary', 'classic']

function isExplicitMode(value: string): value is ResultsViewMode {
  return (EXPLICIT_VALUES as readonly string[]).includes(value)
}

/** Pure: the view an address selects, given the remembered landing. Accepts a search string with or
 * without its leading `?`, i.e. exactly what `location.search` holds. */
export function resolveResultsViewMode(
  search: string,
  rememberedLanding: ResultsLanding | null,
): ResultsViewMode {
  const values = new URLSearchParams(search).getAll(RESULTS_VIEW_PARAM)
  if (values.length === 1) {
    const [value] = values
    if (isExplicitMode(value)) return value
    if (value === LEGACY_GUIDE_VALUE) return 'tour'
  }
  return rememberedLanding ?? 'tour'
}

/** Decodes one `key` of a raw `key=value` pair, or `null` if it is not valid percent-encoding. */
function decodeParamKey(pair: string): string | null {
  const rawKey = pair.split('=', 1)[0]
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '))
  } catch {
    return null
  }
}

/**
 * Pure: the search string (leading `?` included, or `''` when nothing is left) that selects `mode`,
 * derived from `search`.
 *
 * Every other parameter survives BYTE FOR BYTE — the raw pairs are filtered rather than round-tripped
 * through `URLSearchParams`, whose serializer would re-encode them (`%20` becomes `+`, for one) and
 * change an address the reader or some other tool wrote. Every existing `view` pair is removed, so a
 * repeated parameter collapses to one. Tour and summary leave `view` out entirely; classic appends
 * `view=classic` after whatever else is there.
 */
export function searchWithResultsViewMode(search: string, mode: ResultsViewMode): string {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const kept = raw
    .split('&')
    .filter((pair) => pair !== '' && decodeParamKey(pair) !== RESULTS_VIEW_PARAM)
  if (mode === 'classic') kept.push(`${RESULTS_VIEW_PARAM}=${CLASSIC_VALUE}`)
  return kept.length > 0 ? `?${kept.join('&')}` : ''
}

/** The key a history entry's state object carries its view under. */
export const RESULTS_VIEW_STATE_KEY = 'stridesView'

/** The view a history entry is stamped with, or `null` for an entry this module did not stamp —
 * one an in-page `#` link created, for instance. */
export function resultsViewModeFromHistoryState(state: unknown): ResultsViewMode | null {
  if (typeof state !== 'object' || state === null) return null
  const value: unknown = (state as Record<string, unknown>)[RESULTS_VIEW_STATE_KEY]
  return typeof value === 'string' && isExplicitMode(value) ? value : null
}

/** The current address with `view` rewritten for `mode`, as an absolute URL. Absolute rather than
 * `${pathname}${search}${hash}`: a path beginning `//` would otherwise be read as a
 * protocol-relative URL pointing at another origin, and the history call would throw. */
function addressFor(mode: ResultsViewMode): string {
  const next = new URL(window.location.href)
  next.search = searchWithResultsViewMode(window.location.search, mode)
  return next.href
}

/**
 * A reader's switch: pushes a new history entry stamped with `mode`, its address rewritten for
 * `mode` (the path, every other parameter and the hash kept). It always pushes, even when the
 * address does not change (tour and summary share one), because Back steps through entries, not
 * addresses.
 */
export function pushResultsViewMode(mode: ResultsViewMode): void {
  window.history.pushState({ [RESULTS_VIEW_STATE_KEY]: mode }, '', addressFor(mode))
}

/**
 * Stamps the CURRENT entry with `mode`, keeping its address and whatever else its state object holds,
 * and adds no entry. Used for the entry the page loaded on, so Back to it restores the view it opened
 * with rather than re-resolving (the landing may have changed since). Also used for an unstamped
 * entry that `popstate` lands on.
 */
export function stampResultsViewMode(mode: ResultsViewMode): void {
  const state: unknown = window.history.state
  const base = typeof state === 'object' && state !== null ? state : {}
  window.history.replaceState({ ...base, [RESULTS_VIEW_STATE_KEY]: mode }, '', window.location.href)
}
