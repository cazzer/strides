import { useEffect, useSyncExternalStore } from 'react'
import { StorageError, type ProviderAvailability, type StorageProvider } from './provider'
import { clearStorageRecord, readStorageRecord, writeStorageRecord, type StorageRecord } from './storageRecord'
import { resolveStorageProvider } from './resolveStorageProvider'

/**
 * The connection as React sees it: one store per provider, shared by the save panel, the header's
 * Progress entry and the progress page, so connecting in one updates the others.
 *
 * `remembered` is the local `strides.storage` record (design D7). A remembered runner has no token
 * after a reload; their next Save or Progress asks again with `prompt: ''`.
 */
export interface ConnectionSnapshot {
  provider: StorageProvider
  availability: ProviderAvailability
  prepared: boolean
  preparing: boolean
  remembered: StorageRecord | null
}

export interface StorageConnection {
  getSnapshot(): ConnectionSnapshot
  subscribe(listener: () => void): () => void
  prepare(): Promise<void>
  /** Gesture-safe: calls the provider's connect synchronously. */
  connect(): Promise<void>
  /** Gesture-safe: calls the provider's ensureAccess synchronously. */
  ensureAccess(): Promise<void>
  disconnect(): Promise<void>
  rememberRoot(rootFolderId: string): void
  /** Re-read the provider (its token can expire on its own). */
  refresh(): void
}

export function createStorageConnection(provider: StorageProvider): StorageConnection {
  const listeners = new Set<() => void>()
  let preparing = false
  let snapshot: ConnectionSnapshot = compute()

  function compute(): ConnectionSnapshot {
    const remembered = readStorageRecord()
    return {
      provider,
      availability: provider.availability(),
      prepared: provider.isPrepared(),
      preparing,
      remembered: remembered && remembered.provider === provider.id ? remembered : null,
    }
  }
  function notify(): void {
    const next = compute()
    const same =
      next.availability === snapshot.availability &&
      next.prepared === snapshot.prepared &&
      next.preparing === snapshot.preparing &&
      JSON.stringify(next.remembered) === JSON.stringify(snapshot.remembered)
    if (same) return
    snapshot = next
    listeners.forEach((l) => l())
  }
  function remember(): void {
    const current = readStorageRecord()
    if (current?.provider === provider.id) return
    writeStorageRecord({ provider: provider.id, rootFolderId: null })
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    prepare() {
      if (provider.isPrepared()) return Promise.resolve()
      preparing = true
      notify()
      return provider.prepare().finally(() => {
        preparing = false
        notify()
      })
    },
    connect() {
      return provider.connect().then(
        () => {
          remember()
          notify()
        },
        (error) => {
          notify()
          throw error
        },
      )
    },
    ensureAccess() {
      return provider.ensureAccess().then(
        () => {
          remember()
          notify()
        },
        (error) => {
          notify()
          throw error
        },
      )
    },
    async disconnect() {
      try {
        await provider.disconnect()
      } finally {
        clearStorageRecord()
        notify()
      }
    },
    rememberRoot(rootFolderId) {
      writeStorageRecord({ provider: provider.id, rootFolderId })
      notify()
    },
    refresh: notify,
  }
}

let shared: StorageConnection | null = null

export function sharedStorageConnection(): StorageConnection {
  shared ??= createStorageConnection(resolveStorageProvider())
  return shared
}

/** Test hook. */
export function setSharedStorageConnectionForTests(next: StorageConnection | null): void {
  shared = next
}

/**
 * Subscribes to the shared connection. A runner who connected on an earlier visit gets the
 * provider's script preloaded (they already opted in), so their next tap can open the popup
 * inside the gesture.
 */
export function useStorageConnection(connection: StorageConnection = sharedStorageConnection()): {
  snapshot: ConnectionSnapshot
  connection: StorageConnection
} {
  const snapshot = useSyncExternalStore(connection.subscribe, connection.getSnapshot)
  const shouldPreload =
    snapshot.remembered !== null && !snapshot.prepared && !snapshot.preparing && snapshot.availability !== 'unavailable'
  useEffect(() => {
    if (shouldPreload) connection.prepare().catch(() => undefined)
  }, [shouldPreload, connection])
  return { snapshot, connection }
}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof StorageError) return error.message
  return 'Something went wrong while saving. Try again.'
}

export function isRetryable(error: unknown): boolean {
  return !(error instanceof StorageError) || error.retryable
}
