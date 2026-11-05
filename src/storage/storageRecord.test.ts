import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_RECORD_KEY, clearStorageRecord, readStorageRecord, writeStorageRecord } from './storageRecord'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.removeItem(STORAGE_RECORD_KEY)
})

describe('storage record', () => {
  it('round-trips and clears', () => {
    writeStorageRecord({ provider: 'google-drive', rootFolderId: 'R' })
    expect(readStorageRecord()).toEqual({ provider: 'google-drive', rootFolderId: 'R' })
    clearStorageRecord()
    expect(readStorageRecord()).toBeNull()
  })

  it('ignores a malformed or foreign record', () => {
    window.localStorage.setItem(STORAGE_RECORD_KEY, '{"provider":"dropbox"}')
    expect(readStorageRecord()).toBeNull()
    window.localStorage.setItem(STORAGE_RECORD_KEY, 'not json')
    expect(readStorageRecord()).toBeNull()
  })

  it('swallows storage failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => writeStorageRecord({ provider: 'fake', rootFolderId: null })).not.toThrow()
    expect(readStorageRecord()).toBeNull()
  })
})
