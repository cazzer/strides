/**
 * Which results view the page shows, and where that choice lives: the `view` search parameter.
 *
 * No router — none is installed and none should be (guided-results-view design.md D7.4). The mode is
 * read once from `location.search` and written back with `history.replaceState`, so a reload keeps
 * the choice and the address can be shared, without adding a history entry per toggle.
 *
 * **Classic is the default, and the parse is deliberately strict.** Exactly one `view` parameter
 * whose value is exactly `guide` selects the guided view; everything else selects classic — absent,
 * empty, `classic`, an unknown value, a differently-cased `GUIDE`, and a repeated parameter even when
 * one of its copies says `guide`. The app itself only ever writes the lowercase form, so strictness
 * costs a hand-typed URL nothing it could not recover from by clicking the toggle, while a lenient
 * parse would make "which view does this address show" a question with more than one spelling of
 * the answer. A repeated parameter is ambiguous by construction, and the tie goes to the default.
 */
export type ResultsViewMode = 'classic' | 'guide'

/** The search parameter the mode lives in. */
export const RESULTS_VIEW_PARAM = 'view'

/** The one value that selects the guided view. */
const GUIDE_VALUE = 'guide'

/** Pure: `?view=guide` → `'guide'`, anything else → `'classic'`. Accepts a search string with or
 * without its leading `?`, i.e. exactly what `location.search` holds. */
export function resolveResultsViewMode(search: string): ResultsViewMode {
  const values = new URLSearchParams(search).getAll(RESULTS_VIEW_PARAM)
  return values.length === 1 && values[0] === GUIDE_VALUE ? 'guide' : 'classic'
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
 * repeated parameter collapses to one. Classic removes `view` entirely rather than writing
 * `view=classic`, so the default address stays exactly as clean as it was before the view existed;
 * guide appends `view=guide` after whatever else is there.
 */
export function searchWithResultsViewMode(search: string, mode: ResultsViewMode): string {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const kept = raw
    .split('&')
    .filter((pair) => pair !== '' && decodeParamKey(pair) !== RESULTS_VIEW_PARAM)
  if (mode === 'guide') kept.push(`${RESULTS_VIEW_PARAM}=${GUIDE_VALUE}`)
  return kept.length > 0 ? `?${kept.join('&')}` : ''
}

/**
 * Writes `mode` into the current address with `history.replaceState`, keeping the path, every other
 * search parameter, the hash, and the existing history state object. Replace rather than push: a
 * toggle is a presentation preference, not a navigation, and Back should leave the page rather than
 * step through every view the reader tried.
 */
export function writeResultsViewMode(mode: ResultsViewMode): void {
  const nextSearch = searchWithResultsViewMode(window.location.search, mode)
  if (nextSearch === window.location.search) return
  // An absolute URL, not `${pathname}${search}${hash}`: a path beginning `//` would otherwise be
  // read as a protocol-relative URL pointing at another origin, and replaceState would throw.
  const next = new URL(window.location.href)
  next.search = nextSearch
  window.history.replaceState(window.history.state, '', next.href)
}
