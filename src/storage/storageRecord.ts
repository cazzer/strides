import type { StorageProviderId } from './provider'

/**
 * The one thing remembered locally (design D7): which provider the runner connected and its root
 * folder, so a later visit can offer Progress and preload the provider's script. No token, no
 * email, no results. Storage failures (private windows) are swallowed: the runner just connects
 * again.
 */
export const STORAGE_RECORD_KEY = 'strides.storage'

export interface StorageRecord {
  provider: StorageProviderId
  rootFolderId: string | null
}

export function readStorageRecord(): StorageRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_RECORD_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { provider, rootFolderId } = parsed as Record<string, unknown>
    if (provider !== 'google-drive' && provider !== 'fake') return null
    return { provider, rootFolderId: typeof rootFolderId === 'string' ? rootFolderId : null }
  } catch {
    return null
  }
}

export function writeStorageRecord(record: StorageRecord): void {
  try {
    window.localStorage.setItem(STORAGE_RECORD_KEY, JSON.stringify(record))
  } catch {
    // Private window or storage disabled: nothing is remembered, nothing breaks.
  }
}

export function clearStorageRecord(): void {
  try {
    window.localStorage.removeItem(STORAGE_RECORD_KEY)
  } catch {
    // As above.
  }
}
