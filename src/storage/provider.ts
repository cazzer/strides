/**
 * The storage-provider adapter (save-assessments-to-runner-storage, design D2). The assessment
 * store (`assessmentStore.ts`) is written once against this; a provider only moves bytes.
 *
 * Every lookup is by `props` (provider-side metadata: Drive `appProperties`), never by a name,
 * because the runner can rename anything in their own storage.
 */

export type StoredKind = 'root' | 'assessment' | 'analysis' | 'manifest' | 'index' | 'clip'

export interface StoredProps {
  stridesKind: StoredKind
  stridesAssessmentId?: string
}

export interface StoredFolder {
  id: string
  name: string
}

export interface StoredFile {
  id: string
  name: string
  props: StoredProps
}

export type ProviderAvailability = 'unavailable' | 'disconnected' | 'connected'

export type StorageProviderId = 'google-drive' | 'fake'

/** A provider failure a runner can act on. `retryable` errors get a Try again. */
export class StorageError extends Error {
  readonly code: StorageErrorCode
  readonly retryable: boolean
  constructor(code: StorageErrorCode, message: string, retryable = true) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    this.retryable = retryable
  }
}

export type StorageErrorCode =
  | 'unavailable'
  | 'not-connected'
  | 'popup-blocked'
  | 'popup-closed'
  | 'access-denied'
  | 'network'
  | 'quota'
  | 'not-found'
  | 'cancelled'
  | 'newer-version'
  | 'unknown'

export interface StorageProvider {
  readonly id: StorageProviderId
  /** "Google Drive" — the destination as a runner reads it. */
  readonly label: string
  availability(): ProviderAvailability
  /**
   * Load whatever `connect()` needs so it can open a popup synchronously (a script). Makes no
   * consent request. Resolves once ready; idempotent.
   */
  prepare(): Promise<void>
  /** True once `prepare()` has resolved — the UI's cue that the next tap can call `connect()`. */
  isPrepared(): boolean
  /**
   * Ask for access. MUST be called synchronously inside a user gesture (the popup opens before
   * the first await). Resolves when access is granted.
   */
  connect(): Promise<void>
  /**
   * Make sure the access in hand is still valid, re-asking without a consent screen when it has
   * expired. Same gesture rule as `connect()` whenever it might have to ask.
   */
  ensureAccess(): Promise<void>
  /** Revoke access and forget it. Saved files stay where they are. */
  disconnect(): Promise<void>

  /** The app's root folder, created on first use and found by props afterwards. */
  ensureRoot(knownId?: string | null): Promise<StoredFolder>
  /** The root folder if it already exists — never creates one (opening Progress writes nothing). */
  findRoot(knownId?: string | null): Promise<StoredFolder | null>
  createFolder(parent: StoredFolder, name: string, props: StoredProps): Promise<StoredFolder>
  writeJson(
    parent: StoredFolder,
    name: string,
    data: unknown,
    props: StoredProps,
    existing?: StoredFile,
  ): Promise<StoredFile>
  uploadBlob(
    parent: StoredFolder,
    name: string,
    blob: Blob,
    props: StoredProps,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<StoredFile>
  readJson(file: StoredFile | { id: string }): Promise<unknown>
  /** Move a folder this app created (and its contents) to the bin. Used only to clear away a save
   * that failed or was cancelled before its analysis file was written. */
  trash(folder: StoredFolder): Promise<void>
  /** Direct children of `parent` (files or folders) whose props match every given key. */
  findByProps(parent: StoredFolder, props: Partial<StoredProps>): Promise<StoredFile[]>
}
