import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultsLanding } from './resultsLanding'
import {
  resolveResultsViewMode,
  searchWithResultsViewMode,
  writeResultsViewMode,
} from './resultsViewMode'
import type { ResultsViewMode } from './resultsViewMode'

describe('resolveResultsViewMode', () => {
  const cases: Array<[label: string, search: string, landing: ResultsLanding | null, expected: ResultsViewMode]> = [
    // Absent: the landing decides, else the tour.
    ['absent, no landing', '', null, 'tour'],
    ['absent, landing summary', '', 'summary', 'summary'],
    ['a bare question mark, no landing', '?', null, 'tour'],
    ['a bare question mark, landing summary', '?', 'summary', 'summary'],
    ['unrelated params only, no landing', '?foo=bar', null, 'tour'],
    ['unrelated params only, landing summary', '?foo=bar', 'summary', 'summary'],

    // An explicit value always beats the landing.
    ['view=tour', '?view=tour', null, 'tour'],
    ['view=tour over a summary landing', '?view=tour', 'summary', 'tour'],
    ['view=summary', '?view=summary', null, 'summary'],
    ['view=summary over a summary landing', '?view=summary', 'summary', 'summary'],
    ['view=classic', '?view=classic', null, 'classic'],
    ['view=classic over a summary landing', '?view=classic', 'summary', 'classic'],
    ['view=classic without the leading ?', 'view=classic', null, 'classic'],
    ['view=classic beside other params', '?clip=3&view=classic&debug', 'summary', 'classic'],

    // The guided view's old value names the default view, not "whatever the reader saw last".
    ['view=guide', '?view=guide', null, 'tour'],
    ['view=guide even with a summary landing', '?view=guide', 'summary', 'tour'],

    // Strict by decision (documented in resultsViewMode.ts): the app only ever writes lowercase.
    ['CLASSIC uppercase', '?view=CLASSIC', null, 'tour'],
    ['CLASSIC uppercase, landing summary', '?view=CLASSIC', 'summary', 'summary'],
    ['Summary mixed case', '?view=Summary', null, 'tour'],
    ['GUIDE uppercase, landing summary', '?view=GUIDE', 'summary', 'summary'],
    ['an empty value', '?view=', null, 'tour'],
    ['an empty value, landing summary', '?view=', 'summary', 'summary'],
    ['a valueless key', '?view', null, 'tour'],
    ['a valueless key, landing summary', '?view', 'summary', 'summary'],
    ['garbage value', '?view=%F0%9F%A4%B7', null, 'tour'],
    ['unknown value, landing summary', '?view=nonsense', 'summary', 'summary'],
    ['a value that merely contains classic', '?view=classical', null, 'tour'],
    ['padded value', '?view=%20classic', null, 'tour'],
    ['a different key that looks similar', '?views=classic', null, 'tour'],

    // Ambiguous, so it falls back — even when every copy is valid.
    ['repeated, guide then classic', '?view=guide&view=classic', null, 'tour'],
    ['repeated, classic then summary', '?view=classic&view=summary', null, 'tour'],
    ['repeated, classic twice', '?view=classic&view=classic', null, 'tour'],
    ['repeated, classic twice, landing summary', '?view=classic&view=classic', 'summary', 'summary'],
    ['repeated, tour twice, landing summary', '?view=tour&view=tour', 'summary', 'summary'],
  ]

  it.each(cases)('%s → %s', (_label, search, landing, expected) => {
    expect(resolveResultsViewMode(search, landing)).toBe(expected)
  })
})

