import { afterEach, describe, expect, it } from 'vitest'
import {
  pushProgressPage,
  replaceWithSessionPage,
  resolveSessionPage,
  sessionPageFromHistoryState,
  stampProgressPage,
} from './progressPageRoute'

afterEach(() => window.history.replaceState(null, '', '/'))

describe('progress page route', () => {
  it('resolves ?page=progress only when it is the one page value', () => {
    expect(resolveSessionPage('?page=progress')).toBe('progress')
    expect(resolveSessionPage('?view=classic&page=progress')).toBe('progress')
    expect(resolveSessionPage('?page=progress&page=progress')).toBe('session')
    expect(resolveSessionPage('?page=other')).toBe('session')
    expect(resolveSessionPage('')).toBe('session')
  })

  it('pushes an entry that keeps the view stamp and the other params', () => {
    window.history.replaceState({ stridesView: 'summary' }, '', '/strides/?view=classic')
    pushProgressPage()
    expect(window.location.search).toBe('?view=classic&page=progress')
    expect(window.history.state).toEqual({ stridesView: 'summary', stridesPage: 'progress' })
    expect(sessionPageFromHistoryState(window.history.state)).toBe('progress')
  })

  it('stamps the landing entry, and replaces it with the session page', () => {
    window.history.replaceState({ stridesView: 'tour' }, '', '/strides/?page=progress')
    stampProgressPage()
    expect(sessionPageFromHistoryState(window.history.state)).toBe('progress')
    replaceWithSessionPage()
    expect(window.location.search).toBe('')
    expect(window.history.state).toEqual({ stridesView: 'tour' })
    expect(sessionPageFromHistoryState(null)).toBe('session')
  })
})
