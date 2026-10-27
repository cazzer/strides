import type { ResultsLanding } from './resultsLanding'

/**
 * Which results view the page shows, and where that choice lives: the `view` search parameter,
 * with the remembered landing (`resultsLanding.ts`) as the fallback.
 *
 * No router — none is installed and none should be (guided-results-view design.md D7.4). The mode is
 * read once from `location.search` and written back with `history.replaceState`, so a reload keeps
 * an explicit choice and the address can be shared, without adding a history entry per switch.
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

/**
 * Writes `mode` into the current address with `history.replaceState`, keeping the path, every other
 * search parameter, the hash, and the existing history state object. Replace rather than push: a
 * view switch is a presentation preference, not a navigation, and Back should leave the page rather
 * than step through every view the reader tried.
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