describe('searchWithResultsViewMode', () => {
  it('appends view=classic to an empty search', () => {
    expect(searchWithResultsViewMode('', 'classic')).toBe('?view=classic')
  })

  it.each(['tour', 'summary'] as const)('leaves an empty search empty for %s', (mode) => {
    expect(searchWithResultsViewMode('', mode)).toBe('')
  })

  it.each(['tour', 'summary'] as const)('removes view entirely for %s, rather than writing a value', (mode) => {
    expect(searchWithResultsViewMode('?view=classic', mode)).toBe('')
    expect(searchWithResultsViewMode('?a=1&view=classic&b=2', mode)).toBe('?a=1&b=2')
    // A pre-tour guided link is normalised to the clean default address.
    expect(searchWithResultsViewMode('?view=guide', mode)).toBe('')
    expect(searchWithResultsViewMode('?view=summary', mode)).toBe('')
  })

  it('is byte-exact for all three modes, keeping every other parameter in order', () => {
    // `%20` would become `+` through a URLSearchParams round-trip; it must not.
    const search = '?q=a%20b&view=guide&flag&x=1+2'
    expect(searchWithResultsViewMode(search, 'classic')).toBe('?q=a%20b&flag&x=1+2&view=classic')
    expect(searchWithResultsViewMode(search, 'summary')).toBe('?q=a%20b&flag&x=1+2')
    expect(searchWithResultsViewMode(search, 'tour')).toBe('?q=a%20b&flag&x=1+2')
  })

  it('collapses a repeated view parameter to the one being written', () => {
    expect(searchWithResultsViewMode('?view=guide&a=1&view=classic', 'classic')).toBe(
      '?a=1&view=classic',
    )
    expect(searchWithResultsViewMode('?view=classic&view=guide', 'tour')).toBe('')
  })

  it('recognises an encoded view key, and leaves a malformed pair alone', () => {
    expect(searchWithResultsViewMode('?%76iew=classic', 'tour')).toBe('')
    expect(searchWithResultsViewMode('?%E0%A4%A=1', 'classic')).toBe('?%E0%A4%A=1&view=classic')
  })

  it('round-trips through resolveResultsViewMode with no landing', () => {
    for (const mode of ['classic', 'tour'] as const) {
      expect(
        resolveResultsViewMode(searchWithResultsViewMode('?a=1&view=CLASSIC', mode), null),
      ).toBe(mode)
    }
    // The summary is not carried by the address: it comes back through the landing.
    const summarySearch = searchWithResultsViewMode('?a=1&view=classic', 'summary')
    expect(resolveResultsViewMode(summarySearch, null)).toBe('tour')
    expect(resolveResultsViewMode(summarySearch, 'summary')).toBe('summary')
  })
})

describe('writeResultsViewMode', () => {
  let originalHref: string

  beforeEach(() => {
    originalHref = window.location.href
  })

  afterEach(() => {
    window.history.replaceState(null, '', originalHref)
    vi.restoreAllMocks()
  })

  it('writes view=classic, preserving the path, every other param and the hash', () => {
    window.history.replaceState(null, '', '/strides/?clip=2&q=a%20b#results')
    writeResultsViewMode('classic')
    expect(window.location.pathname).toBe('/strides/')
    expect(window.location.search).toBe('?clip=2&q=a%20b&view=classic')
    expect(window.location.hash).toBe('#results')
  })

  it.each(['tour', 'summary'] as const)('strips view entirely for %s, preserving everything else', (mode) => {
    window.history.replaceState(null, '', '/strides/?clip=2&view=classic#results')
    writeResultsViewMode(mode)
    expect(window.location.pathname).toBe('/strides/')
    expect(window.location.search).toBe('?clip=2')
    expect(window.location.hash).toBe('#results')
  })

  it('leaves no dangling ? when view was the only parameter', () => {
    window.history.replaceState(null, '', '/strides/?view=classic')
    writeResultsViewMode('tour')
    expect(window.location.href).toBe(new URL('/strides/', originalHref).href)
  })

  it('replaces rather than pushes, and keeps the existing history state object', () => {
    const state = { some: 'state' }
    window.history.replaceState(state, '', '/strides/')
    const lengthBefore = window.history.length
    const push = vi.spyOn(window.history, 'pushState')
    writeResultsViewMode('classic')
    expect(push).not.toHaveBeenCalled()
    expect(window.history.length).toBe(lengthBefore)
    expect(window.history.state).toEqual(state)
  })

  it('does not touch history when the address already says what is being written', () => {
    window.history.replaceState(null, '', '/strides/?view=classic')
    const replace = vi.spyOn(window.history, 'replaceState')
    writeResultsViewMode('classic')
    expect(replace).not.toHaveBeenCalled()
  })

  it('survives a reload: what it writes is what resolve reads back', () => {
    window.history.replaceState(null, '', '/strides/')
    writeResultsViewMode('classic')
    expect(resolveResultsViewMode(window.location.search, 'summary')).toBe('classic')
    writeResultsViewMode('tour')
    expect(resolveResultsViewMode(window.location.search, null)).toBe('tour')
  })
})
