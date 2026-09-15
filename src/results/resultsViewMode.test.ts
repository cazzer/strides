import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveResultsViewMode,
  searchWithResultsViewMode,
  writeResultsViewMode,
} from './resultsViewMode'
import type { ResultsViewMode } from './resultsViewMode'

describe('resolveResultsViewMode', () => {
  const cases: Array<[label: string, search: string, expected: ResultsViewMode]> = [
    ['absent (empty search)', '', 'classic'],
    ['a bare question mark', '?', 'classic'],
    ['view=guide', '?view=guide', 'guide'],
    ['view=guide without the leading ?', 'view=guide', 'guide'],
    ['view=guide beside other params', '?clip=3&view=guide&debug', 'guide'],
    ['view=classic', '?view=classic', 'classic'],
    // Strict by decision (documented in resultsViewMode.ts): the app only ever writes lowercase.
    ['GUIDE uppercase', '?view=GUIDE', 'classic'],
    ['Guide mixed case', '?view=Guide', 'classic'],
    ['an empty value', '?view=', 'classic'],
    ['a valueless key', '?view', 'classic'],
    ['garbage value', '?view=%F0%9F%A4%B7', 'classic'],
    ['a value that merely contains guide', '?view=guided', 'classic'],
    ['padded value', '?view=%20guide', 'classic'],
    ['unrelated params only', '?foo=bar', 'classic'],
    ['a different key that looks similar', '?views=guide', 'classic'],
    // Ambiguous, so the tie goes to the default — even when one copy says guide.
    ['repeated, guide then classic', '?view=guide&view=classic', 'classic'],
    ['repeated, classic then guide', '?view=classic&view=guide', 'classic'],
    ['repeated, guide twice', '?view=guide&view=guide', 'classic'],
  ]

  it.each(cases)('%s → %s', (_label, search, expected) => {
    expect(resolveResultsViewMode(search)).toBe(expected)
  })
})

describe('searchWithResultsViewMode', () => {
  it('appends view=guide to an empty search', () => {
    expect(searchWithResultsViewMode('', 'guide')).toBe('?view=guide')
  })

  it('leaves an empty search empty for classic — the default address stays clean', () => {
    expect(searchWithResultsViewMode('', 'classic')).toBe('')
  })

  it('removes view entirely for classic, rather than writing view=classic', () => {
    expect(searchWithResultsViewMode('?view=guide', 'classic')).toBe('')
    expect(searchWithResultsViewMode('?a=1&view=guide&b=2', 'classic')).toBe('?a=1&b=2')
  })

  it('keeps every other parameter byte for byte, in order', () => {
    // `%20` would become `+` through a URLSearchParams round-trip; it must not.
    expect(searchWithResultsViewMode('?q=a%20b&flag&x=1+2', 'guide')).toBe(
      '?q=a%20b&flag&x=1+2&view=guide',
    )
    expect(searchWithResultsViewMode('?q=a%20b&view=guide&flag', 'classic')).toBe('?q=a%20b&flag')
  })

  it('collapses a repeated view parameter to the one being written', () => {
    expect(searchWithResultsViewMode('?view=classic&a=1&view=guide', 'guide')).toBe(
      '?a=1&view=guide',
    )
    expect(searchWithResultsViewMode('?view=classic&view=guide', 'classic')).toBe('')
  })

  it('recognises an encoded view key, and leaves a malformed pair alone', () => {
    expect(searchWithResultsViewMode('?%76iew=guide', 'classic')).toBe('')
    expect(searchWithResultsViewMode('?%E0%A4%A=1', 'guide')).toBe('?%E0%A4%A=1&view=guide')
  })

  it('round-trips through resolveResultsViewMode', () => {
    for (const mode of ['classic', 'guide'] as const) {
      expect(resolveResultsViewMode(searchWithResultsViewMode('?a=1&view=GUIDE', mode))).toBe(mode)
    }
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

  it('writes view=guide, preserving the path, every other param and the hash', () => {
    window.history.replaceState(null, '', '/strides/?clip=2&q=a%20b#results')
    writeResultsViewMode('guide')
    expect(window.location.pathname).toBe('/strides/')
    expect(window.location.search).toBe('?clip=2&q=a%20b&view=guide')
    expect(window.location.hash).toBe('#results')
  })

  it('strips view entirely for classic, preserving everything else', () => {
    window.history.replaceState(null, '', '/strides/?clip=2&view=guide#results')
    writeResultsViewMode('classic')
    expect(window.location.pathname).toBe('/strides/')
    expect(window.location.search).toBe('?clip=2')
    expect(window.location.hash).toBe('#results')
  })

  it('leaves no dangling ? when view was the only parameter', () => {
    window.history.replaceState(null, '', '/strides/?view=guide')
    writeResultsViewMode('classic')
    expect(window.location.href).toBe(new URL('/strides/', originalHref).href)
  })

  it('replaces rather than pushes, and keeps the existing history state object', () => {
    const state = { some: 'state' }
    window.history.replaceState(state, '', '/strides/')
    const lengthBefore = window.history.length
    const push = vi.spyOn(window.history, 'pushState')
    writeResultsViewMode('guide')
    expect(push).not.toHaveBeenCalled()
    expect(window.history.length).toBe(lengthBefore)
    expect(window.history.state).toEqual(state)
  })

  it('does not touch history when the address already says what is being written', () => {
    window.history.replaceState(null, '', '/strides/?view=guide')
    const replace = vi.spyOn(window.history, 'replaceState')
    writeResultsViewMode('guide')
    expect(replace).not.toHaveBeenCalled()
  })

  it('survives a reload: what it writes is what resolve reads back', () => {
    window.history.replaceState(null, '', '/strides/')
    writeResultsViewMode('guide')
    expect(resolveResultsViewMode(window.location.search)).toBe('guide')
    writeResultsViewMode('classic')
    expect(resolveResultsViewMode(window.location.search)).toBe('classic')
  })
})
