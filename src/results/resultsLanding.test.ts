import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESULTS_LANDING_KEY, readResultsLanding, writeResultsLanding } from './resultsLanding'

describe('resultsLanding', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('uses the documented key', () => {
    expect(RESULTS_LANDING_KEY).toBe('strides.resultsLanding')
  })

  it('reads null when nothing is stored', () => {
    expect(readResultsLanding()).toBeNull()
  })

  it("reads 'summary' when exactly that is stored", () => {
    window.localStorage.setItem(RESULTS_LANDING_KEY, 'summary')
    expect(readResultsLanding()).toBe('summary')
  })

  it.each(['Summary', 'classic', 'tour', '', ' summary', '"summary"'])(
    'reads null for any other stored value (%j)',
    (value) => {
      window.localStorage.setItem(RESULTS_LANDING_KEY, value)
      expect(readResultsLanding()).toBeNull()
    },
  )

  it('writes the summary under the key', () => {
    writeResultsLanding()
    expect(window.localStorage.getItem(RESULTS_LANDING_KEY)).toBe('summary')
    expect(readResultsLanding()).toBe('summary')
  })

  it('reads null when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(readResultsLanding()).toBeNull()
  })

  it('does not throw when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => writeResultsLanding()).not.toThrow()
  })

  it('survives the localStorage getter itself throwing, for both read and write', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => window.localStorage).toThrow()
    expect(readResultsLanding()).toBeNull()
    expect(() => writeResultsLanding()).not.toThrow()
  })
})
