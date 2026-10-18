import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveResultsViewMode,
  searchWithResultsViewMode,
  writeResultsViewMode,
} from './resultsViewMode'
import type { ResultsViewMode } from './resultsViewMode'

describe('resolveResultsViewMode', () => {
  const cases: Array<[label: string, search: string, expected: ResultsViewMode]> = [
    ['absent (empty search)', '', 'guide'],
    ['a bare question mark', '?', 'guide'],
    ['view=classic', '?view=classic', 'classic'],
    ['view=classic without the leading ?', 'view=classic', 'classic'],
    ['view=classic beside other params', '?clip=3&view=classic&debug', 'classic'],
    // Links written before the default flipped (strides-8c3) keep landing on the guided view.
    ['view=guide', '?view=guide', 'guide'],
    // Strict by decision (documented in resultsViewMode.ts): the app only ever writes lowercase.
    ['CLASSIC uppercase', '?view=CLASSIC', 'guide'],
    ['Classic mixed case', '?view=Classic', 'guide'],
    ['an empty value', '?view=', 'guide'],
    ['a valueless key', '?view', 'guide'],
    ['garbage value', '?view=%F0%9F%A4%B7', 'guide'],
    ['a value that merely contains classic', '?view=classical', 'guide'],
    ['padded value', '?view=%20classic', 'guide'],
    ['unrelated params only', '?foo=bar', 'guide'],
    ['a different key that looks similar', '?views=classic', 'guide'],
    // Ambiguous, so the tie goes to the default — even when one copy says classic.
    ['repeated, guide then classic', '?view=guide&view=classic', 'guide'],
    ['repeated, classic then guide', '?view=classic&view=guide', 'guide'],
    ['repeated, classic twice', '?view=classic&view=classic', 'guide'],
  ]

  it.each(cases)('%s → %s', (_label, search, expected) => {
    expect(resolveResultsViewMode(search)).toBe(expected)
  })
})

describe('searchWithResultsViewMode', () => {
  it('appends view=classic to an empty search', () => {
    expect(searchWithResultsViewMode('', 'classic')).toBe('?view=classic')
  })

  it('leaves an empty search empty for guide — the default address stays clean', () => {
    expect(searchWithResultsViewMode('', 'guide')).toBe('')
  })

  it('removes view entirely for guide, rather than writing view=guide', () => {
    expect(searchWithResultsViewMode('?view=classic', 'guide')).toBe('')
    expect(searchWithResultsViewMode('?a=1&view=classic&b=2', 'guide')).toBe('?a=1&b=2')
    // A pre-flip guided link is normalised to the clean default address.
    expect(searchWithResultsViewMode('?view=guide', 'guide')).toBe('')
  })

  it('keeps every other parameter byte for byte, in order', () => {
    // `%20` would become `+` through a URLSearchParams round-trip; it must not.
    expect(searchWithResultsViewMode('?q=a%20b&flag&x=1+2', 'classic')).toBe(
      '?q=a%20b&flag&x=1+2&view=classic',
    )
    expect(searchWithResultsViewMode('?q=a%20b&view=classic&flag', 'guide')).toBe('?q=a%20b&flag')
  })

  it('collapses a repeated view parameter to the one being written', () => {
    expect(searchWithResultsViewMode('?view=guide&a=1&view=classic', 'classic')).toBe(
      '?a=1&view=classic',
    )
    expect(searchWithResultsViewMode('?view=classic&view=guide', 'guide')).toBe('')
  })

  it('recognises an encoded view key, and leaves a malformed pair alone', () => {
    expect(searchWithResultsViewMode('?%76iew=classic', 'guide')).toBe('')
    expect(searchWithResultsViewMode('?%E0%A4%A=1', 'classic')).toBe('?%E0%A4%A=1&view=classic')
  })

  it('round-trips through resolveResultsViewMode', () => {
    for (const mode of ['classic', 'guide'] as const) {
      expect(resolveResultsViewMode(searchWithResultsViewMode('?a=1&view=CLASSIC', mode))).toBe(mode)
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

  it('writes view=classic, preserving the path, every other param and the hash', () => {
    window.history.replaceState(null, '', '/strides/?clip=2&q=a%20b#results')
    writeResultsViewMode('classic')
    expect(window.location.pathname).toBe('/strides/')
    expect(window.location.search).toBe('?clip=2&q=a%20b&view=classic')
    expect(window.location.hash).toBe('#results')
  })

  it('strips view entirely for guide, preserving everything else', () => {
    window.history.replaceState(null, '', '/strides/?clip=2&view=classic#results')
    writeResultsViewMode('guide')
    expect(window.location.pathname).toBe('/strides/')
    expect(window.location.search).toBe('?clip=2')
    expect(window.location.hash).toBe('#results')
  })

  it('leaves no dangling ? when view was the only parameter', () => {
    window.history.replaceState(null, '', '/strides/?view=classic')
    writeResultsViewMode('guide')
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
    expect(resolveResultsViewMode(window.location.search)).toBe('classic')
    writeResultsViewMode('guide')
    expect(resolveResultsViewMode(window.location.search)).toBe('guide')
  })
})
